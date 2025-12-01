import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const windows: { [key: string]: Page } = {};
let app: ElectronApplication

test.beforeAll(async () => {
  // Launch Electron with the test-app main file
  const testAppPath = path.join(__dirname, '../../test-app/dist/main.js');

  app = await electron.launch({
    args: [testAppPath],
  });

  app.on('window', async (page) => {
    const winId = await page.evaluate(() => (window as any).windowId);
    console.log(`Detected window with ID: ${winId}`);
    if (winId) {
      windows[winId] = page;
    }
  });

  const timeoutPromise = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for windows')), 10000));
  // Wait for both windows to be ready
  const windowsReadyPromise = (async () => {
    while (Object.keys(windows).length < 2) {
      await new Promise(r => setTimeout(r, 100));
    }
  })();
  await Promise.race([timeoutPromise, windowsReadyPromise]);
});

test.afterAll(async () => {
  await app.close();
});

test.describe('DirectIPC Window-to-Window Communication', () => {

  test.beforeEach(async () => {
    // Clear messages in both windows before each test
    const win1 = windows['1'];
    const win2 = windows['2'];

    await win1.getByRole('button', { name: 'Clear Messages' }).click();
    await win2.getByRole('button', { name: 'Clear Messages' }).click();
  });

  test('should display window identifiers correctly', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    expect(win1).toBeDefined();
    expect(win2).toBeDefined();

    // Verify each window displays its correct ID
    await expect(win1.getByRole('heading', { level: 2 })).toHaveText('Window 1');
    await expect(win2.getByRole('heading', { level: 2 })).toHaveText('Window 2');
  });

  test('should send string messages between windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send message from window 1 to window 2
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('Hello from Window 1');
    });

    // Verify window 2 received the message
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('Hello from Window 1');
    await expect(messages).toContainText('[Event] send-message from window:1');
  });

  test('should send objects between windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    const testObject = { name: 'test', value: 42, nested: { key: 'value' } };

    // Send object from window 1 to window 2
    await win1.evaluate((obj) => {
      (window as any).directIpc.sendObject(obj);
    }, testObject);

    // Verify window 2 received the object
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Event] send-object from window:1');
    await expect(messages).toContainText(JSON.stringify(testObject));
  });

  test('should send numbers between windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send number from window 1 to window 2
    await win1.evaluate(() => {
      (window as any).directIpc.sendNumber(3.14159);
    });

    // Verify window 2 received the number
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Event] send-number from window:1: 3.14159');
  });

  test('should send booleans between windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send boolean from window 1 to window 2
    await win1.evaluate(() => {
      (window as any).directIpc.sendBoolean(true);
    });

    // Verify window 2 received the boolean
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Event] send-boolean from window:1: true');
  });

  test('should send multiple arguments between windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send multiple args from window 1 to window 2
    await win1.evaluate(() => {
      (window as any).directIpc.sendMultipleArgs('test-string', 99, false);
    });

    // Verify window 2 received all arguments correctly
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Event] send-multiple-args from window:1');
    await expect(messages).toContainText('a="test-string", b=99, c=false');
  });

  test('should invoke echo and receive response', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Invoke echo from window 2 to window 1
    const response = await win2.evaluate(async () => {
      return await (window as any).directIpc.invokeEcho('Ping from Window 2');
    });

    // Verify the response is correct
    expect(response).toBe('Ping from Window 2');

    // Verify window 1 logged the invoke handler execution
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Invoke] invoke-echo from window:2: "Ping from Window 2" -> returning "Ping from Window 2"');
  });

  test('should invoke sum and receive correct calculation', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Invoke sum from window 1 to window 2
    const result = await win1.evaluate(async () => {
      return await (window as any).directIpc.invokeSum(15, 27);
    });

    // Verify the calculation is correct
    expect(result).toBe(42);

    // Verify window 2 logged the calculation
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Invoke] invoke-sum from window:1: 15 + 27 = 42');
  });

  test('should invoke sum array and receive correct result', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    const testArray = [10, 20, 30, 40];

    // Invoke sum array from window 2 to window 1
    const result = await win2.evaluate(async (arr) => {
      return await (window as any).directIpc.invokeSumArray(arr);
    }, testArray);

    // Verify the sum is correct
    expect(result).toBe(100);

    // Verify window 1 logged the calculation
    const messages = win1.locator('#messages');
    await expect(messages).toContainText('[Invoke] invoke-sum-array from window:2: [10, 20, 30, 40] = 100');
  });

  test('should handle bidirectional communication', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Window 1 sends to Window 2
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('Message from 1 to 2');
    });

    // Window 2 sends to Window 1
    await win2.evaluate(() => {
      (window as any).directIpc.sendMessage('Message from 2 to 1');
    });

    // Verify both windows received their respective messages
    const messages1 = win1.locator('#messages');
    const messages2 = win2.locator('#messages');

    await expect(messages1).toContainText('Message from 2 to 1');
    await expect(messages2).toContainText('Message from 1 to 2');
  });

  test('should clear messages when clear button is clicked', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Window 2 sends a message to window 1 to populate the messages div
    await win2.evaluate(() => {
      (window as any).directIpc.sendMessage('Test message');
    });

    // Wait for message to appear in window 1
    const messages = win1.locator('#messages');
    await expect(messages.locator('p')).toHaveCount(1);

    // Click clear button in window 1
    await win1.getByRole('button', { name: 'Clear Messages' }).click();

    // Verify messages are cleared in window 1
    await expect(messages.locator('p')).toHaveCount(0);
  });

  test('should handle multiple sequential invocations', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Perform multiple invocations in sequence
    const result1 = await win1.evaluate(async () => {
      return await (window as any).directIpc.invokeSum(5, 10);
    });

    const result2 = await win1.evaluate(async () => {
      return await (window as any).directIpc.invokeSum(20, 30);
    });

    const result3 = await win1.evaluate(async () => {
      return await (window as any).directIpc.invokeEcho('Final test');
    });

    // Verify all results are correct
    expect(result1).toBe(15);
    expect(result2).toBe(50);
    expect(result3).toBe('Final test');

    // Verify window 2 logged all invocations
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('5 + 10 = 15');
    await expect(messages).toContainText('20 + 30 = 50');
    await expect(messages).toContainText('"Final test"');
  });

  test('should handle concurrent sends from both windows', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send messages from both windows concurrently
    await Promise.all([
      win1.evaluate(() => {
        (window as any).directIpc.sendMessage('Concurrent message from 1');
      }),
      win2.evaluate(() => {
        (window as any).directIpc.sendMessage('Concurrent message from 2');
      })
    ]);

    // Verify both windows received their respective messages
    const messages1 = win1.locator('#messages');
    const messages2 = win2.locator('#messages');

    await expect(messages1).toContainText('Concurrent message from 2');
    await expect(messages2).toContainText('Concurrent message from 1');
  });

  test('should display messages with proper sender identification', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send from window 1
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('Identifying sender');
    });

    // Verify window 2 shows correct sender identifier
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('from window:1');
  });

  test('should maintain connection after page reload', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send a message before reload
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('Before reload');
    });

    // Verify message received
    await expect(win2.locator('#messages')).toContainText('Before reload');

    // Reload window 2
    await win2.reload();

    // Wait for page to be ready after reload
    await expect(win2.getByRole('heading', { level: 2 })).toHaveText('Window 2');

    // Send a message after reload
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('After reload');
    });

    // Verify message received after reload
    await expect(win2.locator('#messages')).toContainText('After reload');

    // Also test the reverse direction
    await win2.evaluate(() => {
      (window as any).directIpc.sendMessage('From reloaded window');
    });

    await expect(win1.locator('#messages')).toContainText('From reloaded window');
  });
});

