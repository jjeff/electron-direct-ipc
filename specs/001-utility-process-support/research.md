# Research: Utility Process Support

**Feature**: 001-utility-process-support
**Date**: 2025-12-03
**Status**: Complete

## Purpose

This document consolidates research findings for extending electron-direct-ipc to support Electron UtilityProcess communication. The research addresses technical unknowns, best practices, and design decisions needed for implementation.

## Key Technical Decisions

### 1. Electron UtilityProcess API Compatibility

**Decision**: Use Electron's UtilityProcess API (available in Electron 22+, stable in Electron 39+)

**Rationale**:
- Native Electron API designed specifically for background Node.js tasks
- Similar IPC mechanisms to renderer processes (process.parentPort for MessagePort)
- Built-in lifecycle management (spawn, exit events, kill methods)
- Sandboxing capabilities for security-sensitive operations
- Documentation: https://www.electronjs.org/docs/latest/api/utility-process

**Alternatives Considered**:
- **child_process.fork()**: More generic, but requires manual IPC setup and lacks Electron-specific integration
  - Rejected: UtilityProcess is the recommended Electron approach, better documented for Electron use cases
- **Node.js Worker Threads**: In-process threading, different communication model
  - Rejected: Deferred to future iteration (User Story 5 explicitly calls for future Worker Thread support)

**Key API Surface**:
```typescript
// Electron's UtilityProcess API (from 'electron' in main process)
import { utilityProcess } from 'electron'

const child = utilityProcess.fork(modulePath, args, options)
child.postMessage(data)  // Send to utility process
child.on('message', (data) => {})  // Receive from utility process
child.on('exit', (code) => {})  // Lifecycle events
child.kill()  // Terminate

// Inside utility process script (Node.js environment)
import { MessagePortMain } from 'electron'
process.parentPort.postMessage(data)  // Send to main
process.parentPort.on('message', (e) => {})  // Receive from main
```

**Implementation Impact**:
- DirectIpcMain needs to handle utilityProcess instances (different from BrowserWindow)
- Message passing to/from utility process goes through `process.parentPort` instead of `ipcRenderer`
- Need to create MessageChannel and transfer one port to utility process via `postMessage`

---

### 2. Message Queuing Strategy During Initialization

**Decision**: Implement in-memory FIFO queue in DirectIpcUtility, flush on registration complete event

**Rationale**:
- Non-blocking: Utility process can initialize other resources while queuing messages
- Prevents message loss: All messages guaranteed to be delivered in order
- Simple implementation: Array-based queue with flush on registration event
- Aligns with spec clarification: "Queue messages during initialization and flush them after registration completes (non-blocking)"

**Alternatives Considered**:
- **Blocking send operations**: Use async/await to block until registration
  - Rejected: Could cause deadlocks if registration depends on async operations
- **Fail immediately**: Throw error if send() called before registration
  - Rejected: Poor developer experience, requires manual coordination

**Implementation Pattern**:
```typescript
class DirectIpcUtility {
  private messageQueue: QueuedMessage[] = []
  private isRegistered = false

  async send(target, message, ...args) {
    if (!this.isRegistered) {
      this.messageQueue.push({ target, message, args })
      return
    }
    // Normal send logic
  }

  private onRegistrationComplete() {
    this.isRegistered = true
    this.flushQueue()
  }

  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const { target, message, args } = this.messageQueue.shift()
      this.send(target, message, ...args)
    }
  }
}
```

---

### 3. Process Type Discrimination Strategy

**Decision**: Extend DirectIpcTarget interface with optional `processType` field, use TypeScript discriminated unions

**Rationale**:
- Backward compatible: Existing code without processType continues working (defaults to 'renderer')
- Type-safe: TypeScript can narrow types based on processType field
- Minimal changes: Only affects DirectIpcTarget interface and DirectIpcMain registry

**Alternatives Considered**:
- **Separate registries for renderers and utility processes**: Two Map<> instances
  - Rejected: Complicates identifier uniqueness checks and map broadcasts
- **Use webContentsId for discrimination**: Utility processes don't have webContentsId
  - Rejected: Would require synthetic IDs, error-prone

