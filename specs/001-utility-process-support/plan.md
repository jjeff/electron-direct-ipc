# Implementation Plan: Utility Process Support

**Branch**: `001-utility-process-support` | **Date**: 2025-12-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-utility-process-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Extend electron-direct-ipc to support bidirectional communication between Electron renderer processes and utility processes (UtilityProcess API) using the existing MessageChannel-based architecture. Main process registers utility processes with unique identifiers, utility processes queue outbound messages during initialization, and renderers communicate with utility processes using the same API pattern as renderer-to-renderer communication. The implementation must prevent race conditions, maintain type safety, support invoke/handle patterns, and isolate process-type-specific logic to enable future support for child processes, Web Workers, and Worker Threads.

## Technical Context

**Language/Version**: TypeScript 5.9+ (strict mode)
**Primary Dependencies**: Electron 39+ (UtilityProcess API), Node.js 24+
**Storage**: N/A (in-memory process registry and MessagePort connections)
**Testing**: Vitest (unit/integration), Playwright (E2E with Electron)
**Target Platform**: Electron applications (main process + renderer processes + utility processes)
**Project Type**: Single library (dual ESM/CJS output)
**Performance Goals**: <5ms message latency renderer↔utility, <10ms invoke round-trip, support 50+ concurrent utility processes
**Constraints**: No main process involvement after initial MessageChannel setup, message queuing during init must be lossless, 100% type safety for utility process messages
**Scale/Scope**: Library enhancement affecting 3 core classes (DirectIpcMain, DirectIpcRenderer base, new DirectIpcUtility class)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify compliance with [Electron Direct IPC Constitution](../../.specify/memory/constitution.md):

- [x] **Library-First Architecture**: Feature maintains single-purpose library focus, minimal dependencies
  - ✅ Extends existing library without new external dependencies
  - ✅ Uses Electron's built-in UtilityProcess API (part of Electron core)
  - ✅ Reuses MessageChannel pattern from renderer-to-renderer communication

- [x] **Type Safety**: Full TypeScript generics, no `any` types without justification
  - ✅ Will use same generic type patterns as DirectIpcRenderer (TMessages, TInvokes, TIdentifiers)
  - ✅ Process type discrimination via type guards (isUtilityProcess, isRenderer)
  - ✅ Full type inference for utility process messages, invoke arguments, and return types

- [x] **Test-Driven Development**: Tests written FIRST, fail before implementation, approved before coding
  - ✅ Test plan will be defined in tasks.md before implementation
  - ✅ Unit tests for message queuing, registration, and conflict detection
  - ✅ Integration tests for MessageChannel between renderer and utility process
  - ✅ E2E Playwright tests for full lifecycle (spawn, communicate, terminate)

- [x] **Performance**: No regressions in latency (<1ms non-throttled, ~1ms throttled), memory footprint maintained
  - ✅ Utility process communication uses same MessageChannel pattern (zero main process overhead after setup)
  - ✅ Message queuing during init adds minimal overhead (array operations only)
  - ✅ No impact on existing renderer-to-renderer performance
  - ⚠️ New DirectIpcUtility class will add ~8KB memory footprint per utility process (same as DirectIpcRenderer)

- [x] **API Stability**: Breaking changes justified, semantic versioning followed, migration guide provided
  - ✅ No breaking changes to existing DirectIpcRenderer or DirectIpcMain APIs
  - ✅ New exports: `./utility` for DirectIpcUtility class
  - ✅ DirectIpcMain gets new method: `registerUtilityProcess(identifier, process)` (additive change, MINOR version bump)
  - ✅ DirectIpcTarget interface extended with process type field (backward compatible via optional field)

*No principle violations. Feature aligns with all constitution requirements.*

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── common/
│   ├── DirectIpcCommunication.ts   # Extended: Add ProcessType enum, update DirectIpcTarget interface
│   ├── DirectIpcLogger.ts          # No changes
│   └── index.ts                    # Extended: Export ProcessType
├── main/
│   ├── DirectIpcMain.ts            # Extended: Add registerUtilityProcess(), utility process lifecycle tracking
│   └── index.ts                    # No changes
├── renderer/
│   ├── DirectIpcRenderer.ts        # No changes (utility processes reuse base communication logic)
│   ├── DirectIpcThrottled.ts       # No changes
│   └── index.ts                    # No changes
├── utility/                         # NEW: Utility process support
│   ├── DirectIpcUtility.ts         # NEW: Main class for utility process communication
│   ├── DirectIpcUtilityThrottled.ts # NEW: Throttled messaging for utility processes
│   └── index.ts                    # NEW: Public exports for utility process API
└── index.ts                        # Extended: Add comment about ./utility export

tests/
├── unit/
│   ├── DirectIpcMain.test.ts       # Extended: Add utility process registration tests
│   ├── DirectIpcUtility.test.ts    # NEW: Unit tests for DirectIpcUtility
│   └── message-queue.test.ts       # NEW: Test message queuing during initialization
├── integration/
│   ├── DirectIpc.integration.test.ts # Extended: Add renderer↔utility MessageChannel tests
│   └── utility-lifecycle.integration.test.ts # NEW: Utility process spawn/terminate tests
└── e2e/
    └── utility-process.spec.ts     # NEW: Playwright E2E tests for full utility process lifecycle

