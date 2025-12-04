# Data Model: Utility Process Support

**Feature**: 001-utility-process-support
**Date**: 2025-12-03
**Purpose**: Define entities, state machines, and data structures for utility process communication

## Core Entities

### 1. ProcessType (Enum)

**Purpose**: Discriminate between different process types in the DirectIpc registry

**Values**:
```typescript
enum ProcessType {
  RENDERER = 'renderer',
  UTILITY = 'utility',
}
```

**Future Extensions** (deferred to later iterations):
- `CHILD_PROCESS = 'child_process'`
- `WEB_WORKER = 'web_worker'`
- `WORKER_THREAD = 'worker_thread'`

**Usage**: Used in `DirectIpcTarget.processType` field for type discrimination

**Validation Rules**:
- Must be one of the defined enum values
- Cannot be null or undefined

---

### 2. DirectIpcTarget (Extended Interface)

**Purpose**: Represents a communication endpoint (renderer or utility process)

**Fields**:
```typescript
interface DirectIpcTarget {
  identifier?: string           // Unique identifier (e.g., 'main-window', 'worker-1')
  webContentsId?: number         // Only for RENDERER type
  processType: ProcessType       // RENDERER or UTILITY
  url?: string                   // Only for RENDERER type
  pid?: number                   // Process ID (optional, for diagnostics)
}
```

**Relationships**:
- 1:1 with registry entry in `DirectIpcMain.registry`
- 1:N with MessagePort connections (one target can have ports to multiple peers)

**Validation Rules**:
- `identifier` must be unique across all process types in the registry
- `webContentsId` must be present if `processType === ProcessType.RENDERER`
- `webContentsId` must be absent if `processType === ProcessType.UTILITY`
- `url` only valid for renderers
- `pid` is optional diagnostic information

**State Transitions**:
```
[Not Registered]
    ↓ (registerUtilityProcess or renderer subscribe)
[Registered]
    ↓ (utility process exit or renderer close)
[Terminated]
```

---

### 3. UtilityProcessRegistration (Internal to DirectIpcMain)

**Purpose**: Track registered utility processes and their lifecycle

**Fields**:
```typescript
interface UtilityProcessRegistration {
  identifier: string
  process: UtilityProcess          // Electron's UtilityProcess instance
  target: DirectIpcTarget           // Public target info
  ports: Map<string, MessagePort>   // Connections to other processes
  pendingInvokes: Map<string, PendingInvoke>  // Active invoke requests
  registeredAt: number              // Timestamp (Date.now())
}
```

**Lifecycle**:
```
Created → Active → Terminating → Removed
```

**Cleanup on Termination**:
1. Close all ports in `ports` Map
2. Reject all pending invokes with `UtilityProcessTerminatedError`
3. Remove from `DirectIpcMain.registry`
4. Emit `'utility-process-exit'` event
5. Broadcast `MAP_UPDATE` to all processes

---

### 4. QueuedMessage (Internal to DirectIpcUtility)

**Purpose**: Store outbound messages during initialization before registration completes

**Fields**:
```typescript
interface QueuedMessage {
  target: TargetSelector           // Who to send to
  message: string                  // Message channel name
  args: unknown[]                  // Message arguments
  throttled: boolean               // Whether this is a throttled send
  timestamp: number                // When queued (for diagnostics)
}
```

**Queue Behavior**:
- FIFO (First In, First Out) ordering
- Unbounded size (assumption: initialization is fast, <1 second)
- Flushed atomically on registration complete
- Cleared on registration failure

**State Machine**:
```
[Message Created]
    ↓
[If not registered] → [Queued]
    ↓ (registration complete)
[Flushed] → [Sent via MessagePort]
```

---

### 5. RegistrationState (Internal to DirectIpcUtility)

**Purpose**: Track initialization state of utility process

**States**:
```typescript
enum RegistrationState {
  UNINITIALIZED = 'uninitialized',  // DirectIpcUtility created but not subscribed
  SUBSCRIBING = 'subscribing',      // SUBSCRIBE sent, waiting for MAP_UPDATE
  REGISTERED = 'registered',         // MAP_UPDATE received, ready to send
  FAILED = 'failed',                 // Registration failed or timed out
}
```

**State Transitions**:
```
UNINITIALIZED
    ↓ (DirectIpcUtility.instance() called, sends SUBSCRIBE)
SUBSCRIBING
    ↓ (MAP_UPDATE received with self in map)
REGISTERED
    ↓ (utility process terminates)
[No state - instance destroyed]

SUBSCRIBING
    ↓ (timeout or error)
FAILED
```

