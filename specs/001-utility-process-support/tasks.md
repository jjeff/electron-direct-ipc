# Tasks: Utility Process Support

**Input**: Design documents from `/specs/001-utility-process-support/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/types.ts, quickstart.md

**Tests**: Test tasks are included per TDD requirement from project constitution (Principle III)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Library structure: `src/common/`, `src/main/`, `src/renderer/`, `src/utility/` (new)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and extend existing structure for utility process support

- [ ] T001 Create `src/utility/` directory structure per plan.md
- [ ] T002 [P] Create `tests/unit/DirectIpcUtility.test.ts` skeleton
- [ ] T003 [P] Create `tests/unit/message-queue.test.ts` skeleton
- [ ] T004 [P] Create `tests/integration/utility-lifecycle.integration.test.ts` skeleton
- [ ] T005 [P] Create `tests/e2e/utility-process.spec.ts` skeleton
- [ ] T006 [P] Create `test-app/utility-worker.js` example file
- [ ] T007 Update `package.json` exports to include `"./utility"` entry point

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core type definitions and infrastructure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T008 Extend `DirectIpcTarget` interface with `processType: ProcessType` field in `src/common/DirectIpcCommunication.ts`
- [ ] T009 [P] Add `ProcessType` enum (RENDERER, UTILITY) to `src/common/DirectIpcCommunication.ts`
- [ ] T010 [P] Add new IPC channels (`UTILITY_REGISTER`, `UTILITY_READY`) to `DIRECT_IPC_CHANNELS` in `src/common/DirectIpcCommunication.ts`
- [ ] T011 [P] Export `ProcessType` enum from `src/common/index.ts`
- [ ] T012 [P] Create type guards `isRenderer()` and `isUtilityProcess()` in `src/common/DirectIpcCommunication.ts`
- [ ] T013 [P] Create error classes (`IdentifierConflictError`, `UtilityProcessTerminatedError`, `RegistrationTimeoutError`) in `src/utility/errors.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Enable Direct Renderer-to-UtilityProcess Communication (Priority: P1) 🎯 MVP

**Goal**: Establish bidirectional MessageChannel communication between renderer processes and utility processes

**Independent Test**: Create a utility process, register it with DirectIpcMain, send a message from a renderer to the utility process, and receive a response back

### Tests for User Story 1 (TDD - WRITE FIRST) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T014 [P] [US1] Write unit test for `DirectIpcMain.registerUtilityProcess()` identifier validation in `tests/unit/DirectIpcMain.test.ts`
- [ ] T015 [P] [US1] Write unit test for `DirectIpcMain.registerUtilityProcess()` conflict detection in `tests/unit/DirectIpcMain.test.ts`
- [ ] T016 [P] [US1] Write unit test for message queuing during init in `tests/unit/message-queue.test.ts`
- [ ] T017 [P] [US1] Write unit test for message queue flush on registration in `tests/unit/message-queue.test.ts`
- [ ] T018 [P] [US1] Write integration test for renderer→utility MessageChannel in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T019 [P] [US1] Write integration test for utility→renderer MessageChannel in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T020 [P] [US1] Write E2E test for spawn→register→send workflow in `tests/e2e/utility-process.spec.ts`

**Checkpoint**: All User Story 1 tests written and FAILING

### Implementation for User Story 1

