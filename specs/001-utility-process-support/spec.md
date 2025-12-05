# Feature Specification: Utility Process Support

**Feature Branch**: `001-utility-process-support`
**Created**: 2025-12-03
**Status**: Draft
**Input**: User description: "electron-utility-process
Let's extend this library to work with Electron UtilityProcesses https://www.electronjs.org/docs/latest/api/utility-process so Electron renderer processes can talk directoy to utilityProcess instances. These processes will probably need to be added "manually" through a method on DirectIpcMain in which we can add the child process and give it an identifier.. Then (I'm guessing), we'll need to create another class akin to DirectIpcRenderer (DirectIpcUtility? DirectIpcChildProcess? DirectIpcWorker?) that we can add into the utility process to handle setup and communication. We'll need to ensure somehow that there aren't race conditions where our utility-process instance is sending messages before the child has been added to the DirectIpcMain instance. The docs say UtilityProcess works basically the same as child_process.fork(). Maybe we could use the same class to handle communicating from both of these. Eventually, I want to add other types of processes and sub-processes (web workers, node worker threads, etc). So if there's anything that could be done during this implementation that could accommodate that eventuality, that would be helpful."

## Clarifications

### Session 2025-12-03

- Q: Should utility processes queue outbound messages during initialization, or should send operations block (wait) until registration completes? → A: Queue messages during initialization and flush them after registration completes (non-blocking)
- Q: When a utility process attempts to register with an identifier that's already in use, what should happen? → A: Reject registration with an error and require the caller to provide a unique identifier
- Q: When a renderer sends a message to a utility process that is still initializing (not yet fully registered), what should happen? → A: Reject immediately with an error indicating the target is not ready
- Q: When a utility process crashes while processing an invoke request, what error should be returned to the caller? → A: Process terminated unexpectedly
- Q: What level of diagnostic logging or events should the system provide for troubleshooting communication issues? → A: Emit lifecycle events (registration, termination) and error events, with optional debug-level message tracing via the pluggable logger

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enable Direct Renderer-to-UtilityProcess Communication (Priority: P1)

Application developers need to establish direct communication channels between Electron renderer processes and utility processes for offloading CPU-intensive work, background tasks, or isolated operations without routing messages through the main process.

**Why this priority**: This is the foundational capability that enables all other utility process features. Without the ability to establish communication, no other scenarios are possible.

**Independent Test**: Can be fully tested by creating a utility process, registering it with DirectIpcMain, and successfully sending a message from a renderer to the utility process and receiving a response.

**Acceptance Scenarios**:

1. **Given** a utility process has been created and registered with a unique identifier, **When** a renderer sends a message to that utility process identifier, **Then** the utility process receives the message with correct arguments and sender information
2. **Given** multiple utility processes are registered with different identifiers, **When** a renderer targets a specific utility process by identifier, **Then** only the targeted utility process receives the message
3. **Given** a utility process has been registered, **When** the renderer queries the process map, **Then** the utility process appears in the list with its identifier, process type, and connection status

---

### User Story 2 - Request-Response Communication with Utility Processes (Priority: P2)

Developers need to invoke functions in utility processes and receive computed results, enabling use cases like data processing, encryption/decryption, file operations, or database queries performed in isolation.

**Why this priority**: After basic messaging (P1), request-response is the next most valuable pattern for practical applications. It builds on P1 and enables synchronous-style interactions.

**Independent Test**: Can be tested by setting up a handler in a utility process that performs a calculation or data transformation, invoking it from a renderer, and verifying the correct result is returned within the expected timeout.

**Acceptance Scenarios**:

1. **Given** a utility process has registered a handler for a specific channel, **When** a renderer invokes that channel with arguments, **Then** the handler executes and returns the result to the requesting renderer within the timeout period
2. **Given** a utility process handler throws an error, **When** a renderer invokes that handler, **Then** the renderer receives a rejected promise with the error message
3. **Given** a renderer invokes a utility process, **When** the utility process takes longer than the specified timeout, **Then** the invoke call fails with a timeout error

---

### User Story 3 - Graceful Utility Process Lifecycle Management (Priority: P3)

Applications need to safely start, stop, and restart utility processes while ensuring all active communication channels are cleaned up properly and renderers are notified when utility processes become unavailable.

