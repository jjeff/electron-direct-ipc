/**
 * Benchmark E2E Tests for electron-direct-ipc
 *
 * These tests validate the performance claims made in README.md:
 * - Send 1000 non-throttled messages: ~2ms
 * - Send 1000 throttled messages: ~2ms (but only 1 delivered)
 * - Invoke round-trip: ~1.5ms average
 * - Connect new renderer: ~10ms
 *
 * These tests are designed to be run manually to validate performance.
 * They use generous thresholds to avoid flaky CI failures while still
 * verifying the order-of-magnitude performance claims.
 *
 * Run with: npm run test:e2e:benchmark
 */
import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test'
import { launchElectron, waitForWindows, getElectronLaunchArgs, getTestAppPath } from './electron-launch.js'

interface BenchmarkResult {
  name: string
  totalTimeMs: number
  iterations: number
  avgTimeMs: number
  minTimeMs?: number
  maxTimeMs?: number
  messagesDelivered?: number
}

let windows: Record<string, Page> = {}
let app: ElectronApplication

// Performance thresholds (generous to avoid CI flakiness)
// These are ~10x the typical observed values to account for CI variability
const THRESHOLDS = {
  // Typical: ~7ms for 1000 messages, we allow up to 100ms
  SEND_1000_MESSAGES_MAX_MS: 100,
  // Typical: ~1ms for 1000 throttled messages
  SEND_1000_THROTTLED_MAX_MS: 50,
  // Typical: ~0.1ms average invoke round-trip, we allow up to 5ms
  INVOKE_AVG_MAX_MS: 5,
  // Typical: ~25ms for new renderer connection, we allow up to 500ms
  // (this includes MessageChannel setup overhead and varies by system)
  NEW_RENDERER_CONNECTION_MAX_MS: 500,
}