- [ ] T021 [P] [US1] Create `RegistrationState` enum in `src/utility/DirectIpcUtility.ts`
- [ ] T022 [P] [US1] Create `QueuedMessage` interface in `src/utility/DirectIpcUtility.ts`
- [ ] T023 [US1] Implement `DirectIpcUtility` class constructor and singleton pattern in `src/utility/DirectIpcUtility.ts`
- [ ] T024 [US1] Implement message queuing logic (queue, flush, state management) in `src/utility/DirectIpcUtility.ts`
- [ ] T025 [US1] Implement `send()` method with queue-or-send logic in `src/utility/DirectIpcUtility.ts`
- [ ] T026 [US1] Implement `on()` method for message listeners in `src/utility/DirectIpcUtility.ts`
- [ ] T027 [US1] Implement `off()` method for removing listeners in `src/utility/DirectIpcUtility.ts`
- [ ] T028 [US1] Implement registration handshake (SUBSCRIBE → MAP_UPDATE) in `src/utility/DirectIpcUtility.ts`
- [ ] T029 [US1] Extend `DirectIpcMain.registerUtilityProcess()` method in `src/main/DirectIpcMain.ts`
- [ ] T030 [US1] Add utility process tracking map to `DirectIpcMain` in `src/main/DirectIpcMain.ts`
- [ ] T031 [US1] Implement utility process lifecycle listeners (exit, spawn) in `src/main/DirectIpcMain.ts`
- [ ] T032 [US1] Extend `handleGetPort()` in DirectIpcMain to support utility processes in `src/main/DirectIpcMain.ts`
- [ ] T033 [US1] Implement MessagePort transfer to utility process via `postMessage` in `src/main/DirectIpcMain.ts`
- [ ] T034 [US1] Update `broadcastMapUpdate()` to include utility processes in `src/main/DirectIpcMain.ts`
- [ ] T035 [US1] Create `src/utility/index.ts` with exports (`DirectIpcUtility`, error classes)
- [ ] T036 [US1] Update `test-app/main.js` to spawn and register utility process
- [ ] T037 [US1] Update `test-app/utility-worker.js` with DirectIpcUtility instance and basic message listener
- [ ] T038 [US1] Update `test-app/renderer.html` to send messages to utility process

**Checkpoint**: Run User Story 1 tests - should ALL PASS now

- [ ] T039 [US1] Verify all T014-T020 tests now pass

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Request-Response Communication with Utility Processes (Priority: P2)

**Goal**: Enable invoke/handle request-response pattern between renderers and utility processes

**Independent Test**: Set up a handler in a utility process that performs a calculation, invoke it from a renderer, and verify the correct result is returned within the expected timeout

### Tests for User Story 2 (TDD - WRITE FIRST) ⚠️

- [ ] T040 [P] [US2] Write unit test for `invoke()` timeout handling in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T041 [P] [US2] Write unit test for `handle()` registration in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T042 [P] [US2] Write unit test for invoke error propagation in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T043 [P] [US2] Write integration test for renderer invokes utility handler in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T044 [P] [US2] Write integration test for utility invokes renderer handler in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T045 [P] [US2] Write E2E test for invoke round-trip <10ms in `tests/e2e/utility-process.spec.ts`

**Checkpoint**: All User Story 2 tests written and FAILING

### Implementation for User Story 2

- [ ] T046 [P] [US2] Create `PendingInvoke` interface in `src/utility/DirectIpcUtility.ts`
- [ ] T047 [US2] Implement `invoke()` method with timeout and promise handling in `src/utility/DirectIpcUtility.ts`
- [ ] T048 [US2] Implement `handle()` method for registering handlers in `src/utility/DirectIpcUtility.ts`
- [ ] T049 [US2] Implement `removeHandler()` method in `src/utility/DirectIpcUtility.ts`
- [ ] T050 [US2] Add invoke message handling (INVOKE, INVOKE_RESPONSE) in `src/utility/DirectIpcUtility.ts`
- [ ] T051 [US2] Implement pending invoke tracking and cleanup in `src/utility/DirectIpcUtility.ts`
- [ ] T052 [US2] Add timeout management for invoke requests in `src/utility/DirectIpcUtility.ts`
- [ ] T053 [US2] Update `test-app/utility-worker.js` with invoke handler example
- [ ] T054 [US2] Update `test-app/renderer.html` with invoke example and result display

**Checkpoint**: Run User Story 2 tests - should ALL PASS now

- [ ] T055 [US2] Verify all T040-T045 tests now pass

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Graceful Utility Process Lifecycle Management (Priority: P3)

**Goal**: Safely start, stop, and restart utility processes with proper cleanup and map updates

**Independent Test**: Create a utility process with active connections, terminate the process, and verify that all ports are cleaned up and renderers receive map updates reflecting the removed process

### Tests for User Story 3 (TDD - WRITE FIRST) ⚠️

- [ ] T056 [P] [US3] Write unit test for utility process exit detection in `tests/unit/DirectIpcMain.test.ts`
- [ ] T057 [P] [US3] Write unit test for port cleanup on termination in `tests/unit/DirectIpcMain.test.ts`
- [ ] T058 [P] [US3] Write unit test for pending invoke rejection on termination in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T059 [P] [US3] Write integration test for graceful shutdown in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T060 [P] [US3] Write integration test for crash detection in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T061 [P] [US3] Write E2E test for 100 start/stop cycles with no leaks in `tests/e2e/utility-process.spec.ts`