test.describe('DirectIPC Throttled Communication', () => {

  test.beforeEach(async () => {
    // Clear messages in both windows before each test
    const win1 = windows['1'];
    const win2 = windows['2'];

    await win1.getByRole('button', { name: 'Clear Messages' }).click();
    await win2.getByRole('button', { name: 'Clear Messages' }).click();
  });

  test('should throttle send events and only deliver last value', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send a flurry of events rapidly
    await win1.evaluate(() => {
      for (let i = 0; i < 100; i++) {
        (window as any).directIpc.throttled.sendCounter(i);
      }
    });

    // Wait for throttled delivery (happens on next microtask)
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    // Verify window 2 received only the last value (99)
    // Throttling coalesces to the most recent value
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Throttled Event] throttled-counter from window:1: 99');

    // Count the number of throttled-counter messages (should be 1)
    const messageCount = await messages.locator('p:has-text("[Throttled Event] throttled-counter")').count();
    expect(messageCount).toBe(1);
  });

  test('should pass through invoke calls without throttling', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send a flurry of invoke calls rapidly
    // Note: invoke methods on throttled are NOT actually throttled - they pass through directly
    // This is because each invoke needs its own response
    const results = await win1.evaluate(async () => {
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push((window as any).directIpc.throttled.invokeCounter(i));
      }
      return await Promise.all(promises);
    });

    // All promises should resolve with their respective values
    expect(results.length).toBe(50);
    expect(results[0]).toBe(0);
    expect(results[49]).toBe(49);

    // Verify window 2 processed all invokes (not throttled)
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Throttled Invoke] throttled-invoke-counter from window:1: 0');
    await expect(messages).toContainText('[Throttled Invoke] throttled-invoke-counter from window:1: 49');

    // Should have 50 messages (all went through)
    const messageCount = await messages.locator('p:has-text("[Throttled Invoke] throttled-invoke-counter")').count();
    expect(messageCount).toBe(50);
  });

  test('should throttle bidirectional communication', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Both windows send flurries simultaneously
    await Promise.all([
      win1.evaluate(() => {
        for (let i = 0; i < 50; i++) {
          (window as any).directIpc.throttled.sendCounter(i);
        }
      }),
      win2.evaluate(() => {
        for (let i = 100; i < 150; i++) {
          (window as any).directIpc.throttled.sendCounter(i);
        }
      })
    ]);

    // Wait for throttled delivery
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    // Verify window 1 received last throttled message from window 2 (149)
    const messages1 = win1.locator('#messages');
    await expect(messages1).toContainText('[Throttled Event] throttled-counter from window:2: 149');

    // Verify window 2 received last throttled message from window 1 (49)
    const messages2 = win2.locator('#messages');
    await expect(messages2).toContainText('[Throttled Event] throttled-counter from window:1: 49');

    // Each should have only one message
    expect(await messages1.locator('p:has-text("[Throttled Event]")').count()).toBe(1);
    expect(await messages2.locator('p:has-text("[Throttled Event]")').count()).toBe(1);
  });

  test('should maintain throttling after page reload', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Reload window 2
    await win2.reload();
    await expect(win2.getByRole('heading', { level: 2 })).toHaveText('Window 2');

    // Send throttled messages after reload
    await win1.evaluate(() => {
      for (let i = 0; i < 30; i++) {
        (window as any).directIpc.throttled.sendCounter(i);
      }
    });

    // Wait for delivery
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    // Verify throttling still works - only last value delivered
    const messages = win2.locator('#messages');
    await expect(messages).toContainText('[Throttled Event] throttled-counter from window:1: 29');

    const messageCount = await messages.locator('p:has-text("[Throttled Event] throttled-counter")').count();
    expect(messageCount).toBe(1);
  });

  test('should handle mixed throttled and non-throttled messages', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send mix of throttled and non-throttled
    await win1.evaluate(() => {
      (window as any).directIpc.sendMessage('Regular message 1');
      for (let i = 0; i < 20; i++) {
        (window as any).directIpc.throttled.sendCounter(i);
      }
      (window as any).directIpc.sendMessage('Regular message 2');
    });

    // Wait for throttled delivery
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    const messages = win2.locator('#messages');

    // Regular messages should all come through
    await expect(messages).toContainText('[Event] send-message from window:1: Regular message 1');
    await expect(messages).toContainText('[Event] send-message from window:1: Regular message 2');

    // Throttled messages should only show last value (19)
    await expect(messages).toContainText('[Throttled Event] throttled-counter from window:1: 19');

    const throttledCount = await messages.locator('p:has-text("[Throttled Event] throttled-counter")').count();
    expect(throttledCount).toBe(1);
  });

  test('should send separate throttled batches when spaced apart', async () => {
    const win1 = windows['1'];
    const win2 = windows['2'];

    // Send first batch
    await win1.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        (window as any).directIpc.throttled.sendCounter(i);
      }
    });

    // Wait for first batch to flush
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    // Send second batch (after microtask has flushed)
    await win1.evaluate(() => {
      for (let i = 100; i < 110; i++) {
        (window as any).directIpc.throttled.sendCounter(i);
      }
    });

    // Wait for second batch to flush
    await win1.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    const messages = win2.locator('#messages');

    // Should have received last value from each batch
    await expect(messages).toContainText('[Throttled Event] throttled-counter from window:1: 9');
    await expect(messages).toContainText('[Throttled Event] throttled-counter from window:1: 109');

    const throttledCount = await messages.locator('p:has-text("[Throttled Event] throttled-counter")').count();
    expect(throttledCount).toBe(2);
  });
});
