# Quickstart: Utility Process Support

**Feature**: electron-direct-ipc utility process communication
**Target Audience**: Developers extending Electron apps with background workers
**Time to Complete**: 10 minutes

## Overview

This guide shows you how to add direct communication between Electron renderers and utility processes using electron-direct-ipc. You'll learn to:

1. Spawn and register a utility process from the main process
2. Set up DirectIpcUtility in the utility process
3. Send messages between renderers and utility processes
4. Use invoke/handle for request-response patterns

## Prerequisites

- Electron 39+ installed
- electron-direct-ipc 2.0+ installed
- Existing Electron app with DirectIpcMain initialized
- Basic familiarity with DirectIpcRenderer API

```bash
npm install electron-direct-ipc@^2.0.0
```

## Step 1: Create a Utility Process Script

Create a new file `utility-worker.js` for your background worker:

```javascript
// utility-worker.js
import { DirectIpcUtility } from 'electron-direct-ipc/utility'

// Define your message types (TypeScript example)
/** @typedef {{
 *   'result': (data: number) => void
 *   'status': (message: string) => void
 * }} Messages
 *
 * @typedef {{
 *   'compute': (data: number[]) => Promise<number>
 * }} Invokes
 */

// Create the DirectIpcUtility instance
const utility = DirectIpcUtility.instance({
  identifier: 'compute-worker',
  log: console,  // Optional: custom logger
})

// Listen for incoming messages
utility.on('compute-request', async (sender, data) => {
  console.log(`Received compute request from ${sender.identifier}:`, data)

  // Perform CPU-intensive work
  const result = heavyComputation(data)

  // Send result back to the sender
  await utility.send({ identifier: sender.identifier }, 'result', result)
})

// Handle invoke requests (RPC style)
utility.handle('compute', async (sender, numbers) => {
  console.log(`Processing compute invoke from ${sender.identifier}`)

  // This runs in the utility process (isolated from renderer)
  const sum = numbers.reduce((a, b) => a + b, 0)
  return sum
})

// Send periodic status updates
setInterval(async () => {
  await utility.send({ identifier: 'main-window' }, 'status', 'Worker alive')
}, 5000)

function heavyComputation(data) {
  // Simulate CPU-intensive work
  let result = 0
  for (let i = 0; i < 1000000; i++) {
    result += Math.sqrt(i) * data
  }
  return result
}

console.log('Utility worker ready!')
```

## Step 2: Spawn and Register from Main Process

In your main process, spawn the utility process and register it:

```javascript
// main.js
import { app, BrowserWindow, utilityProcess } from 'electron'
import { DirectIpcMain } from 'electron-direct-ipc/main'
import path from 'path'

// Initialize DirectIpcMain (if not already done)
DirectIpcMain.init()

app.whenReady().then(() => {
  // Create your main window
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  mainWindow.loadFile('index.html')

  // Spawn the utility process
  const worker = utilityProcess.fork(path.join(__dirname, 'utility-worker.js'))

  // Register with DirectIpcMain
  try {
    DirectIpcMain.instance().registerUtilityProcess('compute-worker', worker)
    console.log('Utility process registered successfully')
  } catch (error) {
    console.error('Failed to register utility process:', error)
  }

  // Optional: Handle worker exit
  worker.on('exit', (code) => {
    console.log(`Worker exited with code ${code}`)
  })
})

// Clean up on app quit
app.on('quit', () => {
  // DirectIpcMain automatically cleans up on utility process exit
})
```

## Step 3: Communicate from Renderer

In your renderer process, use DirectIpcRenderer to communicate with the utility process:

```javascript
// renderer.js
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'

// Define the same message types
/** @typedef {{
 *   'result': (data: number) => void
 *   'status': (message: string) => void
 * }} Messages
 *
 * @typedef {{
 *   'compute': (data: number[]) => Promise<number>
 * }} Invokes
 *
 * @typedef {'main-window' | 'compute-worker'} Identifiers
 */

// Get DirectIpcRenderer instance
const directIpc = DirectIpcRenderer.instance({
  identifier: 'main-window',
})

// Send a message to the utility process
async function sendComputeRequest(data) {
  await directIpc.send({ identifier: 'compute-worker' }, 'compute-request', data)
}

// Listen for results from the worker
directIpc.on('result', (sender, data) => {
  console.log(`Received result from ${sender.identifier}:`, data)
  document.getElementById('result').textContent = `Result: ${data}`
})

// Listen for status updates
directIpc.on('status', (sender, message) => {
  console.log(`Status from ${sender.identifier}:`, message)
  document.getElementById('status').textContent = message
})

// Invoke the worker (request-response pattern)
async function computeSum(numbers) {
  try {
    const result = await directIpc.invoke(
      { identifier: 'compute-worker' },
      'compute',
      numbers,
      { timeout: 5000 }  // 5 second timeout
    )
    console.log('Compute result:', result)
    return result
  } catch (error) {
    console.error('Compute failed:', error)
    throw error
  }
}

// Example: Trigger computation from UI
document.getElementById('compute-btn').addEventListener('click', async () => {
  const numbers = [1, 2, 3, 4, 5]

  // Method 1: Send message (fire-and-forget)
  await sendComputeRequest(42)

  // Method 2: Invoke (wait for result)
  const sum = await computeSum(numbers)
  console.log(`Sum of ${numbers} = ${sum}`)
})

// Check if utility process is available
directIpc.localEvents.on('map-updated', (map) => {
  const worker = map.find(t => t.identifier === 'compute-worker')
  if (worker) {
    console.log('Worker is available:', worker.processType)
    document.getElementById('worker-status').textContent = 'Connected'
  } else {
    console.log('Worker is not available')
    document.getElementById('worker-status').textContent = 'Disconnected'
  }
})
```

## Step 4: HTML UI (Optional)

Simple HTML to test the communication:

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Utility Process Demo</title>
</head>
<body>
  <h1>Electron Direct IPC - Utility Process Demo</h1>

  <div>
    <h2>Worker Status: <span id="worker-status">Connecting...</span></h2>
    <p id="status">Waiting for updates...</p>
  </div>

  <div>
    <button id="compute-btn">Compute Sum (1+2+3+4+5)</button>
    <p id="result"></p>
  </div>

  <script src="renderer.js"></script>
</body>
</html>
```

## TypeScript Usage

For full type safety, define your types once and share them:

```typescript
// types.ts
export type Messages = {
  'compute-request': (data: number) => void
  'result': (data: number) => void
  'status': (message: string) => void
}

export type Invokes = {
  'compute': (numbers: number[]) => Promise<number>
  'get-stats': () => Promise<{ processed: number; uptime: number }>
}

export type ProcessIds = 'main-window' | 'compute-worker' | 'renderer-2'
```

```typescript
// utility-worker.ts
import { DirectIpcUtility } from 'electron-direct-ipc/utility'
import type { Messages, Invokes, ProcessIds } from './types'

const utility = DirectIpcUtility.instance<Messages, Invokes, ProcessIds>({
  identifier: 'compute-worker',
})

utility.handle('compute', async (sender, numbers) => {
  // numbers is inferred as number[] ✅
  return numbers.reduce((a, b) => a + b, 0)  // return type checked as number ✅
})
```

```typescript
// renderer.ts
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'
import type { Messages, Invokes, ProcessIds } from './types'

const directIpc = DirectIpcRenderer.instance<Messages, Invokes, ProcessIds>({
  identifier: 'main-window',
})

// Fully type-safe!
const result = await directIpc.invoke(
  { identifier: 'compute-worker' },  // Type-checked against ProcessIds ✅
  'compute',  // Type-checked against Invokes keys ✅
  [1, 2, 3]  // Type-checked as number[] ✅
)
// result is inferred as number ✅
```

## Common Patterns

### Pattern 1: Error Handling

```javascript
// Utility process
utility.handle('risky-operation', async (sender, data) => {
  if (!data.valid) {
    throw new Error('Invalid data')
  }
  return processData(data)
})