**Checkpoint**: All User Story 3 tests written and FAILING

### Implementation for User Story 3

- [ ] T062 [US3] Implement `handleUtilityProcessExit()` cleanup logic in `src/main/DirectIpcMain.ts`
- [ ] T063 [US3] Add `closeAllPorts()` method to DirectIpcUtility in `src/utility/DirectIpcUtility.ts`
- [ ] T064 [US3] Add `clearPendingInvokes()` with error rejection in `src/utility/DirectIpcUtility.ts`
- [ ] T065 [US3] Implement `unregisterUtilityProcess()` in DirectIpcMain in `src/main/DirectIpcMain.ts`
- [ ] T066 [US3] Add lifecycle event emissions (`'utility-process-exit'`) in `src/main/DirectIpcMain.ts`
- [ ] T067 [US3] Implement automatic MAP_UPDATE broadcast on termination in `src/main/DirectIpcMain.ts`
- [ ] T068 [US3] Add renderer-side handling for utility process removal in existing DirectIpcRenderer (no file change needed if using localEvents)
- [ ] T069 [US3] Update `test-app/main.js` with graceful shutdown example
- [ ] T070 [US3] Update `test-app/renderer.html` to display worker connection status changes

**Checkpoint**: Run User Story 3 tests - should ALL PASS now

- [ ] T071 [US3] Verify all T056-T061 tests now pass

**Checkpoint**: All user stories 1, 2, and 3 should now be independently functional

---

## Phase 6: User Story 4 - Prevent Race Conditions During Initialization (Priority: P2)

**Goal**: Ensure utility processes cannot send messages before fully registered, preventing message loss

**Independent Test**: Spawn a utility process that attempts to send messages immediately during initialization, and verify those messages are queued until registration completes and then delivered in order

### Tests for User Story 4 (TDD - WRITE FIRST) ⚠️

- [ ] T072 [P] [US4] Write unit test for message queuing before registration in `tests/unit/message-queue.test.ts`
- [ ] T073 [P] [US4] Write unit test for queue flush order preservation in `tests/unit/message-queue.test.ts`
- [ ] T074 [P] [US4] Write unit test for registration timeout handling in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T075 [P] [US4] Write integration test for 1000 rapid init tests (100% success) in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T076 [P] [US4] Write E2E test for immediate send during init in `tests/e2e/utility-process.spec.ts`

**Checkpoint**: All User Story 4 tests written and FAILING

### Implementation for User Story 4

- [ ] T077 [US4] Add registration timeout logic to DirectIpcUtility in `src/utility/DirectIpcUtility.ts`
- [ ] T078 [US4] Implement registration state validation before send in `src/utility/DirectIpcUtility.ts`
- [ ] T079 [US4] Add registration failure handling in `src/utility/DirectIpcUtility.ts`
- [ ] T080 [US4] Emit `'registration-complete'` and `'registration-failed'` events in `src/utility/DirectIpcUtility.ts`
- [ ] T081 [US4] Add diagnostic logging for queue operations (via pluggable logger) in `src/utility/DirectIpcUtility.ts`
- [ ] T082 [US4] Update `test-app/utility-worker.js` to demonstrate immediate messaging during init

**Checkpoint**: Run User Story 4 tests - should ALL PASS now

- [ ] T083 [US4] Verify all T072-T076 tests now pass

**Checkpoint**: Race condition prevention validated

---

## Phase 7: User Story 5 - Support Future Process Types with Minimal Changes (Priority: P3)

**Goal**: Isolate process-type-specific logic to enable future extensibility

**Independent Test**: Validate through architectural review that process-specific logic is isolated behind abstractions

### Tests for User Story 5 (Code Review - No Runtime Tests) ⚠️

- [ ] T084 [US5] Code review: Verify ProcessType enum is extensible (can add CHILD_PROCESS, WEB_WORKER without breaking changes)
- [ ] T085 [US5] Code review: Verify type guards work with new process types
- [ ] T086 [US5] Code review: Verify DirectIpcMain registration logic is process-agnostic

### Implementation for User Story 5

- [ ] T087 [P] [US5] Add comments documenting extension points for future process types in `src/common/DirectIpcCommunication.ts`
- [ ] T088 [P] [US5] Document ProcessAdapter pattern (future) in `specs/001-utility-process-support/research.md` (already done)
- [ ] T089 [P] [US5] Add TODO markers for future extensibility in `src/main/DirectIpcMain.ts`