**Implementation Pattern**:
```typescript
// In src/common/DirectIpcCommunication.ts
export enum ProcessType {
  RENDERER = 'renderer',
  UTILITY = 'utility',
  // Future: CHILD_PROCESS = 'child_process', WEB_WORKER = 'web_worker', etc.
}

export interface DirectIpcTarget {
  identifier?: string
  webContentsId?: number  // Only for renderers
  processType: ProcessType  // New field
  url?: string  // Only for renderers
  // ... other fields
}

// Type guards
export function isRenderer(target: DirectIpcTarget): boolean {
  return target.processType === ProcessType.RENDERER
}

export function isUtilityProcess(target: DirectIpcTarget): boolean {
  return target.processType === ProcessType.UTILITY
}
```

---

### 4. Registration Handshake Protocol

**Decision**: Two-phase handshake with registration confirmation event

**Rationale**:
- Prevents race conditions: Utility process cannot send until main confirms registration
- Simple protocol: Single request-response pattern
- Leverages existing patterns: Similar to renderer SUBSCRIBE/MAP_UPDATE pattern

**Alternatives Considered**:
- **Implicit registration**: Utility process appears in map immediately when spawn() called
  - Rejected: Violates spec requirement to prevent messages before registration complete
- **Polling-based**: Utility process polls for registration status
  - Rejected: Inefficient, adds unnecessary latency

**Protocol Flow**:
```
1. Main process spawns UtilityProcess
2. Main process calls DirectIpcMain.registerUtilityProcess(id, process)
3. Main sends UTILITY_REGISTER message to utility process via parentPort
4. Utility process receives UTILITY_REGISTER, creates DirectIpcUtility instance
5. DirectIpcUtility subscribes to DirectIpcMain (like renderer does)
6. Main confirms subscription, sends MAP_UPDATE
7. DirectIpcUtility marks isRegistered=true, flushes queued messages
```

**New IPC Channel**:
```typescript
// In src/common/DirectIpcCommunication.ts
export const DIRECT_IPC_CHANNELS = {
  SUBSCRIBE: 'direct-ipc:subscribe',
  UPDATE_IDENTIFIER: 'direct-ipc:update-identifier',
  GET_PORT: 'direct-ipc:get-port',
  MAP_UPDATE: 'direct-ipc:map-update',
  PORT_MESSAGE: 'direct-ipc:port-message',
  UTILITY_REGISTER: 'direct-ipc:utility-register',  // NEW
  UTILITY_READY: 'direct-ipc:utility-ready',  // NEW
}
```

---

### 5. MessageChannel Transfer Mechanism

**Decision**: Reuse existing DirectIpcMain MessageChannel creation, adapt for utility process postMessage

**Rationale**:
- Proven pattern: Same MessageChannel approach as renderer-to-renderer
- Zero main process overhead: After channel setup, direct peer-to-peer communication
- Electron API support: MessagePortMain can be transferred via postMessage

**Alternatives Considered**:
- **Separate IPC channel per utility process**: No MessageChannel, route through main
  - Rejected: Defeats core value proposition of library (bypass main process)

**Implementation Pattern**:
```typescript
// In DirectIpcMain
handleGetPort(senderId: number, targetId: number, isUtility: boolean) {
  const channel = new MessageChannelMain()

  if (isUtility) {
    // Transfer port to utility process
    const utilityProcess = this.utilityProcesses.get(targetId)
    utilityProcess.postMessage({ type: 'PORT', port: channel.port1 }, [channel.port1])
  } else {
    // Transfer port to renderer (existing logic)
    webContents.fromId(targetId).postMessage('PORT', null, [channel.port1])
  }

  return channel.port2  // Return to requester
}
```

---

### 6. TypeScript Generics Strategy

**Decision**: Reuse same generic type pattern as DirectIpcRenderer (TMessages, TInvokes, TIdentifiers)

**Rationale**:
- Familiar API: Developers already know DirectIpcRenderer pattern
- Full type inference: Utility process messages have same type safety as renderer messages
- Unified type system: Same message type definitions can be shared across process types