test-app/                           # Extended: Add utility process example
├── main.js                        # Extended: Spawn utility process, register with DirectIpcMain
├── utility-worker.js              # NEW: Example utility process script
└── renderer.html                  # Extended: Add UI to communicate with utility process
```

**Structure Decision**: Single library project. New `src/utility/` directory mirrors `src/renderer/` structure for consistency. Utility process classes parallel renderer classes (DirectIpcUtility ≈ DirectIpcRenderer, DirectIpcUtilityThrottled ≈ DirectIpcThrottled). Common interfaces in `src/common/` are extended to support process type discrimination.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No violations documented. All constitution principles satisfied.*

---

## Phase 0: Research Complete ✅

**Deliverable**: [research.md](research.md)

**Key Decisions Made**:
1. ✅ Electron UtilityProcess API (Electron 39+) chosen over child_process.fork
2. ✅ Message queuing strategy: FIFO queue with flush on registration complete
3. ✅ Process type discrimination: ProcessType enum in DirectIpcTarget interface
4. ✅ Registration handshake: Two-phase protocol (SUBSCRIBE → MAP_UPDATE confirmation)
5. ✅ MessageChannel transfer: Reuse existing DirectIpcMain pattern, adapt for postMessage
6. ✅ TypeScript generics: Same pattern as DirectIpcRenderer (TMessages, TInvokes, TIdentifiers)
7. ✅ Error handling: Specific error classes (IdentifierConflictError, UtilityProcessTerminatedError, etc.)
8. ✅ Lifecycle management: Auto-cleanup on utility process exit via 'exit' event
9. ✅ Testing strategy: 3-tier (unit, integration, E2E with Playwright)
10. ✅ Future extensibility: ProcessAdapter pattern (deferred to future iteration)

**Research Findings**: All technical unknowns resolved, implementation-ready

---

## Phase 1: Design & Contracts Complete ✅

**Deliverables**:
- ✅ [data-model.md](data-model.md) - Entities, state machines, relationships
- ✅ [contracts/types.ts](contracts/types.ts) - TypeScript API contracts
- ✅ [quickstart.md](quickstart.md) - Developer onboarding guide

**Key Artifacts**:

### Data Model
- **Entities**: ProcessType, DirectIpcTarget, UtilityProcessRegistration, QueuedMessage, RegistrationState, MessageChannelConnection, PendingInvoke
- **State Machines**: Registration flow, message queuing, invoke lifecycle, termination cleanup
- **Validation Rules**: Identifier uniqueness, ProcessType consistency, port transfer constraints

### API Contracts
- **New Exports**: `electron-direct-ipc/utility` with DirectIpcUtility and DirectIpcUtilityThrottled
- **Extended Classes**: DirectIpcMain gains `registerUtilityProcess()` and `unregisterUtilityProcess()`
- **New Types**: ProcessType enum, extended DirectIpcTarget, error classes
- **Type Safety**: Full generic inference for utility process messages and invokes

### Developer Experience
- **Quickstart Guide**: 10-minute onboarding with working examples
- **Common Patterns**: Error handling, lifecycle management, multiple workers, throttled updates
- **Troubleshooting**: Solutions for common issues (registration, messaging, timeouts)

---

## Constitution Check - Post-Design Review ✅

Re-verification after Phase 1 design:

- [x] **Library-First Architecture**: ✅ Confirmed
  - No new external dependencies introduced
  - Clean API separation (`/utility` export path)
  - Reuses existing MessageChannel infrastructure

- [x] **Type Safety**: ✅ Confirmed
  - API contracts define full TypeScript generics
  - Type guards for process discrimination (isRenderer, isUtilityProcess)
  - No `any` types in public API surface

- [x] **Test-Driven Development**: ✅ Planned
  - Test strategy documented in research.md
  - Unit tests for queuing, registration, error handling
  - Integration tests for MessageChannel communication
  - E2E tests for full lifecycle (will be defined in tasks.md)

- [x] **Performance**: ✅ Confirmed
  - Design maintains <5ms message latency (same MessageChannel pattern)
  - Message queue adds minimal overhead (array operations only)
  - DirectIpcUtility ~8KB per instance (same as DirectIpcRenderer)
  - No impact on existing renderer-to-renderer performance

- [x] **API Stability**: ✅ Confirmed
  - Zero breaking changes to existing APIs
  - New exports: `./utility` (additive)
  - DirectIpcMain extended with new methods (backward compatible)
  - DirectIpcTarget interface extended with optional field

**Final Status**: All principles satisfied. Ready for Phase 2 (Task Generation).

---

## Implementation Readiness

**Status**: ✅ **READY FOR `/speckit.tasks` COMMAND**

**Completed Phases**:
- ✅ Phase 0: Research (10 decisions documented)
- ✅ Phase 1: Data model, API contracts, quickstart guide
- ✅ Constitution check passed (pre and post-design)

**Next Steps**:
1. Run `/speckit.tasks` to generate implementation task list
2. Review and approve test plan (TDD requirement)
3. Begin implementation following task order

**Artifacts Created**:
- `specs/001-utility-process-support/plan.md` (this file)
- `specs/001-utility-process-support/research.md`
- `specs/001-utility-process-support/data-model.md`
- `specs/001-utility-process-support/contracts/types.ts`
- `specs/001-utility-process-support/quickstart.md`

**Not Created** (Phase 2 - `/speckit.tasks` command):
- `specs/001-utility-process-support/tasks.md`
