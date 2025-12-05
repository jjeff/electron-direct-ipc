[![npm version](https://img.shields.io/npm/v/electron-direct-ipc.svg)](https://www.npmjs.com/package/electron-direct-ipc)
[![npm downloads](https://img.shields.io/npm/dm/electron-direct-ipc.svg)](https://www.npmjs.com/package/electron-direct-ipc)
[![CI](https://github.com/jjeff/electron-direct-ipc/actions/workflows/ci.yml/badge.svg)](https://github.com/jjeff/electron-direct-ipc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Package Format](https://img.shields.io/badge/package-ESM%20%7C%20CJS-orange.svg)](https://github.com/jjeff/electron-direct-ipc)
[![API Docs](https://img.shields.io/badge/API%20Docs-TypeDoc-informational.svg)](https://jjeff.github.io/electron-direct-ipc/)
[![npm provenance](https://img.shields.io/badge/provenance-OIDC-success.svg)](https://docs.npmjs.com/generating-provenance-statements)

# Electron Direct IPC

**Type-safe, high-performance inter-process communication for Electron applications**

Electron Direct IPC provides direct renderer-to-renderer communication via MessageChannel, bypassing the main process for improved performance and reduced latency. It's modeled after Electron's ipcRenderer/ipcMain API for familiarity. With full TypeScript support (including send/receive and invoke/handle message/argument/return types), automatic message coalescing, and a clean API, it's designed for real-time applications that need fast, reliable IPC.

## Features

- 🚀 **Direct Communication** - Renderers communicate via MessageChannel, bypassing main process
- 🔒 **Type-Safe** - Full TypeScript generics for compile-time safety
- ⚡ **High Performance** - Microtask-based throttling for high-frequency updates
- 🎯 **Flexible Targeting** - Send by identifier, webContentsId, or URL pattern
- 🔄 **Bidirectional** - Request/response with async invoke/handle pattern
- 📡 **Event-Driven** - Built on EventEmitter with automatic lifecycle management
- 📦 **Dual Format** - Works with both ESM (`import`) and CommonJS (`require`)
- 🔧 **Utility Process Support** - Full communication with Electron UtilityProcess workers
- 🧪 **Well Tested** - Comprehensive unit, integration, and E2E tests with full coverage

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [DirectIpcRenderer](#directipcrenderer)
  - [DirectIpcThrottled](#directipcthrottled)
  - [DirectIpcMain](#directipcmain)
  - [DirectIpcUtility](#directipcutility)
- [Usage Patterns](#usage-patterns)
- [Performance Guide](#performance-guide)
- [Testing](#testing)
- [Architecture](#architecture)
- [Migration Guide](#migration-guide)

## Installation

```bash
npm install electron-direct-ipc
```

## Quick Start

### 1. Set up the main process

```typescript
// main.ts
import { DirectIpcMain } from 'electron-direct-ipc/main'

DirectIpcMain.init()

// That's it! DirectIpcMain handles all the coordination automatically
```

### 2. Define your message types (optional but recommended for TypeScript)

```typescript
// types.ts
type MyMessages = {
  'user-action': (action: 'play' | 'pause' | 'stop', value: number) => void
  'position-update': (x: number, y: number) => void
  'volume-change': (level: number) => void
}

type MyInvokes = {
  'get-user': (userId: string) => Promise<{ id: string; name: string }>
  calculate: (a: number, b: number) => Promise<number>
}

type WindowIds = 'controller' | 'output' | 'thumbnails'
```

### 3. Use in renderer processes

```typescript
// controller-renderer.ts
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'

// This adds the types to the singleton instance
// and sets this renderer's identifier to 'controller'
const directIpc = DirectIpcRenderer.instance<MyMessages, MyInvokes, WindowIds>({
  identifier: 'controller',
})

// Send a message with multiple arguments
await directIpc.send({ identifier: 'output' }, 'user-action', 'play', 42)

// Send high-frequency updates (throttled)
for (let i = 0; i < 1000; i++) {
  directIpc.throttled.send({ identifier: 'output' }, 'position-update', i, i)
}
// Throttling coalesces - only the last position (999, 999) is actually sent!
```

```typescript
// output-renderer.ts
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'

const directIpc = DirectIpcRenderer.instance<MyMessages, MyInvokes, WindowIds>({
  identifier: 'output',
})

// Listen for messages
directIpc.on('user-action', (sender, action, value) => {
  console.log(`${sender.identifier} sent action: ${action} with value: ${value}`)
})

// Listen for high-frequency updates (throttled)
directIpc.throttled.on('position-update', (sender, x, y) => {
  // Called at most once per microtask with latest values
  updateUI(x, y)
})

// Handle invoke requests
directIpc.handle('get-user', async (sender, userId) => {
  const user = await database.getUser(userId)
  return { id: user.id, name: user.name }
})

// Invoke another renderer
const result = await directIpc.invoke({ identifier: 'controller' }, 'calculate', 5, 10)
console.log(result) // 15
```

## Core Concepts

### MessageChannel-Based Communication

DirectIPC uses the Web [MessageChannel API](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) for direct communication between renderers. The main process coordinates the initial connection, then gets out of the way:

```
Renderer A                Main Process              Renderer B
    |                          |                         |
    |---GET_PORT('output')---->|                         |
    |    creates MessageChannel and distributes ports    |
    |<----PORT_MESSAGE---------|                         |
    |                          |-----PORT_MESSAGE------->|
    |                          |                         |
    |<=============MessageChannel established===========>|
    |                          |                         |
    |-----------------------messages-------------------->|
    |<----------------------messages---------------------|
                   (main process not involved)
```

### Targeting Modes

DirectIPC uses a `TargetSelector` object to specify which renderer(s) to communicate with. This provides a clean, consistent API across all send and invoke operations.

**Single Target Selectors** - Send to one renderer (throws if multiple match):

```typescript
// By identifier (best for readability)
await directIpc.send({ identifier: 'output' }, 'play')

// By webContentsId (best for precision)
await directIpc.send({ webContentsId: 5 }, 'play')

// By URL pattern (best for dynamic windows)
await directIpc.send({ url: /^settings:\/\// }, 'theme-changed', 'dark')
```

**Multi-Target Selectors** - Broadcast to all matching renderers:

```typescript
// Send to all renderers matching identifier pattern
await directIpc.send({ allIdentifiers: /^output/ }, 'broadcast-message', 'data')

// Send to all renderers matching URL pattern
await directIpc.send({ allUrls: /^settings:/ }, 'theme-changed', 'dark')
```

**Note:** The `invoke()` method only supports single-target selectors, as it expects a single response.

### Throttled vs Non-Throttled

DirectIPC provides two communication modes:

**Non-Throttled (default)** - Every message is delivered

```typescript
// Every message sent
directIpc.send({ identifier: 'output' }, 'button-clicked')
```

**Throttled** - Only latest value per microtask is delivered (lossy)

```typescript
// Only the last value (999) is sent
for (let i = 0; i < 1000; i++) {
  directIpc.throttled.send({ identifier: 'output' }, 'position', i)
}
```

### Type Safety

DirectIPC uses TypeScript generics to ensure compile-time type safety:

```typescript
// Define your types
type Messages = {
  'position-update': (x: number, y: number) => void
}

// Get full autocomplete and type checking
directIpc.send({ identifier: 'output' }, 'position-update', 10, 20) // ✅
directIpc.send({ identifier: 'output' }, 'position-update', '10', '20') // ❌ Type error!
directIpc.send({ identifier: 'output' }, 'wrong-channel', 10, 20) // ❌ Type error!

// Listeners are also type-safe
directIpc.on('position-update', (sender, x, y) => {
  // x and y are inferred as numbers
  const sum: number = x + y // ✅
})
```

## API Reference

### DirectIpcRenderer

Main class for renderer process communication.

#### Constructor & Singleton

```typescript
// Singleton pattern (recommended)
const directIpc = DirectIpcRenderer.instance<TMessages, TInvokes, TIdentifiers>({
  identifier: 'my-window',
  log: customLogger,
})

// For testing (creates new instance)
const directIpc = DirectIpcRenderer._createInstance<TMessages, TInvokes, TIdentifiers>(
  { identifier: 'test-window' },
  { ipcRenderer: mockIpcRenderer }
)
```

#### Sending Messages

```typescript
// Unified send method with TargetSelector
await directIpc.send<K extends keyof TMessages>(
  target: TargetSelector<TIdentifiers>,
  message: K,
  ...args: Parameters<TMessages[K]>
): Promise<void>

// TargetSelector types:
type TargetSelector<TId extends string> =
  | { identifier: TId | RegExp }           // Single target by identifier
  | { webContentsId: number }              // Single target by webContentsId
  | { url: string | RegExp }               // Single target by URL
  | { allIdentifiers: TId | RegExp }       // Broadcast to all matching identifiers
  | { allUrls: string | RegExp }           // Broadcast to all matching URLs

// Examples:
await directIpc.send({ identifier: 'output' }, 'play')
await directIpc.send({ webContentsId: 5 }, 'play')
await directIpc.send({ url: /^settings:/ }, 'theme-changed', 'dark')
await directIpc.send({ allIdentifiers: /^output/ }, 'broadcast', 'data')
await directIpc.send({ allUrls: /^settings:/ }, 'update', 'value')
```

#### Receiving Messages

```typescript
// Register listener
directIpc.on<K extends keyof TMessages>(
  event: K,
  listener: (sender: DirectIpcTarget, ...args: Parameters<TMessages[K]>) => void
): this

// Remove listener
directIpc.off<K extends keyof TMessages>(
  event: K,
  listener: Function
): this
```

#### Invoke/Handle Pattern

```typescript
// Register handler (receiver)
directIpc.handle<K extends keyof TInvokes>(
  channel: K,
  handler: (sender: DirectIpcTarget, ...args: Parameters<TInvokes[K]>) => ReturnType<TInvokes[K]>
): void

// Unified invoke method with TargetSelector (single targets only)
const result = await directIpc.invoke<K extends keyof TInvokes>(
  target: Omit<TargetSelector<TIdentifiers>, 'allIdentifiers' | 'allUrls'>,
  channel: K,
  ...args: [...Parameters<TInvokes[K]>, options?: InvokeOptions]
): Promise<Awaited<ReturnType<TInvokes[K]>>>

// Examples:
const result = await directIpc.invoke({ identifier: 'output' }, 'calculate', 5, 10)
const result = await directIpc.invoke({ webContentsId: 5 }, 'getData')
const result = await directIpc.invoke({ url: /^output/ }, 'process', data)

// With timeout option
const result = await directIpc.invoke(
  { identifier: 'output' },
  'calculate',
  5,
  10,
  { timeout: 5000 }
)
```

#### Utility Methods

```typescript
// Get current renderer map
directIpc.getMap(): DirectIpcTarget[]

// Get this renderer's identifier
directIpc.getMyIdentifier(): TIdentifiers | undefined

// Set this renderer's identifier
directIpc.setIdentifier(identifier: TIdentifiers): void

// Resolve target to webContentsId
directIpc.resolveTargetToWebContentsId(target: {
  webContentsId?: number
  identifier?: TIdentifiers | RegExp
  url?: string | RegExp
}): number | undefined

// Refresh renderer map
await directIpc.refreshMap(): Promise<void>

// Configure timeout
directIpc.setDefaultTimeout(ms: number): void
directIpc.getDefaultTimeout(): number

// Clean up
directIpc.closeAllPorts(): void
directIpc.clearPendingInvokes(): void
```

#### Events (localEvents)

```typescript
// Listen for internal DirectIpc events
directIpc.localEvents.on('target-added', (target: DirectIpcTarget) => {})
directIpc.localEvents.on('target-removed', (target: DirectIpcTarget) => {})
directIpc.localEvents.on('map-updated', (map: DirectIpcTarget[]) => {})
directIpc.localEvents.on('message-port-added', (target: DirectIpcTarget) => {})
directIpc.localEvents.on('message', (sender: DirectIpcTarget, message: unknown) => {})
```

### DirectIpcThrottled

Accessed via `directIpc.throttled` property. Provides lossy message coalescing for high-frequency updates.

#### When to Use Throttled

✅ **Use throttled when:**

- Sending high-frequency state updates (position, volume, progress)
- Only the latest value matters (replaceable state)
- Experiencing backpressure (sender faster than receiver)
- UI updates that can safely skip intermediate frames

❌ **Don't use throttled when:**

- Every message is unique and important
- Messages represent discrete events
- Order matters for correctness
- Need guaranteed delivery

#### Throttled API

All send/receive methods available, same signatures as DirectIpcRenderer:

```typescript
// Send throttled
directIpc.throttled.send({ identifier: 'output' }, 'position', x, y)
directIpc.throttled.send({ webContentsId: 5 }, 'volume', level)
directIpc.throttled.send({ url: /output/ }, 'progress', percent)

// Receive throttled
directIpc.throttled.on('position', (sender, x, y) => {
  // Called at most once per microtask
})

// Proxy methods (non-throttled)
directIpc.throttled.handle('get-data', async (sender, id) => data)
await directIpc.throttled.invoke({ identifier: 'output' }, 'calculate', a, b)

// Access underlying directIpc
directIpc.throttled.directIpc.send({ identifier: 'output' }, 'important-event')

// Access localEvents
directIpc.throttled.localEvents.on('target-added', (target) => {})
```

#### How Throttling Works

**Send-side coalescing:**

```typescript
// In one event loop tick:
directIpc.throttled.send({ identifier: 'output' }, 'position', 1, 1)
directIpc.throttled.send({ identifier: 'output' }, 'position', 2, 2)
directIpc.throttled.send({ identifier: 'output' }, 'position', 3, 3)

// Only position (3, 3) is sent on next microtask (~1ms later)
// Messages to different targets/channels are NOT coalesced
```

**Receive-side coalescing:**

```typescript
// Renderer receives many messages in one tick
// Internal handler queues them all
// Listeners called once per microtask with latest values

directIpc.throttled.on('position', (sender, x, y) => {
  console.log(x, y) // Only prints latest value
})
```

### DirectIpcMain

Coordinates MessageChannel connections between renderers.

```typescript
import { DirectIpcMain } from 'electron-direct-ipc/main'

// Create singleton instance
const directIpcMain = new DirectIpcMain({
  log: customLogger, // optional
})

// That's it! DirectIpcMain automatically:
// - Tracks all renderer windows
// - Creates MessageChannels when renderers request connections
// - Broadcasts map updates when windows open/close
// - Cleans up when windows close
```

**No manual coordination needed!** DirectIpcMain handles everything automatically.

### DirectIpcUtility

For communication with Electron [UtilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) workers. Use utility processes for CPU-intensive tasks that would block the renderer.

#### Setup

**1. Create a utility process worker:**

```typescript
// utility-worker.ts
import { DirectIpcUtility } from 'electron-direct-ipc/utility'

// Define message types (same pattern as renderer)
type WorkerMessages = {
  'compute-result': (result: number) => void
  progress: (percent: number) => void
}

type WorkerInvokes = {
  'heavy-computation': (numbers: number[]) => Promise<number>
  'get-stats': () => Promise<{ uptime: number; processed: number }>
}

// Create instance with identifier
const utility = DirectIpcUtility.instance<WorkerMessages, WorkerInvokes>({
  identifier: 'compute-worker',
})

// Listen for messages from renderers
utility.on('compute-request', async (sender, data) => {
  const result = performHeavyWork(data)
  await utility.send({ identifier: sender.identifier! }, 'compute-result', result)
})

// Handle invoke requests (RPC style)
utility.handle('heavy-computation', async (sender, numbers) => {
  return numbers.reduce((a, b) => a + b, 0)
})

// Send high-frequency updates with throttling
utility.throttled.send({ identifier: 'main-window' }, 'progress', 50)
```

**2. Spawn and register from main process:**

```typescript
// main.ts
import { utilityProcess } from 'electron'
import { DirectIpcMain } from 'electron-direct-ipc/main'

const directIpcMain = DirectIpcMain.init()

// Spawn the utility process
const worker = utilityProcess.fork('utility-worker.js')

// Register with DirectIpcMain
directIpcMain.registerUtilityProcess('compute-worker', worker)

// Handle worker exit
worker.on('exit', (code) => {
  console.log(`Worker exited with code ${code}`)
})
```

**3. Communicate from renderer:**

```typescript
// renderer.ts
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'

const directIpc = DirectIpcRenderer.instance({ identifier: 'main-window' })

// Send message to utility process
await directIpc.send({ identifier: 'compute-worker' }, 'compute-request', 42)

// Invoke utility process handler
const result = await directIpc.invoke(
  { identifier: 'compute-worker' },
  'heavy-computation',
  [1, 2, 3, 4, 5]
)

// Listen for results from utility process
directIpc.on('compute-result', (sender, result) => {
  console.log(`Result from ${sender.identifier}: ${result}`)
})
```

#### DirectIpcUtility API

```typescript
// Singleton pattern (same as DirectIpcRenderer)
const utility = DirectIpcUtility.instance<TMessages, TInvokes, TIdentifiers>({
  identifier: 'my-worker',
  log: customLogger,
  defaultTimeout: 30000,
  registrationTimeout: 5000,
})

// Send messages (same API as DirectIpcRenderer)
await utility.send({ identifier: 'renderer' }, 'message-name', ...args)
await utility.send({ webContentsId: 5 }, 'message-name', ...args)
await utility.send({ allIdentifiers: /^renderer-/ }, 'broadcast', data)

// Receive messages
utility.on('channel', (sender, ...args) => {})
utility.off('channel', listener)

// Invoke/Handle pattern
utility.handle('channel', async (sender, ...args) => result)
const result = await utility.invoke({ identifier: 'target' }, 'channel', ...args)

// Throttled messaging (same API as DirectIpcRenderer)
utility.throttled.send({ identifier: 'renderer' }, 'position', x, y)
utility.throttled.on('position', (sender, x, y) => {})

// Registration lifecycle
utility.getRegistrationState() // 'uninitialized' | 'subscribing' | 'registered' | 'failed'
utility.localEvents.on('registration-complete', () => {})
utility.localEvents.on('registration-failed', (error) => {})
```

#### Registration States

DirectIpcUtility goes through a registration lifecycle when starting:

| State           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `uninitialized` | Instance created, registration not started               |
| `subscribing`   | Registration sent, waiting for main process confirmation |
| `registered`    | Ready for communication                                  |
| `failed`        | Registration timed out or failed                         |

Messages sent before registration completes are automatically queued and flushed once registered.

## Usage Patterns

### Pattern 1: Simple Messaging

```typescript
// Sender
await directIpc.send({ identifier: 'output' }, 'play-button-clicked')

// Receiver
directIpc.on('play-button-clicked', (sender) => {
  playbackEngine.play()
})
```

### Pattern 2: State Updates

```typescript
// Sender (high-frequency updates)
videoPlayer.on('timeupdate', (currentTime) => {
  directIpc.throttled.send({ identifier: 'controller' }, 'playback-position', currentTime)
})

// Receiver
directIpc.throttled.on('playback-position', (sender, position) => {
  seekBar.update(position)
})
```

### Pattern 3: Request-Response

```typescript
// Receiver (set up handler)
directIpc.handle('get-project-data', async (sender, projectId) => {
  const project = await database.getProject(projectId)
  return {
    id: project.id,
    name: project.name,
    songs: project.songs,
  }
})

// Sender (invoke handler)
try {
  const project = await directIpc.invoke(
    { identifier: 'controller' },
    'get-project-data',
    'project-123',
    { timeout: 5000 } // 5 second timeout
  )
  console.log(project.name)
} catch (error) {
  console.error('Failed to get project:', error)
}
```

### Pattern 4: Broadcast

```typescript
// Send to all windows matching pattern
await directIpc.send({ allIdentifiers: /output-.*/ }, 'theme-changed', 'dark')

// Send to all windows with specific URL
await directIpc.send({ allUrls: /^settings:\/\// }, 'preference-updated', 'volume', 75)
```

### Pattern 5: Mixed Throttled/Non-Throttled

```typescript
// High-frequency position updates (throttled)
directIpc.throttled.on('cursor-position', (sender, x, y) => {
  cursor.moveTo(x, y)
})

// Important user actions (NOT throttled)
directIpc.on('cursor-click', (sender, button, x, y) => {
  handleClick(button, x, y)
})
```

### Pattern 6: Error Handling

```typescript
// Handle invoke errors
directIpc.handle('risky-operation', async (sender, data) => {
  if (!isValid(data)) {
    throw new Error('Invalid data')
  }
  return await performOperation(data)
})

// Caller handles rejection
try {
  const result = await directIpc.invoke({ identifier: 'worker' }, 'risky-operation', myData)
} catch (error) {
  console.error('Operation failed:', error.message)
}
```

### Pattern 7: Dynamic Window Discovery

```typescript
// Get all available renderers
const targets = directIpc.getMap()
console.log(
  'Available windows:',
  targets.map((t) => t.identifier)
)

// Listen for new windows
directIpc.localEvents.on('target-added', (target) => {
  console.log(`New window: ${target.identifier}`)

  // Send welcome message
  directIpc.send({ webContentsId: target.webContentsId }, 'welcome')
})

// Listen for windows closing
directIpc.localEvents.on('target-removed', (target) => {
  console.log(`Window closed: ${target.identifier}`)
})
```

### Pattern 8: Utility Process Communication

```typescript
// Main process - spawn and register utility worker
import { utilityProcess } from 'electron'
import { DirectIpcMain } from 'electron-direct-ipc/main'

const directIpcMain = DirectIpcMain.init()
const worker = utilityProcess.fork('heavy-worker.js')
directIpcMain.registerUtilityProcess('heavy-worker', worker)

// Utility process - handle CPU-intensive work
import { DirectIpcUtility } from 'electron-direct-ipc/utility'

const utility = DirectIpcUtility.instance({ identifier: 'heavy-worker' })

utility.handle('process-data', async (sender, data) => {
  // Heavy computation runs in isolated process
  const result = expensiveOperation(data)
  return result
})

// Send progress updates back to renderer
utility.throttled.send({ identifier: 'main-window' }, 'progress', 75)

// Renderer - offload work to utility process
const result = await directIpc.invoke(
  { identifier: 'heavy-worker' },
  'process-data',
  largeDataset,
  { timeout: 30000 }
)

// Listen for progress from utility process
directIpc.throttled.on('progress', (sender, percent) => {
  updateProgressBar(percent)
})
```

## Performance Guide

### Choosing Throttled vs Non-Throttled

**Use regular `directIpc` for:**

- User actions (clicks, keypresses)
- State changes (song changed, clip added)
- Commands (play, pause, stop)
- Discrete events that must all be delivered

**Use `directIpc.throttled` for:**

- Mouse/cursor position (60+ Hz)
- Playback position (30-60 Hz)
- Volume levels (real-time)
- Progress bars (real-time)
- Any replaceable state where only latest value matters

### Latency Characteristics

| Method                      | Latency | Delivery            | Use Case         |
| --------------------------- | ------- | ------------------- | ---------------- |
| `directIpc.send*`           | ~0ms    | Guaranteed          | Events, commands |
| `directIpc.throttled.send*` | ~1ms    | Lossy (latest only) | State updates    |
| `directIpc.invoke*`         | ~1-5ms  | Guaranteed          | RPC calls        |

### Memory Usage

DirectIPC is designed to be lightweight:

- DirectIpcRenderer: ~8KB per instance
- DirectIpcUtility: ~8KB per instance
- DirectIpcThrottled: ~2KB per instance (auto-created)
- MessageChannel: ~1KB per connection
- Pending messages: O(channels × targets)

### Benchmarks

On a modern laptop (M1 MacBook):

| Metric | Result |
|--------|--------|
| Send 1000 non-throttled messages | ~8ms |
| Send 1000 throttled messages | ~0.5ms (only 1 delivered) |
| Invoke round-trip | ~0.05ms average |
| Connect new renderer | ~25ms (includes MessageChannel setup) |
| Throughput | ~23,000 invokes/sec |

### DirectIPC vs Traditional IPC

The real benefit of DirectIPC is **renderer-to-renderer communication**. Traditional Electron IPC requires routing through the main process:

```
Traditional: renderer1 → ipcMain → renderer2 (relay pattern)
DirectIPC:   renderer1 → renderer2 (direct MessageChannel)
```

| Operation | Traditional IPC | DirectIPC | Speedup |
|-----------|-----------------|-----------|---------|
| Send 1000 msgs (r1 → r2) | ~50ms | ~4ms | **~14x faster** |
| Invoke round-trip (r1 ↔ r2) | ~0.10ms | ~0.05ms | **~2x faster** |

**Note:** For renderer → main communication only (no relay), traditional `ipcRenderer.invoke` is slightly faster (~0.05ms) since it doesn't involve MessageChannel overhead. DirectIPC shines when you need direct renderer-to-renderer or renderer-to-utility communication.

Run `npm run test:e2e:benchmark` to validate these on your machine.

## Testing

DirectIPC includes comprehensive test utilities.

### Unit Testing

```typescript
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer'
import { describe, it, expect, vi } from 'vitest'

describe('My component', () => {
  it('should send message when button clicked', async () => {
    const mockIpcRenderer = {
      on: vi.fn(),
      invoke: vi.fn().mockResolvedValue([]),
    }

    const directIpc = DirectIpcRenderer._createInstance(
      { identifier: 'test' },
      { ipcRenderer: mockIpcRenderer as any }
    )

    // Spy on send method
    const spy = vi.spyOn(directIpc, 'send').mockResolvedValue()

    // Test your code
    await myComponent.onClick()

    expect(spy).toHaveBeenCalledWith('output', 'play-clicked')
  })
})
```

### Integration Testing

See [DirectIpc.integration.test.ts](tests/DirectIpc.integration.test.ts) for examples of testing full renderer-to-renderer communication with MessageChannel.

### E2E Testing with Playwright

The project includes 21 comprehensive E2E tests covering window-to-window communication, throttled messaging, and page reload scenarios. See [tests/e2e/example.spec.ts](tests/e2e/example.spec.ts) for the full test suite.

```typescript
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('renderer communication', async () => {
  const app = await electron.launch({ args: ['main.js'] })

  // Get windows
  const controller = await app.firstWindow()
  const output = await app.waitForEvent('window')

  // Trigger action in controller
  await controller.click('#play-button')

  // Verify message received in output
  const isPlaying = await output.evaluate(() => {
    return window.playbackState === 'playing'
  })

  expect(isPlaying).toBe(true)

  await app.close()
})
```

## Architecture

### Overview

```mermaid
graph TB
    subgraph Main["Main Process"]
        DIM[DirectIpcMain<br/>• Tracks all renderer windows<br/>• Tracks utility processes<br/>• Creates MessageChannels on demand<br/>• Broadcasts map updates]
    end

    subgraph RendererA["Renderer A (e.g., Controller)"]
        DIRA[DirectIpcRenderer<br/>• Message sending<br/>• Event receiving<br/>• Invoke/handle]
        THROT_A[.throttled<br/>• Coalescing]
        DIRA --- THROT_A
    end

    subgraph RendererB["Renderer B (e.g., Output)"]
        DIRB[DirectIpcRenderer<br/>• Message sending<br/>• Event receiving<br/>• Invoke/handle]
        THROT_B[.throttled<br/>• Coalescing]
        DIRB --- THROT_B
    end

    subgraph UtilityProc["Utility Process (e.g., Worker)"]
        DIRU[DirectIpcUtility<br/>• Message sending<br/>• Event receiving<br/>• Invoke/handle]
        THROT_U[.throttled<br/>• Coalescing]
        DIRU --- THROT_U
    end

    DIM -.IPC Setup.-> DIRA
    DIM -.IPC Setup.-> DIRB
    DIM -.IPC Setup.-> DIRU
    DIRA <==MessageChannel<br/>Direct Connection==> DIRB
    DIRA <==MessageChannel<br/>Direct Connection==> DIRU
    DIRB <==MessageChannel<br/>Direct Connection==> DIRU
```

### Message Flow

```mermaid
sequenceDiagram
    participant Controller as Controller Renderer
    participant Main as Main Process<br/>(DirectIpcMain)
    participant Output as Output Renderer

    Note over Controller,Output: 1. Connection Setup (first message only)
    Controller->>Main: IPC: GET_PORT for 'output'
    Main->>Main: Create MessageChannel
    Main-->>Controller: IPC: Transfer port1
    Main-->>Output: IPC: Transfer port2
    Note over Controller,Output: Ports are cached for future use

    rect rgb(240, 248, 255)
        Note over Controller,Output: 2. Direct Messaging (Main process NOT involved)
        Controller->>Output: MessageChannel: port.postMessage(data)
        Output->>Output: Listener called immediately
    end

    rect rgb(255, 250, 240)
        Note over Controller,Output: 3. Throttled Messaging (Main process NOT involved)
        loop High-frequency updates
            Controller->>Controller: Queue message locally
        end
        Controller->>Output: MessageChannel: Flush on microtask (latest only)
        Output->>Output: Coalesce & call listeners once
    end

    rect rgb(240, 255, 240)
        Note over Controller,Output: 4. Invoke/Handle Pattern (Main process NOT involved)
        Controller->>Output: MessageChannel: invoke('get-data', args)
        Output->>Output: Call handler
        Output-->>Controller: MessageChannel: Return result
    end

    Note over Controller,Output: 5. Cleanup (Main detects and notifies)
    Output->>Output: Window closes
    Main->>Main: Detect close
    Main-->>Controller: IPC: Broadcast map update
    Controller->>Controller: Clean up cached port
```

**Key Points:**

1. **Connection Setup** - One-time overhead (~10ms) to establish MessageChannel
2. **Message Sending** - Direct port communication bypasses main process (near-zero overhead)
3. **Message Receiving** - Non-throttled calls listeners immediately; throttled coalesces per microtask
4. **Cleanup** - Automatic when windows close

### Design Decisions

**Why MessageChannel?**

- Zero main process overhead after setup
- Native browser API (well-tested, performant)
- Supports structured clone algorithm
- Automatic cleanup when windows close

**Why microtask-based throttling?**

- Predictable ~1ms latency
- Natural coalescing boundary (one tick)
- No timers needed (more efficient)
- Works with React's batching

**Why singleton pattern?**

- One DirectIpcRenderer/DirectIpcUtility per process
- Prevents duplicate port connections
- Centralized lifecycle management
- Easier debugging

**Why utility process support?**

- Offload CPU-intensive work from renderers
- Keep UI responsive during heavy computation
- Same familiar API as DirectIpcRenderer
- Automatic registration and lifecycle management

## Migration Guide

### From Electron IPC

```typescript
// Before (Electron IPC via main)
ipcRenderer.send('message-to-output', data)
ipcMain.on('message-to-output', (event, data) => {
  outputWindow.webContents.send('message', data)
})

// After (DirectIPC)
await directIpc.send({ identifier: 'output' }, 'message', data)
directIpc.on('message', (sender, data) => {
  // handle message
})
```

### From Custom IPC Solutions

If you have a custom IPC system:

1. Define your message/invoke maps
2. Replace send calls with `directIpc.send*`
3. Replace listeners with `directIpc.on`
4. Replace RPC with `directIpc.invoke*` and `directIpc.handle`
5. Remove main process coordination code (DirectIpcMain handles it)

### Breaking Changes from v1.x

- `DirectIpcThrottled` now accessed via `directIpc.throttled` (auto-created)
- Constructor is now private (use singleton `.instance()` or `._createInstance()`)
- Some method signatures changed for better type safety

## Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and releases. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. See our [Semantic Release Guide](SEMANTIC_RELEASE.md) for details.

## License

MIT © Jeff Robbins

## Links

- [GitHub Repository](https://github.com/jjeff/electron-direct-ipc)
- [Issue Tracker](https://github.com/jjeff/electron-direct-ipc/issues)
- [API Documentation](https://jjeff.github.io/electron-direct-ipc)