**Why this priority**: Lifecycle management is important for production stability but builds upon the basic communication established in P1 and P2. Applications can function without dynamic lifecycle management initially.

**Independent Test**: Can be tested by creating a utility process with active connections, terminating the process, and verifying that all ports are cleaned up and renderers receive map updates reflecting the removed process.

**Acceptance Scenarios**:

1. **Given** a utility process is registered and connected to multiple renderers, **When** the utility process terminates (gracefully or crashes), **Then** DirectIpcMain detects the termination, removes it from the registry, and broadcasts an updated map to all renderers
2. **Given** a renderer has pending invoke requests to a utility process, **When** the utility process terminates, **Then** all pending invokes are rejected with an appropriate error
3. **Given** a utility process has been terminated, **When** a renderer attempts to send a message to it, **Then** the renderer receives an error indicating the target process is unavailable

---

### User Story 4 - Prevent Race Conditions During Initialization (Priority: P2)

Developers need assurance that utility processes cannot send messages to renderers or other processes before they are fully registered in the DirectIpcMain coordinator, preventing message loss or undefined behavior.

**Why this priority**: Critical for reliability and predictable behavior. Race conditions can cause hard-to-debug issues in production. This should be addressed early alongside P1.

**Independent Test**: Can be tested by spawning a utility process that attempts to send messages immediately during initialization, and verifying those messages are either queued until registration completes or that the utility process blocks until registration is confirmed.

**Acceptance Scenarios**:

1. **Given** a utility process is created but not yet registered, **When** the utility process attempts to send a message, **Then** the message is queued internally until registration completes
2. **Given** a utility process is in the process of being registered, **When** registration completes successfully, **Then** all queued messages are flushed and delivered in order
3. **Given** a utility process completes its initialization handshake with DirectIpcMain, **When** the utility process sends a message immediately after, **Then** the message is delivered successfully without loss

---

### User Story 5 - Support Future Process Types with Minimal Changes (Priority: P3)

The architecture should accommodate adding support for child processes (child_process.fork), Web Workers, and Node.js Worker Threads in the future without requiring major refactoring of the core communication abstractions.

**Why this priority**: This is a forward-looking architectural consideration. While important for long-term maintainability, it doesn't deliver immediate user value and can be validated through code review rather than runtime testing.

**Independent Test**: Can be validated through architectural review by verifying that process-type-specific logic is isolated behind abstractions that can accommodate different process communication mechanisms (MessagePort, IPC, postMessage).

**Acceptance Scenarios**:

1. **Given** the DirectIpc architecture includes process-agnostic communication interfaces, **When** a new process type needs to be added, **Then** the new type can be integrated by implementing adapters for its specific communication mechanism without modifying core message routing logic
2. **Given** utility processes use a generalized process coordinator, **When** extending to support child processes, **Then** the same coordinator can manage both process types with minimal duplication
3. **Given** process-specific initialization logic is separated from communication logic, **When** adding support for Web Workers or Worker Threads, **Then** only the initialization and transport layers need to be implemented

---

### Edge Cases

