import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ipcMainInvokeHandler } from 'electron-playwright-helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const windows: { [key: string]: Page } = {};
let app: ElectronApplication;

test.beforeAll(async () => {
  // Launch Electron with the test-app main file
  const testAppPath = path.join(__dirname, '../../test-app/dist/main.js');

  // Add flags for CI environments (required for Linux runners)
  const launchArgs = [testAppPath];
  if (process.env.CI) {
    launchArgs.push('--no-sandbox', '--disable-dev-shm-usage');
  }

  app = await electron.launch({
    args: launchArgs,
  });

  // Collect windows as they're created
  app.on('window', async (page) => {
    const winId = await page.evaluate(() => (window as any).windowId);
    console.log(`[E2E] Detected window with ID: ${winId}`);
    if (winId) {
      windows[winId] = page;
    }
  });

  // Wait for both windows to be ready
  const timeoutPromise = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout waiting for windows')), 10000)
  );
  const windowsReadyPromise = (async () => {
    while (Object.keys(windows).length < 2) {
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  await Promise.race([timeoutPromise, windowsReadyPromise]);

  console.log('[E2E] Both windows ready');
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
});

test.describe('DirectIPC Utility Process Communication', () => {
  test.beforeEach(async () => {
    // Clear messages in both windows before each test
    const win1 = windows['1'];
    const win2 = windows['2'];

    if (win1) {
      await win1.getByRole('button', { name: 'Clear Messages' }).click();
    }
    if (win2) {
      await win2.getByRole('button', { name: 'Clear Messages' }).click();
    }
  });

  test('should spawn and register utility process', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Send a ping to utility process to verify it's registered
    await win1.evaluate(() => {
      (window as any).directIpc.util.sendPing();
    });

    // Verify we received status update from utility process (Playwright auto-waits)
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Utility] status-update from compute-worker');
    await expect(messages).toContainText('pong');
  });

  test('should send message from renderer to utility process', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Send compute request to utility process
    await win1.evaluate(() => {
      (window as any).directIpc.util.sendCompute(7);
    });

    // Verify we received the computed result (7 * 7 = 49) - Playwright auto-waits
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Utility] compute-result from compute-worker');
    await expect(messages).toContainText('49');
  });

  test('should receive message from utility process to renderer', async () => {
    const win2 = windows['2'];
    expect(win2).toBeDefined();

    // Send ping to trigger utility process to send status update
    await win2.evaluate(() => {
      (window as any).directIpc.util.sendPing();
    });

    // Verify we received status update - Playwright auto-waits
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Utility] status-update from compute-worker');
  });

  test('should handle bidirectional communication', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Clear messages
    await win1.getByRole('button', { name: 'Clear Messages' }).click();

    // Send multiple compute requests
    await win1.evaluate(() => {
      (window as any).directIpc.util.sendCompute(3);
      (window as any).directIpc.util.sendCompute(5);
    });

    // Verify we received both results - Playwright auto-waits
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('9'); // 3 * 3
    await expect(messages).toContainText('25'); // 5 * 5
  });

  test('should invoke utility process handler from renderer', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Invoke heavy-computation handler
    const result = await win1.evaluate(async () => {
      return await (window as any).directIpc.util.invokeComputation([1, 2, 3, 4, 5]);
    });

    // Verify result is the sum of the array
    expect(result).toBe(15);
  });

  test('should get stats from utility process', async () => {
    const win2 = windows['2'];
    expect(win2).toBeDefined();

    // Invoke get-stats handler
    const stats = await win2.evaluate(async () => {
      return await (window as any).directIpc.util.invokeStats();
    });

    // Verify stats structure
    expect(stats).toHaveProperty('uptime');
    expect(stats).toHaveProperty('processed');
    expect(typeof stats.uptime).toBe('number');
    expect(typeof stats.processed).toBe('number');
    expect(stats.uptime).toBeGreaterThan(0);
  });

  test('should handle invoke with successful response', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Invoke computation multiple times
    const results = await win1.evaluate(async () => {
      const r1 = await (window as any).directIpc.util.invokeComputation([10, 20, 30]);
      const r2 = await (window as any).directIpc.util.invokeComputation([5, 5, 5, 5]);
      return [r1, r2];
    });

    expect(results[0]).toBe(60);
    expect(results[1]).toBe(20);
  });

  test('should handle invoke timeout for slow handlers', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Invoke slow operation with short timeout
    const error = await win1.evaluate(async () => {
      try {
        await (window as any).directIpc.util.invokeSlowOperation(5000, 1000);
        return null;
      } catch (err: any) {
        return err.message;
      }
    });

    // Verify timeout error
    expect(error).toContain('timeout');
  });

  test('should handle invoke completion within timeout', async () => {
    const win2 = windows['2'];
    expect(win2).toBeDefined();

    // Invoke slow operation with sufficient timeout
    const result = await win2.evaluate(async () => {
      return await (window as any).directIpc.util.invokeSlowOperation(100, 2000);
    });

    expect(result).toBe('Completed after 100ms');
  });

  test('should receive broadcast status updates from utility process', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Clear messages
    await win1.getByRole('button', { name: 'Clear Messages' }).click();

    // Trigger an on-demand broadcast instead of waiting 5+ seconds for periodic update
    await win1.evaluate(async () => {
      await (window as any).directIpc.util.broadcastStatus();
    });

    // Verify we received the status update - Playwright auto-waits
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Utility] status-update from compute-worker');
    await expect(messages).toContainText('alive');
  });

  test('should communicate with utility process from multiple renderers', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    expect(win1).toBeDefined();
    expect(win2).toBeDefined();

    // Clear both windows
    await win1.getByRole('button', { name: 'Clear Messages' }).click();
    await win2.getByRole('button', { name: 'Clear Messages' }).click();

    // Send compute request from both windows
    await win1.evaluate(() => {
      (window as any).directIpc.util.sendCompute(4);
    });
    await win2.evaluate(() => {
      (window as any).directIpc.util.sendCompute(6);
    });

    // Verify each window received its own result - Playwright auto-waits
    const messages1 = win1.locator('#messages');
    const messages2 = win2.locator('#messages');

    await expect(messages1).toContainText('16'); // 4 * 4
    await expect(messages2).toContainText('36'); // 6 * 6
  });

  test('should handle concurrent invokes from multiple renderers', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    expect(win1).toBeDefined();
    expect(win2).toBeDefined();

    // Invoke from both windows concurrently
    const [result1, result2] = await Promise.all([
      win1.evaluate(async () => {
        return await (window as any).directIpc.util.invokeComputation([1, 1, 1]);
      }),
      win2.evaluate(async () => {
        return await (window as any).directIpc.util.invokeComputation([2, 2, 2]);
      }),
    ]);

    expect(result1).toBe(3);
    expect(result2).toBe(6);
  });

  test('should send direct messages to utility process via main process', async () => {
    // Use the E2E_POST_MESSAGE handler to send a message directly to utility process
    const response = await ipcMainInvokeHandler(app, 'E2E_POST_MESSAGE', {
      type: 'test',
      data: 'Hello from E2E test',
    });

    // The handler returns the result of postMessage, which should be undefined (void)
    expect(response).toBeUndefined();
    // We can't directly verify the utility process received it in this test,
    // but the test ensures the postMessage API works without errors
  });

  test('should maintain utility process state across multiple operations', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Get initial stats
    const initialStats = await win1.evaluate(async () => {
      return await (window as any).directIpc.util.invokeStats();
    });

    // Perform some operations
    await win1.evaluate(async () => {
      await (window as any).directIpc.util.invokeComputation([1, 2, 3]);
      await (window as any).directIpc.util.invokeComputation([4, 5, 6]);
    });

    // Get updated stats
    const updatedStats = await win1.evaluate(async () => {
      return await (window as any).directIpc.util.invokeStats();
    });

    // Verify processed count increased
    expect(updatedStats.processed).toBeGreaterThan(initialStats.processed);
    expect(updatedStats.uptime).toBeGreaterThanOrEqual(initialStats.uptime);
  });

  test('should handle large data in invoke operations', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Create a large array
    const largeArray = Array.from({ length: 1000 }, (_, i) => i + 1);

    const result = await win1.evaluate(async (arr) => {
      return await (window as any).directIpc.util.invokeComputation(arr);
    }, largeArray);

    // Sum of 1 to 1000 is 500500
    expect(result).toBe(500500);
  });

  test('should handle rapid sequential invokes', async () => {
    const win2 = windows['2'];
    expect(win2).toBeDefined();

    // Send 10 rapid sequential invokes
    const results = await win2.evaluate(async () => {
      const promises: Promise<number>[] = [];
      for (let i = 1; i <= 10; i++) {
        promises.push((window as any).directIpc.util.invokeComputation([i]));
      }
      return await Promise.all(promises);
    });

    // Verify all results are correct
    expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

test.describe('DirectIPC Utility Process Throttled Communication', () => {
  test.beforeEach(async () => {
    // Clear messages and reset throttled stats before each test
    const win1 = windows['1'];
    const win2 = windows['2'];

    if (win1) {
      await win1.getByRole('button', { name: 'Clear Messages' }).click();
      await win1.evaluate(async () => {
        await (window as any).directIpc.util.resetThrottledStats();
        (window as any).directIpc.testing.resetThrottledProgressReceived();
      });
    }
    if (win2) {
      await win2.getByRole('button', { name: 'Clear Messages' }).click();
      await win2.evaluate(async () => {
        await (window as any).directIpc.util.resetThrottledStats();
        (window as any).directIpc.testing.resetThrottledProgressReceived();
      });
    }
  });

  test('should coalesce high-frequency throttled sends from renderer to utility', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Reset stats
    await win1.evaluate(async () => {
      await (window as any).directIpc.util.resetThrottledStats();
    });

    // Send many rapid throttled position updates
    await win1.evaluate(() => {
      for (let i = 0; i < 100; i++) {
        (window as any).directIpc.util.sendThrottledPosition(i, i * 2);
      }
    });

    // Wait for microtask to flush (100ms is plenty for coalescing to complete)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get stats from utility process
    const stats = await win1.evaluate(async () => {
      return await (window as any).directIpc.util.invokeThrottledStats();
    });

    // Due to throttling, utility should have received far fewer than 100 messages
    console.log(`[E2E] Throttled stats: received ${stats.receiveCount} messages, last position: (${stats.lastPosition.x}, ${stats.lastPosition.y})`);

    // The last position should be the final one sent (99, 198)
    expect(stats.lastPosition.x).toBe(99);
    expect(stats.lastPosition.y).toBe(198);

    // Should have received significantly fewer messages than sent (coalescing working)
    expect(stats.receiveCount).toBeLessThan(50);
  });

  test('should coalesce high-frequency throttled sends from utility to renderer', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Clear the received progress array (using contextBridge exposed method) and messages
    await win1.getByRole('button', { name: 'Clear Messages' }).click();
    await win1.evaluate(() => {
      (window as any).directIpc.testing.resetThrottledProgressReceived();
    });

    // Ask utility to send 100 rapid throttled progress updates
    await win1.evaluate(async () => {
      await (window as any).directIpc.util.requestThrottledProgress(100);
    });

    // Wait for the message to appear in the DOM (this confirms the message arrived and was processed)
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Utility Throttled] throttled-progress', { timeout: 5000 });

    // Small additional wait to ensure array is updated
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check what the renderer received (using contextBridge exposed method)
    const received = await win1.evaluate(() => {
      return (window as any).directIpc.testing.getThrottledProgressReceived();
    });

    console.log(`[E2E] Renderer received ${received.length} throttled progress messages:`, received);

    // Due to throttling, renderer should have received far fewer than 100 messages
    // Should have at least 1 message (the coalesced final one)
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(50);
    // The last message should be 100% (the final value)
    expect(received[received.length - 1]).toBe(100);
  });

  test('should handle throttled messages from multiple renderers to utility', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    expect(win1).toBeDefined();
    expect(win2).toBeDefined();

    // Reset stats
    await win1.evaluate(async () => {
      await (window as any).directIpc.util.resetThrottledStats();
    });

    // Send throttled messages from both windows concurrently
    await Promise.all([
      win1.evaluate(() => {
        for (let i = 0; i < 50; i++) {
          (window as any).directIpc.util.sendThrottledPosition(i, 1000);
        }
      }),
      win2.evaluate(() => {
        for (let i = 0; i < 50; i++) {
          (window as any).directIpc.util.sendThrottledPosition(i, 2000);
        }
      }),
    ]);

    // Wait for microtask to flush (100ms is plenty)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get stats - should have received coalesced messages from both senders
    const stats = await win1.evaluate(async () => {
      return await (window as any).directIpc.util.invokeThrottledStats();
    });

    console.log(`[E2E] Multi-renderer throttled stats: received ${stats.receiveCount} messages`);

    // Should have received messages (coalesced)
    expect(stats.receiveCount).toBeGreaterThan(0);
    expect(stats.receiveCount).toBeLessThan(100); // Far fewer than 100 total sent

    // Last position should be from one of the final sends (49, 1000 or 49, 2000)
    expect(stats.lastPosition.x).toBe(49);
    expect([1000, 2000]).toContain(stats.lastPosition.y);
  });

  test('should not affect non-throttled utility messages when using throttled', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Clear messages
    await win1.getByRole('button', { name: 'Clear Messages' }).click();

    // Send both throttled and non-throttled messages
    await win1.evaluate(() => {
      // Throttled - should coalesce
      for (let i = 0; i < 10; i++) {
        (window as any).directIpc.util.sendThrottledPosition(i, i);
      }
      // Non-throttled - each should trigger a response
      (window as any).directIpc.util.sendCompute(3);
      (window as any).directIpc.util.sendCompute(5);
    });

    // Verify non-throttled messages all arrived - Playwright auto-waits
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('9'); // 3 * 3
    await expect(messages).toContainText('25'); // 5 * 5
  });

  test('should expose throttled property on utility DirectIpc instance', async () => {
    const win1 = windows['1'];
    expect(win1).toBeDefined();

    // Verify that the throttled API methods exist
    const hasThrottledMethods = await win1.evaluate(() => {
      const util = (window as any).directIpc.util;
      return {
        hasSendThrottledPosition: typeof util.sendThrottledPosition === 'function',
        hasInvokeThrottledStats: typeof util.invokeThrottledStats === 'function',
        hasResetThrottledStats: typeof util.resetThrottledStats === 'function',
        hasRequestThrottledProgress: typeof util.requestThrottledProgress === 'function',
      };
    });

    expect(hasThrottledMethods.hasSendThrottledPosition).toBe(true);
    expect(hasThrottledMethods.hasInvokeThrottledStats).toBe(true);
    expect(hasThrottledMethods.hasResetThrottledStats).toBe(true);
    expect(hasThrottledMethods.hasRequestThrottledProgress).toBe(true);
  });
});