// Renderer
try {
  const result = await directIpc.invoke(
    { identifier: 'compute-worker' },
    'risky-operation',
    data,
    { timeout: 3000 }
  )
} catch (error) {
  if (error.name === 'UtilityProcessTerminatedError') {
    console.error('Worker crashed!')
  } else if (error.message.includes('timeout')) {
    console.error('Operation timed out')
  } else {
    console.error('Handler threw error:', error.message)
  }
}
```

### Pattern 2: Lifecycle Management

```javascript
// Main process - graceful shutdown
app.on('before-quit', () => {
  const directIpcMain = DirectIpcMain.instance()

  // Get all utility processes
  const workers = directIpcMain.getUtilityProcesses()

  // Unregister and kill each one
  workers.forEach(id => {
    directIpcMain.unregisterUtilityProcess(id)
  })
})

// Renderer - handle worker disconnection
directIpc.localEvents.on('target-removed', (target) => {
  if (target.identifier === 'compute-worker') {
    console.warn('Worker disconnected!')
    // Disable UI, show error message, etc.
  }
})
```

### Pattern 3: Multiple Workers

```javascript
// Main process - spawn multiple workers
const workers = ['worker-1', 'worker-2', 'worker-3']

workers.forEach(id => {
  const worker = utilityProcess.fork('worker.js', [id])
  DirectIpcMain.instance().registerUtilityProcess(id, worker)
})

// Renderer - broadcast to all workers
await directIpc.send({ allIdentifiers: /^worker-/ }, 'start-processing', data)

// Or target specific worker
await directIpc.send({ identifier: 'worker-2' }, 'high-priority-task', data)
```

### Pattern 4: Throttled Updates

```javascript
// Utility worker - send high-frequency progress updates
let progress = 0
const intervalId = setInterval(() => {
  progress += 1
  // Throttled send - only latest value delivered per microtask
  utility.throttled.send({ identifier: 'main-window' }, 'progress', progress)

  if (progress >= 100) {
    clearInterval(intervalId)
  }
}, 10)  // 100 Hz update rate

// Renderer - receive throttled updates
directIpc.throttled.on('progress', (sender, value) => {
  // Called at most once per microtask (~1ms) with latest value
  updateProgressBar(value)
})
```

## Troubleshooting

### Worker Not Appearing in Map

**Problem**: `directIpc.getMap()` doesn't show the utility process

**Solution**:
1. Check that `registerUtilityProcess()` was called in main process
2. Verify the utility process didn't crash on startup
3. Check the worker script calls `DirectIpcUtility.instance()`
4. Wait for `'registration-complete'` event in utility process

```javascript
// In utility process
utility.localEvents.once('registration-complete', () => {
  console.log('Registration complete! Can now send messages.')
})
```

### Messages Not Received

**Problem**: Renderer sends messages but utility process doesn't receive them

**Solution**:
1. Ensure identifiers match exactly (case-sensitive)
2. Check that listener is registered before message is sent
3. Verify message channel name matches on both sides
4. Check for errors in console (both renderer and utility process)

### Invoke Timeout

**Problem**: `invoke()` calls timeout consistently

**Solution**:
1. Verify handler is registered: `utility.handle('channel-name', handler)`
2. Check handler doesn't throw uncaught exceptions
3. Increase timeout: `{ timeout: 10000 }`
4. Add logging in handler to verify it's being called

```javascript
utility.handle('slow-operation', async (sender, data) => {
  console.log('Handler called!')  // Add this
  const result = await doWork(data)
  console.log('Handler returning:', result)  // And this
  return result
})
```

## Next Steps

- **Learn More**: Read the [full API documentation](../README.md)
- **Advanced Patterns**: See [examples/utility-process](../examples/utility-process)
- **Performance Tuning**: Check [performance guide](../docs/performance.md)
- **Testing**: Learn to test utility process communication in [testing guide](../docs/testing.md)

## Related Documentation

- [Electron UtilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)
- [DirectIpcRenderer API](../README.md#directipcrenderer)
- [DirectIpcMain API](../README.md#directipcmain)
- [Type Safety Guide](../docs/type-safety.md)
