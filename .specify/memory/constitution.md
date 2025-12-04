# Electron Direct IPC Constitution

<!--
SYNC IMPACT REPORT
==================

Version Change: N/A → 1.0.0

New Principles Added:
- I. Library-First Architecture
- II. Type Safety & Developer Experience
- III. Test-Driven Development (NON-NEGOTIABLE)
- IV. Performance & Efficiency
- V. API Stability & Semantic Versioning

New Sections Added:
- Core Principles
- Development Standards
- Quality Gates
- Governance

Templates Requiring Updates:
✅ plan-template.md - Constitution Check section updated (references constitution principles)
✅ spec-template.md - No changes needed (already aligned with testability requirements)
✅ tasks-template.md - No changes needed (already aligned with test-first approach)

Follow-up TODOs:
- None - all placeholders filled with concrete values
-->

## Core Principles

### I. Library-First Architecture

Electron Direct IPC is a focused, single-purpose library providing type-safe IPC for Electron applications. It must:

- Remain a standalone library with minimal dependencies
- Expose all functionality through clean, documented APIs
- Be independently testable without requiring full Electron environment
- Support both ESM (`import`) and CommonJS (`require`) module formats
- Maintain clear separation between main process (`DirectIpcMain`) and renderer process (`DirectIpcRenderer`) concerns

**Rationale**: Library-first architecture ensures reusability, testability, and ease of integration into diverse Electron projects.

### II. Type Safety & Developer Experience

TypeScript is mandatory for all implementation and API surfaces. All code must:

- Use strict TypeScript configuration (`strict: true`)
- Provide full generic type inference for send/receive/invoke/handle operations
- Export complete TypeScript definitions for all public APIs
- Avoid `any` types except in documented edge cases with justification
- Support IDE autocomplete and compile-time validation of message types, arguments, and return values

**Rationale**: Type safety prevents runtime errors, improves developer productivity, and makes the library self-documenting through IDE tooling.

### III. Test-Driven Development (NON-NEGOTIABLE)

All new features and bug fixes MUST follow strict TDD workflow:

1. **Tests written FIRST** before any implementation
2. **User/reviewer approval** of test coverage and approach
3. **Tests FAIL** initially (red state)
4. **Implementation** written to pass tests (green state)
5. **Refactor** while maintaining green state

Required test coverage levels:

- Unit tests: Core logic in `src/` (isolate dependencies)
- Integration tests: MessageChannel communication patterns
- E2E tests: Full Electron main + renderer interactions (Playwright)
- Contract tests: API surface stability (public methods, events, types)

**Rationale**: TDD ensures correctness, prevents regressions, and documents expected behavior through executable specifications.

### IV. Performance & Efficiency

Direct renderer-to-renderer communication via MessageChannel is the core value proposition. All changes must:

- Maintain near-zero latency for non-throttled messages (<1ms overhead)
- Preserve microtask-based throttling behavior (~1ms coalescing)
- Avoid main process involvement after initial MessageChannel setup
- Minimize memory footprint (DirectIpcRenderer ~8KB, DirectIpcThrottled ~2KB)
- Support high-frequency updates (1000+ messages/second) without degradation

**Rationale**: Performance is a primary selling point. Users choose this library for speed; regressions are unacceptable.

### V. API Stability & Semantic Versioning

Public API changes follow strict semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes (remove methods, change signatures, change behavior)
- **MINOR**: New features, additions (backward compatible)
- **PATCH**: Bug fixes, docs, refactoring (no API changes)

Breaking changes require:

- Deprecation warnings in previous MINOR version (when feasible)
- Migration guide in CHANGELOG.md
- Updated examples and documentation
- Approval from maintainer

**Rationale**: Library users depend on API stability. Breaking changes must be rare, well-communicated, and justified.

## Development Standards

### Code Quality

- Follow project ESLint configuration (`npm run lint`)
- Use Prettier for formatting (`npm run format`)
- Pass TypeScript compilation with zero errors (`npm run type-check`)
- Maintain existing code style and patterns (singleton pattern for DirectIpcRenderer, EventEmitter-based listeners)

### Documentation

- All public APIs documented with TSDoc comments (shows in IDE tooltips)
- README.md kept up-to-date with API changes
- Typedoc API docs generated and published (`npm run docs`)
- Examples in README must be tested and working

### Commit Standards

- Follow Conventional Commits specification (enforced by commitlint)
- Format: `type(scope): description` (e.g., `feat(renderer): add broadcast support`)
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`
- Commits trigger semantic-release for automated versioning

## Quality Gates

All changes MUST pass these gates before merge:

1. **Build**: `npm run build` succeeds for both ESM and CJS outputs
2. **Type Check**: `npm run type-check` passes with zero errors
3. **Lint**: `npm run lint` passes with zero warnings
4. **Unit Tests**: `npm test` passes with 100% of tests passing
5. **E2E Tests**: `npm run test:e2e` passes with all Playwright tests green
6. **Coverage**: Test coverage does not decrease (enforced by Vitest coverage)

Optional but recommended:

- **Manual Testing**: Test in real Electron app (test-app) if touching core IPC logic
- **Performance Benchmarks**: Verify no regressions in latency/throughput for critical paths

## Governance

### Constitution Authority

This constitution supersedes all other development practices. When conflicts arise:

1. Constitution principles take precedence
2. Complexity additions require justification in plan.md Complexity Tracking section
3. Principle violations must be approved by project maintainer with documented rationale

### Amendment Process

Constitution amendments require:

1. Proposal with rationale (GitHub issue or discussion)
2. Impact analysis on existing code and workflows
3. Update to this document with version bump (follow semantic versioning for constitution itself)
4. Propagation of changes to dependent templates (plan-template.md, spec-template.md, tasks-template.md)
5. Approval from project maintainer

### Compliance Review

- All PRs MUST verify compliance with core principles (automated via CI where possible)
- Breaking principle III (TDD) requires explicit maintainer override
- Non-compliance must be documented in PR description with justification

**Version**: 1.0.0 | **Ratified**: 2025-12-03 | **Last Amended**: 2025-12-03