**Implementation Example**:
```typescript
// In application code
type MyMessages = {
  'compute': (data: number[]) => void
  'result': (value: number) => void
}

type MyInvokes = {
  'process-data': (input: string) => Promise<ProcessedData>
}

type ProcessIds = 'worker-1' | 'worker-2' | 'main-renderer'

// In utility process
const utility = DirectIpcUtility.instance<MyMessages, MyInvokes, ProcessIds>({
  identifier: 'worker-1'
})

// In renderer
const renderer = DirectIpcRenderer.instance<MyMessages, MyInvokes, ProcessIds>({
  identifier: 'main-renderer'
})

// Fully typed communication
await renderer.send({ identifier: 'worker-1' }, 'compute', [1, 2, 3])  // ✅ Type-safe
const result = await renderer.invoke({ identifier: 'worker-1' }, 'process-data', 'input')  // ✅ Returns ProcessedData
```

---

### 7. Error Handling Strategy

**Decision**: Use specific error classes with diagnostic information, emit error events on localEvents

**Rationale**:
- Debuggability: Specific errors help developers understand what went wrong
- Observability: Error events integrate with existing localEvents pattern
- Consistency: Matches existing DirectIpcRenderer error handling

**Error Classes**:
```typescript
export class UtilityProcessNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Utility process not found: ${identifier}`)
    this.name = 'UtilityProcessNotFoundError'
  }
}

export class UtilityProcessTerminatedError extends Error {
  constructor(identifier: string) {
    super(`Process terminated unexpectedly: ${identifier}`)
    this.name = 'UtilityProcessTerminatedError'
  }
}

export class IdentifierConflictError extends Error {
  constructor(identifier: string, existingType: ProcessType) {
    super(`Identifier "${identifier}" already in use by ${existingType}`)
    this.name = 'IdentifierConflictError'
  }
}
```

---

### 8. Lifecycle Management Pattern

**Decision**: DirectIpcMain subscribes to utility process 'exit' event, broadcasts map update on termination

**Rationale**:
- Automatic cleanup: No manual cleanup required from application code
- Consistent with renderer lifecycle: Renderers are also automatically removed on window close
- Fail-fast for pending invokes: Immediately reject pending operations

**Implementation Pattern**:
```typescript
// In DirectIpcMain
registerUtilityProcess(identifier: string, process: UtilityProcess) {
  // Check for conflicts
  if (this.registry.has(identifier)) {
    throw new IdentifierConflictError(identifier, this.registry.get(identifier).processType)
  }

  // Register
  this.registry.set(identifier, {
    identifier,
    processType: ProcessType.UTILITY,
    process,
  })

  // Listen for exit
  process.on('exit', () => {
    this.handleUtilityProcessExit(identifier)
  })

  // Broadcast map update
  this.broadcastMapUpdate()
}

private handleUtilityProcessExit(identifier: string) {
  // Remove from registry
  this.registry.delete(identifier)

  // Clean up MessagePorts
  this.cleanupPortsForProcess(identifier)

  // Broadcast update
  this.broadcastMapUpdate()

  // Emit event
  this.emit('utility-process-exit', identifier)
}
```

---

### 9. Testing Strategy

**Decision**: Three-tier testing approach (unit, integration, E2E)

**Rationale**:
- Unit tests: Fast feedback, test queuing logic, registration, error handling in isolation
- Integration tests: Test MessageChannel communication without full Electron
- E2E tests: Full Electron environment with Playwright for real-world scenarios

**Test Coverage Plan**:

**Unit Tests** (Vitest with mocks):
- Message queuing and flushing logic
- Identifier conflict detection
- Error class instantiation
- Type guards (isRenderer, isUtilityProcess)

**Integration Tests** (Vitest with MessageChannel API):
- MessageChannel communication between mock processes
- Invoke/handle request-response pattern
- Throttled message coalescing
- Port cleanup on process termination

**E2E Tests** (Playwright + Electron):
- Spawn utility process, register, send message from renderer
- Invoke utility process handler, verify result
- Crash utility process mid-invoke, verify error propagation
- Multiple utility processes with distinct identifiers
- Utility process sends to renderer

**Performance Tests** (benchmarks in E2E):
- Message latency renderer→utility (<5ms target)
- Invoke round-trip time (<10ms target)
- Concurrent utility processes (50 processes target)
- Memory footprint per DirectIpcUtility instance (~8KB target)

---

### 10. Future Extensibility Design

**Decision**: Abstract process-specific logic behind ProcessAdapter interface

**Rationale**:
- Enables future process types: child_process, Web Workers, Worker Threads
- Isolates differences: IPC mechanism, lifecycle events, port transfer
- Minimal core changes: DirectIpcMain and base communication logic remain stable

**Adapter Pattern** (for future implementation):
```typescript
// src/common/ProcessAdapter.ts (future)
interface ProcessAdapter {
  readonly type: ProcessType
  sendMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): void
  transferPort(port: MessagePortMain): void
  onExit(handler: (code: number) => void): void
  kill(): void
}