**Checkpoint**: Architecture validated for future extensibility

---

## Phase 8: Throttled Messaging Support

**Purpose**: Add throttled messaging capability for utility processes (mirrors DirectIpcThrottled)

**Tests (TDD - WRITE FIRST)**:

- [ ] T090 [P] Write unit test for throttled send coalescing in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T091 [P] Write unit test for throttled receive coalescing in `tests/unit/DirectIpcUtility.test.ts`
- [ ] T092 [P] Write integration test for high-frequency throttled updates (1000+ msgs/sec) in `tests/integration/utility-lifecycle.integration.test.ts`
- [ ] T093 [P] Write E2E test for throttled progress updates in `tests/e2e/utility-process.spec.ts`

**Implementation**:

- [ ] T094 [P] Create `DirectIpcUtilityThrottled` class in `src/utility/DirectIpcUtilityThrottled.ts`
- [ ] T095 Implement throttled `send()` with microtask coalescing in `src/utility/DirectIpcUtilityThrottled.ts`
- [ ] T096 Implement throttled `on()` for coalesced listeners in `src/utility/DirectIpcUtilityThrottled.ts`
- [ ] T097 Implement throttled `off()` for removing listeners in `src/utility/DirectIpcUtilityThrottled.ts`
- [ ] T098 Add `throttled` property to DirectIpcUtility in `src/utility/DirectIpcUtility.ts`
- [ ] T099 Export DirectIpcUtilityThrottled from `src/utility/index.ts`
- [ ] T100 Update `test-app/utility-worker.js` with throttled send example
- [ ] T101 Update `test-app/renderer.html` with throttled receive example

**Checkpoint**: Run throttled tests

- [ ] T102 Verify all T090-T093 tests now pass

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T103 [P] Add TSDoc comments to all public APIs in `src/utility/DirectIpcUtility.ts`
- [ ] T104 [P] Add TSDoc comments to DirectIpcMain extensions in `src/main/DirectIpcMain.ts`
- [ ] T105 [P] Update `README.md` with utility process section (based on quickstart.md)
- [ ] T106 [P] Add utility process example to `README.md` examples section
- [ ] T107 [P] Update TypeDoc configuration to include utility process exports
- [ ] T108 [P] Generate API docs (`npm run docs`)
- [ ] T109 Run full test suite (`npm test && npm run test:e2e`)
- [ ] T110 Run type check (`npm run type-check`)
- [ ] T111 Run linter (`npm run lint`)
- [ ] T112 Run build and verify dual ESM/CJS output (`npm run build`)
- [ ] T113 Verify quickstart.md examples work end-to-end
- [ ] T114 [P] Update CHANGELOG.md with utility process feature (MINOR version bump)
- [ ] T115 Verify no regressions in existing renderer-to-renderer tests
- [ ] T116 Run performance benchmarks (message latency, invoke round-trip, memory footprint)
- [ ] T117 Verify all constitution principles satisfied (run through checklist)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational phase completion
  - User Story 1 (P1): No dependencies on other stories
  - User Story 2 (P2): No dependencies on US1 (independently testable)
  - User Story 3 (P3): No dependencies on US1/US2 (independently testable)
  - User Story 4 (P2): Depends on US1 (extends message queuing)
  - User Story 5 (P3): Architectural validation only
- **Throttled Messaging (Phase 8)**: Depends on US1 (extends DirectIpcUtility)
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories ✅ FULLY INDEPENDENT
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on US1 ✅ FULLY INDEPENDENT (uses same DirectIpcUtility class)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on US1/US2 ✅ FULLY INDEPENDENT (cleanup logic)
- **User Story 4 (P2)**: Depends on US1 (extends existing queue) ⚠️ DEPENDS ON US1
- **User Story 5 (P3)**: No runtime dependencies ✅ FULLY INDEPENDENT (code review only)

### Within Each User Story (TDD Order)

1. **Write ALL tests FIRST** - Ensure they FAIL
2. **Implement to pass tests** - One task at a time
3. **Verify tests pass** - Checkpoint
4. **Refactor if needed** - Keep tests green

### Parallel Opportunities

**Setup Phase (Phase 1)**:
- T002-T006 can all run in parallel (different test files)

**Foundational Phase (Phase 2)**:
- T009, T010, T011, T012, T013 can all run in parallel (different concerns)