test.describe('DirectIPC Benchmarks', () => {
  test.beforeAll(async () => {
    console.log('Starting Electron app for benchmark tests...')
    app = await launchElectron()
    console.log('Electron app launched, waiting for windows...')
    windows = await waitForWindows(app, 2)
    console.log(`Windows ready: ${Object.keys(windows).join(', ')}`)
  })

  test.afterAll(async () => {
    if (app) {
      await app.close()
    }
  })

  test.beforeEach(async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Reset benchmark counters in both windows
    await win1.evaluate(() => (window as any).directIpc.benchmark.resetCounters())
    await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())
  })

  test('benchmark: send 1000 non-throttled messages', async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Run the benchmark from window 1
    const result: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.sendMessages(1000)
    })

    // Wait a bit for all messages to be received
    await win1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    // Check how many messages were received by window 2
    const messagesReceived = await win2.evaluate(() => {
      return (window as any).directIpc.benchmark.getMessagesReceived()
    })

    console.log(`
    ===============================================
    BENCHMARK: Send 1000 Non-Throttled Messages
    ===============================================
    Total time:        ${result.totalTimeMs.toFixed(2)}ms
    Average per msg:   ${result.avgTimeMs.toFixed(4)}ms
    Messages sent:     ${result.iterations}
    Messages received: ${messagesReceived}
    ===============================================
    README claim: ~7ms for 1000 messages
    `)

    // Verify all messages were received
    expect(messagesReceived).toBe(1000)

    // Verify performance is within threshold
    expect(result.totalTimeMs).toBeLessThan(THRESHOLDS.SEND_1000_MESSAGES_MAX_MS)
  })

  test('benchmark: send 1000 throttled messages (coalescing)', async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Run the benchmark from window 1
    const result: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.sendThrottledMessages(1000)
    })

    // Wait for throttled flush
    await win1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    // Check how many throttled messages were received by window 2
    const messagesReceived = await win2.evaluate(() => {
      return (window as any).directIpc.benchmark.getThrottledMessagesReceived()
    })

    console.log(`
    ===============================================
    BENCHMARK: Send 1000 Throttled Messages
    ===============================================
    Total time:        ${result.totalTimeMs.toFixed(2)}ms
    Average per msg:   ${result.avgTimeMs.toFixed(4)}ms
    Messages sent:     ${result.iterations}
    Messages received: ${messagesReceived}
    ===============================================
    README claim: ~1ms for 1000 messages (only 1 delivered)
    `)

    // Verify only 1 message was received (coalescing worked)
    expect(messagesReceived).toBe(1)

    // Verify performance is within threshold
    expect(result.totalTimeMs).toBeLessThan(THRESHOLDS.SEND_1000_THROTTLED_MAX_MS)
  })

  test('benchmark: invoke round-trip latency', async () => {
    const win1 = windows['1']

    // Run 100 invoke round-trips to get stable measurements
    const result: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.invokeRoundTrips(100)
    })

    console.log(`
    ===============================================
    BENCHMARK: Invoke Round-Trip Latency
    ===============================================
    Iterations:        ${result.iterations}
    Total time:        ${result.totalTimeMs.toFixed(2)}ms
    Average latency:   ${result.avgTimeMs.toFixed(3)}ms
    Min latency:       ${result.minTimeMs?.toFixed(3)}ms
    Max latency:       ${result.maxTimeMs?.toFixed(3)}ms
    ===============================================
    README claim: ~0.1ms average round-trip
    `)

    // Verify performance is within threshold
    expect(result.avgTimeMs).toBeLessThan(THRESHOLDS.INVOKE_AVG_MAX_MS)
  })

  test('benchmark: multiple batches of throttled messages', async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Send 3 separate batches with time between them
    let totalTime = 0

    for (let batch = 0; batch < 3; batch++) {
      await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())

      const result: BenchmarkResult = await win1.evaluate(async () => {
        return await (window as any).directIpc.benchmark.sendThrottledMessages(1000)
      })
      totalTime += result.totalTimeMs

      // Wait for batch to be processed
      await win1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))

      const received = await win2.evaluate(() => {
        return (window as any).directIpc.benchmark.getThrottledMessagesReceived()
      })

      console.log(
        `Batch ${batch + 1}: ${result.totalTimeMs.toFixed(2)}ms, ${received} messages received`
      )
      expect(received).toBe(1) // Each batch should coalesce to 1 message
    }

    console.log(`
    ===============================================
    BENCHMARK: 3 Batches of 1000 Throttled Messages
    ===============================================
    Total time for all batches: ${totalTime.toFixed(2)}ms
    Average per batch:          ${(totalTime / 3).toFixed(2)}ms
    ===============================================
    `)
  })

  test('benchmark: high-frequency invoke stress test', async () => {
    const win1 = windows['1']

    // Run many invoke round-trips to stress test
    const result: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.invokeRoundTrips(500)
    })

    console.log(`
    ===============================================
    BENCHMARK: High-Frequency Invoke (500 calls)
    ===============================================
    Total time:        ${result.totalTimeMs.toFixed(2)}ms
    Average latency:   ${result.avgTimeMs.toFixed(3)}ms
    Min latency:       ${result.minTimeMs?.toFixed(3)}ms
    Max latency:       ${result.maxTimeMs?.toFixed(3)}ms
    Throughput:        ${((500 / result.totalTimeMs) * 1000).toFixed(0)} invokes/sec
    ===============================================
    `)

    // All invokes should complete successfully
    expect(result.iterations).toBe(500)
    expect(result.avgTimeMs).toBeLessThan(THRESHOLDS.INVOKE_AVG_MAX_MS)
  })
})

test.describe('DirectIPC Connection Benchmarks', () => {
  // This test requires its own app instance to measure connection time
  test('benchmark: new renderer connection time', async () => {
    const testAppPath = getTestAppPath()
    const launchArgs = getElectronLaunchArgs(testAppPath)

    console.log('Launching new Electron app for connection benchmark...')
    const newApp = await electron.launch({
      args: launchArgs,
      timeout: process.env.CI ? 60_000 : 30_000,
    })

    const newWindows: { [key: string]: Page } = {}
    let connectionCompleteTime: number | undefined

    // Track window creation time
    const windowCreationStart = performance.now()

    newApp.on('window', async (page) => {
      try {
        const winId = await page.evaluate(() => (window as any).windowId)
        if (winId) {
          newWindows[winId] = page
          if (Object.keys(newWindows).length === 2) {
            connectionCompleteTime = performance.now() - windowCreationStart
          }
        }
      } catch (e) {
        console.log('Failed to get window ID:', e)
      }
    })

    // Wait for both windows to be ready with longer timeout for CI
    const timeout = process.env.CI ? 60_000 : 10_000
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
      const check = setInterval(() => {
        if (Object.keys(newWindows).length >= 2) {
          clearTimeout(timeoutId)
          clearInterval(check)
          resolve()
        }
      }, 50)
    })

    // Now test the actual MessageChannel connection time
    const win1 = newWindows['1']
    const win2 = newWindows['2']

    // Measure time to first successful message
    const start = performance.now()
    await win1.evaluate(() => (window as any).directIpc.sendMessage('connection-test'))

    // Wait for message to arrive
    await expect(win2.locator('#messages')).toContainText('connection-test', { timeout: 5000 })
    const messageDeliveryTime = performance.now() - start

    console.log(`
    ===============================================
    BENCHMARK: New Renderer Connection Time
    ===============================================
    Windows ready:      ${connectionCompleteTime?.toFixed(2)}ms (from app launch)
    First message:      ${messageDeliveryTime.toFixed(2)}ms (includes MessageChannel setup)
    ===============================================
    README claim: ~25ms for new renderer connection
    `)

    // The first message delivery time includes MessageChannel establishment
    expect(messageDeliveryTime).toBeLessThan(THRESHOLDS.NEW_RENDERER_CONNECTION_MAX_MS)

    await newApp.close()
  })
})

