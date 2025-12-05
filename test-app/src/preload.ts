// Preload script for Electron test app

import { contextBridge, ipcRenderer } from 'electron'
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'
import type {
  BenchmarkResult,
  TestDirectIpcInvokeMap,
  TestDirectIpcMap,
  WindowName,
} from './shared'

const windowId = process.argv.find((arg) => arg.startsWith('--win-id='))?.split('=')[1] || 'unknown'
console.log(`Preload script loaded for window ID: ${windowId}`)
const directIpc = DirectIpcRenderer.instance<TestDirectIpcMap, TestDirectIpcInvokeMap, WindowName>({
  identifier: `window:${windowId}`,
})
// if windowId is 1, use 2, and vice versa
const otherWindowId = windowId === '1' ? '2' : '1'

// Track received throttled progress messages for E2E testing
// This array is kept in preload context and exposed via contextBridge
const throttledProgressReceived: number[] = []

// Benchmark tracking
let benchmarkMessagesReceived = 0
let benchmarkThrottledMessagesReceived = 0
let traditionalIpcMessagesReceived = 0

// Register this window with main process for traditional IPC benchmarks
ipcRenderer.invoke('BENCHMARK_REGISTER_WINDOW', windowId)

/** ---- API for contextBridge ---- */

contextBridge.exposeInMainWorld('directIpc', {
  getMap: () => directIpc.getMap(),
  sendMessage: (msg: string) =>
    directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-message', msg),
  sendObject: (obj: object) =>
    directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-object', obj),
  sendNumber: (num: number) =>
    directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-number', num),
  sendBoolean: (flag: boolean) =>
    directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-boolean', flag),
  sendMultipleArgs: (a: string, b: number, c: boolean) =>
    directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-multiple-args', a, b, c),
  invokeEcho: (msg: string): Promise<string> =>
    directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-echo', msg),
  invokeSum: (a: number, b: number): Promise<number> =>
    directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-sum', a, b),
  invokeSumArray: (arr: number[]): Promise<number> =>
    directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-sum-array', arr),

  // Utility process methods
  util: {
    sendCompute: (num: number) =>
      directIpc.send({ identifier: 'compute-worker' }, 'compute-request', num),
    sendPing: () => directIpc.send({ identifier: 'compute-worker' }, 'ping'),
    invokeComputation: (numbers: number[]): Promise<number> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'heavy-computation', numbers),
    invokeStats: (): Promise<{ uptime: number; processed: number }> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'get-stats'),
    invokeSlowOperation: (delay: number, timeout?: number): Promise<string> =>
      timeout
        ? directIpc.invoke({ identifier: 'compute-worker' }, 'slow-operation', delay, { timeout })
        : directIpc.invoke({ identifier: 'compute-worker' }, 'slow-operation', delay),
    // Throttled utility methods
    sendThrottledPosition: (x: number, y: number) =>
      directIpc.throttled.send({ identifier: 'compute-worker' }, 'throttled-position', x, y),
    invokeThrottledStats: (): Promise<{
      lastPosition: { x: number; y: number }
      receiveCount: number
    }> => directIpc.invoke({ identifier: 'compute-worker' }, 'get-throttled-stats'),
    resetThrottledStats: (): Promise<boolean> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'reset-throttled-stats'),
    requestThrottledProgress: (count: number): Promise<number> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'send-throttled-progress', count),
    // E2E testing - trigger status broadcast on demand (avoids 5s wait for periodic update)
    broadcastStatus: (): Promise<boolean> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'broadcast-status'),
  },

  // Throttled methods
  throttled: {
    sendCounter: (count: number) =>
      directIpc.throttled.send(
        { identifier: `window:${otherWindowId}` },
        'throttled-counter',
        count
      ),
    invokeCounter: (count: number): Promise<number> =>
      directIpc.throttled.invoke(
        { identifier: `window:${otherWindowId}` },
        'throttled-invoke-counter',
        count
      ),
  },

  // E2E testing helpers for throttled progress tracking
  // These expose the preload-side array to the page context
  testing: {
    getThrottledProgressReceived: (): number[] => throttledProgressReceived,
    resetThrottledProgressReceived: () => {
      throttledProgressReceived.length = 0
    },
  },

  // Benchmark APIs for validating README performance claims
  benchmark: {
    // Send N non-throttled messages and return timing
    sendMessages: async (count: number): Promise<BenchmarkResult> => {
      benchmarkMessagesReceived = 0
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        await directIpc.send({ identifier: `window:${otherWindowId}` }, 'benchmark-ping', i)
      }
      const end = performance.now()
      const totalTimeMs = end - start
      return {
        name: `Send ${count} non-throttled messages`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
      }
    },

    // Send N throttled messages and return timing + delivery count
    sendThrottledMessages: async (count: number): Promise<BenchmarkResult> => {
      benchmarkThrottledMessagesReceived = 0
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        directIpc.throttled.send(
          { identifier: `window:${otherWindowId}` },
          'benchmark-throttled-ping',
          i
        )
      }
      const end = performance.now()
      // Wait for microtask flush
      await new Promise((resolve) => setTimeout(resolve, 50))
      const totalTimeMs = end - start
      return {
        name: `Send ${count} throttled messages`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
        // Note: messagesDelivered will be queried from receiving window
      }
    },

    // Invoke N round-trips and return timing with min/max
    invokeRoundTrips: async (count: number): Promise<BenchmarkResult> => {
      const times: number[] = []
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        const invokeStart = performance.now()
        await directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'benchmark-echo', i)
        times.push(performance.now() - invokeStart)
      }
      const end = performance.now()
      const totalTimeMs = end - start
      return {
        name: `Invoke ${count} round-trips`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
        minTimeMs: Math.min(...times),
        maxTimeMs: Math.max(...times),
      }
    },

    // Get count of benchmark messages received (for verification on receiving end)
    getMessagesReceived: () => benchmarkMessagesReceived,
    getThrottledMessagesReceived: () => benchmarkThrottledMessagesReceived,
    getTraditionalIpcMessagesReceived: () => traditionalIpcMessagesReceived,
    resetCounters: () => {
      benchmarkMessagesReceived = 0
      benchmarkThrottledMessagesReceived = 0
      traditionalIpcMessagesReceived = 0
    },

    // ========================================================================
    // Traditional IPC benchmarks for comparison
    // These use the standard Electron ipcRenderer/ipcMain pattern
    // ========================================================================

    // Traditional IPC: Simple round-trip through main process only
    // Pattern: renderer -> main -> renderer (same renderer, just main process handling)
    traditionalIpcPing: async (count: number): Promise<BenchmarkResult> => {
      const times: number[] = []
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        const invokeStart = performance.now()
        await ipcRenderer.invoke('BENCHMARK_IPC_PING', i)
        times.push(performance.now() - invokeStart)
      }
      const end = performance.now()
      const totalTimeMs = end - start
      return {
        name: `Traditional IPC ping ${count} round-trips`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
        minTimeMs: Math.min(...times),
        maxTimeMs: Math.max(...times),
      }
    },

    // Traditional IPC: Relay messages through main process
    // Pattern: renderer1 -> main -> renderer2 (fire-and-forget)
    traditionalIpcRelay: async (count: number): Promise<BenchmarkResult> => {
      traditionalIpcMessagesReceived = 0
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        await ipcRenderer.invoke('BENCHMARK_IPC_RELAY', otherWindowId, 'BENCHMARK_RELAY_MSG', i)
      }
      const end = performance.now()
      const totalTimeMs = end - start
      return {
        name: `Traditional IPC relay ${count} messages`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
      }
    },

    // Traditional IPC: Full relay invoke with response
    // Pattern: renderer1 -> main -> renderer2 -> main -> renderer1
    traditionalIpcRelayInvoke: async (count: number): Promise<BenchmarkResult> => {
      const times: number[] = []
      const start = performance.now()
      for (let i = 0; i < count; i++) {
        const invokeStart = performance.now()
        await ipcRenderer.invoke(
          'BENCHMARK_IPC_RELAY_INVOKE',
          otherWindowId,
          'BENCHMARK_RELAY_INVOKE',
          i
        )
        times.push(performance.now() - invokeStart)
      }
      const end = performance.now()
      const totalTimeMs = end - start
      return {
        name: `Traditional IPC relay invoke ${count} round-trips`,
        totalTimeMs,
        iterations: count,
        avgTimeMs: totalTimeMs / count,
        minTimeMs: Math.min(...times),
        maxTimeMs: Math.max(...times),
      }
    },
  },
})