**Actions on State Change**:
- `UNINITIALIZED → SUBSCRIBING`: Start subscription handshake
- `SUBSCRIBING → REGISTERED`: Flush message queue, enable normal operation
- `SUBSCRIBING → FAILED`: Reject queued messages, emit error
- `REGISTERED → [destroyed]`: Clean up ports, cancel pending invokes

---

### 6. MessageChannelConnection (Conceptual Model)

**Purpose**: Represents a bidirectional MessagePort connection between two processes

**Fields** (not a concrete class, but a logical entity):
```typescript
// Stored in DirectIpcMain for tracking
interface ChannelPair {
  processA: string        // identifier of first process
  processB: string        // identifier of second process
  createdAt: number       // when channel was created
  messageCount?: number   // optional: for diagnostics/metrics
}
```

**Lifecycle**:
```
[Requested]
    ↓ (GET_PORT IPC from process A)
[Created]
    ↓ (MessageChannel constructed)
[Transferred]
    ↓ (port1 → processA, port2 → processB)
[Active]
    ↓ (either process terminates)
[Closed]
```

**Cleanup Triggers**:
- Process A terminates → port automatically closed by OS
- Process B terminates → port automatically closed by OS
- No manual cleanup needed (ports are GC'd)

---

### 7. PendingInvoke (Internal to DirectIpcRenderer and DirectIpcUtility)

**Purpose**: Track outgoing invoke requests awaiting response

**Fields**:
```typescript
interface PendingInvoke {
  requestId: string                    // UUID for matching response
  resolve: (result: unknown) => void   // Promise resolver
  reject: (error: Error) => void       // Promise rejecter
  timeout: NodeJS.Timeout              // Timeout timer
  sentAt: number                       // Timestamp for latency tracking
  channel: string                      // Invoke channel name
  target: string                       // Target process identifier
}
```

**State Machine**:
```
[Created]
    ↓ (invoke() called)
[Sent] → timeout running
    ↓ (response received OR timeout OR target terminates)
[Resolved/Rejected] → cleanup timeout
```

**Cleanup Scenarios**:
1. **Success**: Response received, resolve promise, clear timeout
2. **Timeout**: Reject with timeout error, remove from map
3. **Target terminated**: Reject with `UtilityProcessTerminatedError`, remove from map
4. **Sender terminated**: Cancel all pending invokes

---

## Relationships

### DirectIpcMain Registry
```
DirectIpcMain
    ├── registry: Map<identifier, DirectIpcTarget>
    │       ├── 'main-window' → { type: RENDERER, webContentsId: 1 }
    │       ├── 'worker-1' → { type: UTILITY, pid: 12345 }
    │       └── 'worker-2' → { type: UTILITY, pid: 12346 }
    │
    ├── utilityProcesses: Map<identifier, UtilityProcessRegistration>
    │       ├── 'worker-1' → { process: UtilityProcess, ports: Map, ... }
    │       └── 'worker-2' → { process: UtilityProcess, ports: Map, ... }
    │
    └── channelPairs: Map<pairKey, boolean>
            ├── '1-worker-1' → true
            └── 'worker-1-worker-2' → true
```

### DirectIpcUtility Instance
```
DirectIpcUtility (identifier='worker-1')
    ├── state: RegistrationState = REGISTERED
    ├── messageQueue: QueuedMessage[] = []
    ├── ports: Map<string, MessagePort>
    │       └── 'main-window' → MessagePort
    ├── pendingInvokes: Map<requestId, PendingInvoke>
    │       └── 'uuid-123' → { channel: 'getData', target: 'main-window', ... }
    └── handlers: Map<string, Function>
            └── 'processData' → (sender, data) => { ... }
```

---

## Data Flow Diagrams

### Registration Flow
```
Utility Process                   DirectIpcMain                    Renderer
      |                                 |                              |
      | 1. spawn()                      |                              |
      |<--------------------------------|                              |
      |                                 |                              |
      | 2. DirectIpcUtility.instance()  |                              |
      | state = SUBSCRIBING             |                              |
      |                                 |                              |
      | 3. SUBSCRIBE via parentPort     |                              |
      |-------------------------------->|                              |
      |                                 | 4. Add to registry           |
      |                                 | emit 'utility-added'         |
      |                                 |                              |
      |                       5. MAP_UPDATE broadcast                  |
      |<--------------------------------|----------------------------->|
      |                                 |                              |
      | 6. state = REGISTERED           |                              |
      | flushQueue()                    |                              |
      |                                 |                              |
```

### Message Flow (Renderer → Utility)
```
Renderer                          DirectIpcMain                    Utility Process
    |                                   |                                  |
    | 1. send({ id: 'worker-1' }, ...)  |                                  |
    | Check if port exists              |                                  |
    |                                   |                                  |
    | [No port] 2. GET_PORT             |                                  |
    |---------------------------------->| 3. Create MessageChannel         |
    |                                   | port1 → renderer                 |
    |                                   | port2 → utility                  |
    |                                   |                                  |
    | 4. Receive port1                  |                  5. Receive port2|
    |<----------------------------------|--------------------------------->|
    |                                   |                                  |
    | 6. port.postMessage(data)         |                                  |
    |------------------------------------------------------------------>|
    |                                   |                 7. Receive data  |
    |                                   |                 emit 'message'   |
```

### Invoke Flow (Renderer ↔ Utility)
```
Renderer                                                      Utility Process
    |                                                               |
    | 1. invoke({ id: 'worker-1' }, 'process', data)                |
    | Create PendingInvoke (requestId, timeout)                     |
    |                                                               |
    | 2. Send INVOKE message via MessagePort                        |
    |-------------------------------------------------------------->|
    |                                               3. Receive INVOKE|
    |                                               Call handler     |
    |                                               result = await fn|
    |                                                               |
    |                                4. Send INVOKE_RESPONSE        |
    |<--------------------------------------------------------------|
    |                                                               |
    | 5. Receive response                                           |
    | Match requestId → resolve(result)                             |
    | Clear timeout                                                 |
```

### Termination Flow
```
Utility Process                   DirectIpcMain                    Renderer
      |                                 |                              |
      | 1. process.exit() or crash      |                              |
      |                                 |                              |
      |                       2. 'exit' event fired                    |
      |                                 | 3. Remove from registry      |
      |                                 | Close ports                  |
      |                                 | Reject pending invokes       |
      |                                 | emit 'utility-exit'          |
      |                                 |                              |
      |                       4. MAP_UPDATE broadcast                  |
      |                                 |----------------------------->|
      |                                 |              5. Remove from  |
      |                                 |              cached map      |
      |                                 |              Reject any      |
      |                                 |              pending invokes |
```

---

## Validation Rules Summary

### Identifier Uniqueness
- **Rule**: No two processes (renderer or utility) can have the same identifier
- **Enforcement**: DirectIpcMain.registerUtilityProcess() throws `IdentifierConflictError`
- **Scope**: Global across all process types

### ProcessType Consistency
- **Rule**: `webContentsId` present ↔ `processType === RENDERER`
- **Enforcement**: Type guards and runtime validation
- **Error**: Invalid target configuration

### Message Queue Bounds
- **Rule**: Queue flushed within 5 seconds of registration start (soft limit)
- **Enforcement**: Diagnostic warning if queue not flushed in time
- **Rationale**: Catches stuck initialization

### Port Transfer
- **Rule**: MessagePort can only be transferred once
- **Enforcement**: Electron API throws if transfer attempted twice
- **Mitigation**: Cache port references, reuse existing connections

---

## Performance Characteristics

### Memory Footprint
- **DirectIpcUtility instance**: ~8KB (same as DirectIpcRenderer)
- **QueuedMessage**: ~200 bytes per queued message
- **PendingInvoke**: ~300 bytes per pending invoke
- **MessagePort**: ~1KB per connection

**Target**: 50 utility processes × 8KB = 400KB total (acceptable)

### Time Complexity
- **Identifier lookup**: O(1) (Map-based)
- **Message queue flush**: O(n) where n = queued messages (typically <10)
- **Port creation**: O(1) (one-time setup)
- **Message send**: O(1) (direct port.postMessage)

### Latency Targets
- **Registration handshake**: <50ms
- **Message send (after registration)**: <5ms
- **Invoke round-trip**: <10ms
- **Termination cleanup**: <100ms

---

## Data Model Version

**Version**: 1.0
**Last Updated**: 2025-12-03
**Breaking Changes**: None (new feature)

---

## Next Steps

1. ✅ Phase 0 Complete: Research findings documented
2. ✅ Phase 1 In Progress: Data model defined
3. ⏭️ Next: Generate API contracts (TypeScript interfaces)
4. ⏭️ Next: Create quickstart.md (developer onboarding example)