- What happens when a renderer attempts to communicate with a utility process that is still initializing? → Utility processes only appear in the map after registration completes, so renderers cannot target unregistered processes
- How does the system handle a utility process that crashes while processing an invoke request? → Pending invoke is rejected with error "Process terminated unexpectedly"
- What happens when a utility process is registered with an identifier that already exists? → Registration is rejected with an error
- How does the system behave when the maximum number of MessageChannel connections is reached?
- What happens when a utility process sends messages to a renderer that has been destroyed?
- How does the system handle utility processes created before DirectIpcMain.init() is called?
- What happens when multiple utility processes attempt to register with the same identifier simultaneously?
- How does invoke timeout handling work when a utility process is slow to respond versus completely unresponsive?
- What happens when a utility process exits gracefully versus crashes unexpectedly?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow main process to register utility processes with unique identifiers in the DirectIpc coordinator
- **FR-002**: System MUST queue outbound messages from utility processes during initialization and flush them in order after registration completes
- **FR-003**: System MUST establish bidirectional MessageChannel communication between renderers and utility processes
- **FR-004**: System MUST allow renderers to send typed messages to utility processes using the same API pattern as renderer-to-renderer communication
- **FR-005**: System MUST allow utility processes to send messages to renderers using process identifiers or webContentsId
- **FR-006**: System MUST support invoke/handle request-response pattern between renderers and utility processes
- **FR-007**: System MUST include utility processes in the DirectIpc process map only after registration completes successfully
- **FR-008**: System MUST detect when utility processes terminate and remove them from the registry
- **FR-009**: System MUST broadcast map updates to all renderers when utility processes are added or removed
- **FR-010**: System MUST clean up all MessagePort connections when a utility process terminates
- **FR-011**: System MUST reject pending invoke requests with error "Process terminated unexpectedly" when the target utility process terminates
- **FR-012**: System MUST reject registration attempts with an error when a utility process identifier is already in use by another renderer or utility process
- **FR-013**: System MUST provide full TypeScript type safety for messages sent to and from utility processes
- **FR-014**: System MUST support both throttled and non-throttled messaging patterns for utility processes
- **FR-015**: System MUST provide a mechanism for utility processes to confirm successful registration before allowing outbound communication
- **FR-016**: System MUST expose events for utility process lifecycle changes (process added, process removed) and communication errors
- **FR-017**: System MUST support optional debug-level logging of message send/receive operations via the existing pluggable logger interface
- **FR-018**: System MUST isolate process-type-specific logic to enable future support for other process types (child processes, Web Workers, Worker Threads)

### Key Entities

- **Utility Process Registration**: Represents a utility process in the DirectIpc coordinator with attributes including process identifier, process type (utility process vs child process), process ID, communication state, and associated MessagePorts
- **Process Coordinator**: Extended version of DirectIpcMain that manages both renderer processes and utility processes, tracks registration state, and coordinates MessageChannel creation across process boundaries
- **Utility Process Communicator**: New class (parallel to DirectIpcRenderer) that provides send/receive/invoke/handle capabilities within a utility process, handles registration handshake, and enforces initialization order
- **Process Map Entry**: Extended target information that includes process type indicator to distinguish between renderer windows and utility/child processes in the shared map
- **Registration Handshake**: Protocol for confirming utility process registration completion before allowing message transmission, preventing initialization race conditions

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can send messages from any renderer to a registered utility process with message delivery latency under 5ms
- **SC-002**: Developers can invoke functions in utility processes and receive results with round-trip time under 10ms for simple operations
- **SC-003**: System correctly cleans up all resources when a utility process terminates, with no memory leaks detected after 100 start/stop cycles
- **SC-004**: Registration handshake prevents message loss with 100% reliability across 1000 rapid initialization tests
- **SC-005**: Type safety eliminates runtime type errors for messages to utility processes, with compile-time detection of type mismatches
- **SC-006**: Adding support for a new process type (child_process.fork) requires changes to fewer than 3 core files
- **SC-007**: Utility process crashes do not impact renderer stability, with all pending operations cleanly failed within 1 second of process termination
- **SC-008**: System handles at least 50 concurrent utility processes with distinct identifiers without performance degradation

## Assumptions

- Utility processes are spawned and managed by the application's main process, not created automatically by DirectIpc
- Utility processes can load Node.js modules and use standard Node.js APIs (since they run in a Node environment)
- The MessagePort API works consistently between renderer-to-renderer and renderer-to-utility-process scenarios
- Applications using utility processes accept the architectural constraint that utility processes cannot directly communicate with each other without routing through a renderer or main process
- Electron's UtilityProcess API stability is sufficient for production use (following Electron documentation)
- The existing MessageChannel-based architecture can be extended to utility processes without fundamental changes
- Process identifiers are unique across both renderers and utility processes within a single application instance
- Applications will handle utility process crashes and restarts at the application level, with DirectIpc providing cleanup and notification primitives

## Out of Scope

- Automatic spawning or lifecycle management of utility processes (application responsibility)
- Direct utility-process-to-utility-process communication without an intermediary
- Support for Web Workers, Worker Threads, or other process types in this iteration (future enhancement)
- Load balancing or automatic failover for utility process pools
- Persistence of utility process state across restarts
- Sandboxing or permission management for utility process capabilities
- Cross-application utility process sharing
- Backwards compatibility with Electron versions that do not support UtilityProcess API