**User Story 1 Tests**:
- T014-T020 can all run in parallel (different test files)

**User Story 1 Implementation**:
- T021, T022 can run in parallel (interfaces/enums)

**User Story 2 Tests**:
- T040-T045 can all run in parallel

**User Story 3 Tests**:
- T056-T061 can all run in parallel

**User Story 4 Tests**:
- T072-T076 can all run in parallel

**Throttled Tests**:
- T090-T093 can all run in parallel

**Polish Phase**:
- T103-T108 can all run in parallel (different files)

**Complete User Stories in Parallel** (if team capacity allows):
- After Foundational phase, US1, US2, US3, and US5 can be worked on in parallel
- US4 must wait for US1 to complete

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (TDD - WRITE FIRST):
Task T014: "Write unit test for DirectIpcMain.registerUtilityProcess() validation"
Task T015: "Write unit test for DirectIpcMain.registerUtilityProcess() conflict detection"
Task T016: "Write unit test for message queuing during init"
Task T017: "Write unit test for message queue flush on registration"
Task T018: "Write integration test for renderer→utility MessageChannel"
Task T019: "Write integration test for utility→renderer MessageChannel"
Task T020: "Write E2E test for spawn→register→send workflow"

# Verify all tests FAIL before implementation

# Launch parallel implementation tasks:
Task T021: "Create RegistrationState enum"
Task T022: "Create QueuedMessage interface"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T007)
2. Complete Phase 2: Foundational (T008-T013) **CRITICAL - blocks all stories**
3. Complete Phase 3: User Story 1 (T014-T039)
   - Write tests T014-T020 FIRST - ensure FAIL
   - Implement T021-T038 to make tests pass
   - Verify T039 - all tests pass
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Run quickstart.md example
6. Deploy/demo if ready ✅ **MVP COMPLETE**

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → **MVP!**
3. Add User Story 2 → Test independently → Invoke/handle working
4. Add User Story 3 → Test independently → Lifecycle management complete
5. Add User Story 4 → Test independently → Race conditions prevented
6. Add User Story 5 → Validate architecture → Future-proof
7. Add Throttled Messaging → High-frequency updates supported
8. Polish → Production ready

Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - **Developer A**: User Story 1 (P1)
   - **Developer B**: User Story 2 (P2) - can start in parallel
   - **Developer C**: User Story 3 (P3) - can start in parallel
   - **Developer D**: User Story 5 (P3) - can start in parallel (code review)
3. After US1 completes:
   - **Developer A**: User Story 4 (P2) - depends on US1
4. After all user stories:
   - **Team**: Throttled Messaging (Phase 8)
   - **Team**: Polish (Phase 9)

---

## Task Counts

- **Total Tasks**: 117
- **Setup Tasks**: 7
- **Foundational Tasks**: 6
- **User Story 1 (MVP)**: 26 (7 tests + 19 implementation)
- **User Story 2**: 16 (6 tests + 10 implementation)
- **User Story 3**: 16 (6 tests + 10 implementation)
- **User Story 4**: 12 (5 tests + 7 implementation)
- **User Story 5**: 3 (code review only)
- **Throttled Messaging**: 13 (4 tests + 9 implementation)
- **Polish & Cross-Cutting**: 15

**Test Coverage**: 44 test tasks out of 117 total (38% test tasks - strong TDD coverage per constitution)

---

## Notes

- **[P] tasks** = different files, no dependencies on completion of other tasks
- **[Story] label** maps task to specific user story for traceability
- **Each user story is independently completable and testable**
- **Tests MUST be written FIRST and FAIL before implementation** (Constitution Principle III)
- Verify tests fail before implementing (red → green → refactor)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Constitution compliance validated in T117

---

## Constitution Compliance Tracker

**Principle III (TDD) Enforcement**:
- ✅ All user stories have tests written FIRST
- ✅ Tests must FAIL before implementation begins
- ✅ Checkpoints verify tests pass after implementation
- ✅ Test-first order explicitly marked in task list

**Test Coverage**:
- ✅ Unit tests: Message queuing, registration, conflict detection, invoke handling
- ✅ Integration tests: MessageChannel communication, lifecycle, throttling
- ✅ E2E tests: Full Electron environment with Playwright
- ✅ Performance tests: Latency, round-trip time, resource cleanup

**Ready for Implementation**: All tasks follow TDD workflow per constitution requirements.