contextBridge.exposeInMainWorld('windowId', windowId)

/** ---- Listeners ---- */

// Central function to log messages to the messages div
function logMessage(text: string) {
  const messages = document.getElementById('messages')
  if (messages) {
    const p = document.createElement('p')
    p.innerText = text
    messages.appendChild(p)
  }
}

function handleDomLoaded() {
  const head = document.getElementById('page-head')
  if (head) {
    head.innerText = `Window ${windowId}`
  }
  const messages = document.getElementById('messages')
  const clearButton = document.getElementById('clear-messages')
  if (clearButton && messages) {
    clearButton.addEventListener('click', () => {
      messages.innerHTML = ''
    })
  }

  // Set up message listeners (events)
  directIpc.on('send-message', (sender, msg) => {
    logMessage(`[Event] send-message from ${sender.identifier}: ${msg}`)
  })

  directIpc.on('send-object', (sender, obj) => {
    logMessage(`[Event] send-object from ${sender.identifier}: ${JSON.stringify(obj)}`)
  })

  directIpc.on('send-number', (sender, num) => {
    logMessage(`[Event] send-number from ${sender.identifier}: ${num}`)
  })

  directIpc.on('send-boolean', (sender, flag) => {
    logMessage(`[Event] send-boolean from ${sender.identifier}: ${flag}`)
  })

  directIpc.on('send-multiple-args', (sender, a, b, c) => {
    logMessage(`[Event] send-multiple-args from ${sender.identifier}: a="${a}", b=${b}, c=${c}`)
  })

  // Set up invoke handlers (request-response)
  directIpc.handle('invoke-echo', (sender, msg) => {
    logMessage(`[Invoke] invoke-echo from ${sender.identifier}: "${msg}" -> returning "${msg}"`)
    return msg
  })

  directIpc.handle('invoke-sum', (sender, a, b) => {
    const result = a + b
    logMessage(`[Invoke] invoke-sum from ${sender.identifier}: ${a} + ${b} = ${result}`)
    return result
  })

  directIpc.handle('invoke-sum-array', (sender, arr) => {
    const result = arr.reduce((sum, val) => sum + val, 0)
    logMessage(
      `[Invoke] invoke-sum-array from ${sender.identifier}: [${arr.join(', ')}] = ${result}`
    )
    return result
  })

  // Throttled event listener
  directIpc.throttled.on('throttled-counter', (sender, count) => {
    logMessage(`[Throttled Event] throttled-counter from ${sender.identifier}: ${count}`)
  })

  // Throttled invoke handler
  directIpc.throttled.handle('throttled-invoke-counter', (sender, count) => {
    logMessage(
      `[Throttled Invoke] throttled-invoke-counter from ${sender.identifier}: ${count} -> returning ${count}`
    )
    return count
  })

  // Utility process message listeners
  directIpc.on('status-update', (sender, status, timestamp) => {
    logMessage(
      `[Utility] status-update from ${sender.identifier}: ${status} at ${new Date(timestamp).toLocaleTimeString()}`
    )
  })

  directIpc.on('compute-request', (sender, result) => {
    logMessage(`[Utility] compute-result from ${sender.identifier}: ${result}`)
  })

  // Throttled progress listener (from utility process)
  // Uses the module-scoped throttledProgressReceived array exposed via contextBridge
  directIpc.throttled.on('throttled-progress', (sender, percent) => {
    throttledProgressReceived.push(percent)
    console.log(
      `[Preload] Pushed ${percent} to throttledProgressReceived, now has ${throttledProgressReceived.length} items`
    )
    logMessage(`[Utility Throttled] throttled-progress from ${sender.identifier}: ${percent}%`)
  })

  // Benchmark listeners (silent - no logging to avoid overhead)
  directIpc.on('benchmark-ping', () => {
    benchmarkMessagesReceived++
  })

  directIpc.throttled.on('benchmark-throttled-ping', () => {
    benchmarkThrottledMessagesReceived++
  })

  // Benchmark invoke handler
  directIpc.handle('benchmark-echo', (_sender, index) => {
    return index
  })

  // Traditional IPC benchmark listeners (for relay tests)
  ipcRenderer.on('BENCHMARK_RELAY_MSG', (_event, _data) => {
    traditionalIpcMessagesReceived++
  })

  // Traditional IPC relay invoke handler - responds back through main
  ipcRenderer.on('BENCHMARK_RELAY_INVOKE', (_event, { requestId, data }) => {
    // Echo the data back through main process
    ipcRenderer.send('BENCHMARK_IPC_RELAY_RESPONSE', requestId, data)
  })
}

document.addEventListener('DOMContentLoaded', () => {
  handleDomLoaded()
})