class UtilityProcessAdapter implements ProcessAdapter {
  constructor(private process: UtilityProcess) {}

  readonly type = ProcessType.UTILITY

  sendMessage(message: unknown) {
    this.process.postMessage(message)
  }

  onMessage(handler: (message: unknown) => void) {
    this.process.on('message', handler)
  }

  transferPort(port: MessagePortMain) {
    this.process.postMessage({ port }, [port])
  }

  onExit(handler: (code: number) => void) {
    this.process.on('exit', handler)
  }

  kill() {
    this.process.kill()
  }
}

// Future: ChildProcessAdapter, WebWorkerAdapter, etc.
```

---

## Best Practices Applied

### Electron UtilityProcess Best Practices
1. **Use for CPU-intensive tasks**: Image processing, data transformation, cryptography
2. **Avoid for simple IPC**: Renderers should communicate directly where possible
3. **Handle crashes gracefully**: Utility processes can crash independently, don't take down main
4. **Limit process count**: Each utility process has overhead (~10-20MB), monitor resource usage
5. **Use sandboxing when needed**: Enable `sandbox: true` for untrusted code execution

### MessageChannel Best Practices
1. **Transfer ownership**: Port is transferred, not cloned (structured clone)
2. **One-time transfer**: Cannot transfer same port twice
3. **Automatic cleanup**: Ports are GC'd when process exits
4. **Bidirectional**: Both peers can send/receive on their port

### TypeScript Best Practices
1. **Discriminated unions**: Use `processType` field for type narrowing
2. **Generic constraints**: Constrain TIdentifiers to string for autocomplete
3. **Branded types**: Consider branded types for identifiers to prevent mixing

### Testing Best Practices
1. **Mock sparingly**: Use real MessageChannel in integration tests
2. **Test failure modes**: Crashes, timeouts, conflicts
3. **Snapshot types**: Use TypeScript's type testing utilities
4. **E2E for critical paths**: Full Electron environment catches platform-specific issues

---

## Risk Assessment

### Low Risk
- ✅ MessageChannel API stability (well-established, same as renderer-to-renderer)
- ✅ TypeScript type safety (proven pattern from DirectIpcRenderer)
- ✅ Test coverage (TDD approach mitigates implementation bugs)

### Medium Risk
- ⚠️ **Initialization race conditions**: Message queue must be robust
  - **Mitigation**: Extensive unit tests for queue logic, E2E tests for timing
- ⚠️ **Identifier namespace conflicts**: Utilities and renderers share identifier space
  - **Mitigation**: Explicit error on conflict, clear documentation

### High Risk
- 🔴 **Electron version compatibility**: UtilityProcess API evolving
  - **Mitigation**: Document minimum Electron version (39+), test against multiple versions
  - **Fallback**: Gracefully degrade or error if UtilityProcess unavailable

---

## Implementation Readiness

**Status**: ✅ Ready for Phase 1 (Design & Contracts)

**Resolved Unknowns**:
- ✅ Electron UtilityProcess API compatibility confirmed
- ✅ Message queuing strategy defined (FIFO queue)
- ✅ Process type discrimination strategy (ProcessType enum)
- ✅ Registration handshake protocol designed
- ✅ MessageChannel transfer mechanism validated
- ✅ TypeScript generics strategy (reuse DirectIpcRenderer pattern)
- ✅ Error handling strategy (specific error classes + events)
- ✅ Lifecycle management pattern (auto-cleanup on exit)
- ✅ Testing strategy (3-tier: unit, integration, E2E)
- ✅ Future extensibility design (ProcessAdapter pattern deferred)

**Next Steps**:
1. Phase 1: Create data-model.md (entities and state machines)
2. Phase 1: Generate API contracts in /contracts/
3. Phase 1: Create quickstart.md (developer onboarding example)
4. Phase 2: Generate tasks.md with TDD-ordered implementation tasks