test.describe('DirectIPC vs Traditional IPC Comparison', () => {
  test.beforeAll(async () => {
    // Clear windows from previous test suites
    Object.keys(windows).forEach((key) => delete windows[key])

    console.log('Starting Electron app for IPC comparison tests...')
    app = await launchElectron()
    console.log('Electron app launched, waiting for windows...')
    windows = await waitForWindows(app, 2)
    console.log(`Windows ready: ${Object.keys(windows).join(', ')}`)
  })

  test.afterAll(async () => {
    if (app) {
      await app.close()
    }
  })

  test('comparison: ipcRenderer.invoke vs DirectIPC invoke (renderer -> main only)', async () => {
    const win1 = windows['1']

    // Traditional IPC: renderer -> main -> renderer (same process)
    const traditionalResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcPing(100)
    })

    // DirectIPC: renderer -> renderer (via MessageChannel)
    const directIpcResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.invokeRoundTrips(100)
    })

    const speedup = traditionalResult.avgTimeMs / directIpcResult.avgTimeMs

    console.log(`
    ===============================================
    COMPARISON: Invoke Round-Trip Latency
    ===============================================
    Traditional IPC (renderer -> main):
      Average latency:   ${traditionalResult.avgTimeMs.toFixed(3)}ms
      Min latency:       ${traditionalResult.minTimeMs?.toFixed(3)}ms
      Max latency:       ${traditionalResult.maxTimeMs?.toFixed(3)}ms

    DirectIPC (renderer -> renderer via MessageChannel):
      Average latency:   ${directIpcResult.avgTimeMs.toFixed(3)}ms
      Min latency:       ${directIpcResult.minTimeMs?.toFixed(3)}ms
      Max latency:       ${directIpcResult.maxTimeMs?.toFixed(3)}ms

    DirectIPC is ${speedup.toFixed(1)}x faster
    ===============================================
    `)
  })

  test('comparison: relay via main vs DirectIPC send (renderer -> renderer)', async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Reset counters
    await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())

    // Traditional IPC: renderer1 -> main -> renderer2
    const traditionalResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcRelay(1000)
    })

    // Wait for messages to be received
    await win1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const traditionalReceived = await win2.evaluate(() => {
      return (window as any).directIpc.benchmark.getTraditionalIpcMessagesReceived()
    })

    // Reset and test DirectIPC
    await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())

    // DirectIPC: renderer1 -> renderer2 (direct via MessageChannel)
    const directIpcResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.sendMessages(1000)
    })

    await win1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const directReceived = await win2.evaluate(() => {
      return (window as any).directIpc.benchmark.getMessagesReceived()
    })

    const speedup = traditionalResult.totalTimeMs / directIpcResult.totalTimeMs

    console.log(`
    ===============================================
    COMPARISON: Send 1000 Messages (renderer -> renderer)
    ===============================================
    Traditional IPC (renderer -> main -> renderer):
      Total time:        ${traditionalResult.totalTimeMs.toFixed(2)}ms
      Average per msg:   ${traditionalResult.avgTimeMs.toFixed(4)}ms
      Messages received: ${traditionalReceived}

    DirectIPC (renderer -> renderer via MessageChannel):
      Total time:        ${directIpcResult.totalTimeMs.toFixed(2)}ms
      Average per msg:   ${directIpcResult.avgTimeMs.toFixed(4)}ms
      Messages received: ${directReceived}

    DirectIPC is ${speedup.toFixed(1)}x faster
    ===============================================
    `)

    // Verify all messages received
    expect(traditionalReceived).toBe(1000)
    expect(directReceived).toBe(1000)
  })

  test('comparison: relay invoke via main vs DirectIPC invoke (full round-trip)', async () => {
    const win1 = windows['1']

    // Traditional IPC: renderer1 -> main -> renderer2 -> main -> renderer1
    const traditionalResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcRelayInvoke(100)
    })

    // DirectIPC: renderer1 -> renderer2 -> renderer1 (via MessageChannel)
    const directIpcResult: BenchmarkResult = await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.invokeRoundTrips(100)
    })

    const speedup = traditionalResult.avgTimeMs / directIpcResult.avgTimeMs

    console.log(`
    ===============================================
    COMPARISON: Full Relay Invoke (renderer1 <-> renderer2)
    ===============================================
    Traditional IPC (renderer1 -> main -> renderer2 -> main -> renderer1):
      Total time:        ${traditionalResult.totalTimeMs.toFixed(2)}ms
      Average latency:   ${traditionalResult.avgTimeMs.toFixed(3)}ms
      Min latency:       ${traditionalResult.minTimeMs?.toFixed(3)}ms
      Max latency:       ${traditionalResult.maxTimeMs?.toFixed(3)}ms

    DirectIPC (renderer1 <-> renderer2 via MessageChannel):
      Total time:        ${directIpcResult.totalTimeMs.toFixed(2)}ms
      Average latency:   ${directIpcResult.avgTimeMs.toFixed(3)}ms
      Min latency:       ${directIpcResult.minTimeMs?.toFixed(3)}ms
      Max latency:       ${directIpcResult.maxTimeMs?.toFixed(3)}ms

    DirectIPC is ${speedup.toFixed(1)}x faster
    ===============================================

    Note: Traditional IPC relay requires 4 IPC hops vs DirectIPC's 2 MessageChannel hops
    `)
  })

  test('summary: performance comparison table', async () => {
    const win1 = windows['1']
    const win2 = windows['2']

    // Collect all benchmark data
    await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())

    const tradPing = (await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcPing(100)
    })) as BenchmarkResult

    const tradRelay = (await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcRelay(1000)
    })) as BenchmarkResult

    const tradRelayInvoke = (await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.traditionalIpcRelayInvoke(100)
    })) as BenchmarkResult

    await win2.evaluate(() => (window as any).directIpc.benchmark.resetCounters())

    const directSend = (await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.sendMessages(1000)
    })) as BenchmarkResult

    const directInvoke = (await win1.evaluate(async () => {
      return await (window as any).directIpc.benchmark.invokeRoundTrips(100)
    })) as BenchmarkResult

    console.log(`
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║                    PERFORMANCE COMPARISON SUMMARY                              ║
    ╠═══════════════════════════════════════════════════════════════════════════════╣
    ║ Operation                          │ Traditional IPC │ DirectIPC │ Speedup    ║
    ╠════════════════════════════════════╪═════════════════╪═══════════╪════════════╣
    ║ Ping (renderer -> main)            │ ${tradPing.avgTimeMs.toFixed(3).padStart(11)}ms │     N/A   │    N/A     ║
    ║ Send 1000 msgs (r1 -> r2)          │ ${tradRelay.totalTimeMs.toFixed(2).padStart(11)}ms │ ${directSend.totalTimeMs.toFixed(2).padStart(7)}ms │ ${(tradRelay.totalTimeMs / directSend.totalTimeMs).toFixed(1).padStart(6)}x    ║
    ║ Invoke avg (r1 <-> r2)             │ ${tradRelayInvoke.avgTimeMs.toFixed(3).padStart(11)}ms │ ${directInvoke.avgTimeMs.toFixed(3).padStart(7)}ms │ ${(tradRelayInvoke.avgTimeMs / directInvoke.avgTimeMs).toFixed(1).padStart(6)}x    ║
    ╚═══════════════════════════════════════════════════════════════════════════════╝

    Key: r1 = renderer1, r2 = renderer2

    Traditional IPC path: renderer -> ipcMain -> renderer (via webContents.send)
    DirectIPC path:       renderer <-> renderer (via MessageChannel, bypasses main)
    `)
  })
})
