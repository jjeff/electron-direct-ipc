/**
 * API Contracts: Utility Process Support
 *
 * TypeScript type definitions for extending electron-direct-ipc with utility process support.
 * These contracts define the public API surface that will be exposed to library users.
 *
 * @module electron-direct-ipc/utility
 * @version 2.0.0 (planned)
 */

import type { EventEmitter } from 'events'
import type { UtilityProcess } from 'electron'

// ============================================================================
// Enums
// ============================================================================

/**
 * Discriminator for different process types in the DirectIpc registry.
 * Enables type-safe handling of heterogeneous process collections.
 */
export enum ProcessType {
  /** Electron renderer process (BrowserWindow) */
  RENDERER = 'renderer',

  /** Electron utility process (background Node.js worker) */
  UTILITY = 'utility',

  // Future extensions (deferred):
  // CHILD_PROCESS = 'child_process',
  // WEB_WORKER = 'web_worker',
  // WORKER_THREAD = 'worker_thread',
}

/**
 * Registration state for utility processes during initialization.
 */
export enum RegistrationState {
  /** DirectIpcUtility created but subscription not started */
  UNINITIALIZED = 'uninitialized',

  /** SUBSCRIBE sent, waiting for MAP_UPDATE confirmation */
  SUBSCRIBING = 'subscribing',

  /** MAP_UPDATE received, ready for normal operation */
  REGISTERED = 'registered',

  /** Registration failed or timed out */
  FAILED = 'failed',
}

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Extended DirectIpcTarget interface with process type discrimination.
 * Represents any communication endpoint (renderer or utility process).
 */
export interface DirectIpcTarget {
  /** Unique identifier for this process (e.g., 'main-window', 'worker-1') */
  identifier?: string

  /** Electron webContentsId (only for RENDERER type) */
  webContentsId?: number

  /** Process type discriminator */
  processType: ProcessType

  /** URL of the renderer (only for RENDERER type) */
  url?: string

  /** Process ID for diagnostic purposes (optional) */
  pid?: number
}

/**
 * Type guard: Check if target is a renderer process
 */
export function isRenderer(target: DirectIpcTarget): target is DirectIpcTarget & { webContentsId: number } {
  return target.processType === ProcessType.RENDERER
}

/**
 * Type guard: Check if target is a utility process
 */
export function isUtilityProcess(target: DirectIpcTarget): target is DirectIpcTarget & { pid: number } {
  return target.processType === ProcessType.UTILITY
}

// ============================================================================
// DirectIpcMain Extensions
// ============================================================================

/**
 * Options for registering a utility process with DirectIpcMain.
 */
export interface RegisterUtilityProcessOptions {
  /** Unique identifier for this utility process */
  identifier: string

  /** Electron UtilityProcess instance */
  process: UtilityProcess

  /** Optional: Custom logger for this process */
  log?: DirectIpcLogger
}

/**
 * Extended DirectIpcMain interface with utility process support.
 */
export interface DirectIpcMainExtended {
  /**
   * Register a utility process with the DirectIpc coordinator.
   *
   * @param identifier - Unique identifier for the utility process
   * @param process - Electron UtilityProcess instance
   * @throws {IdentifierConflictError} If identifier already in use
   * @throws {Error} If process is null or already exited
   *
   * @example
   * ```typescript
   * import { utilityProcess } from 'electron'
   * import { DirectIpcMain } from 'electron-direct-ipc/main'
   *
   * const worker = utilityProcess.fork('worker.js')
   * DirectIpcMain.instance().registerUtilityProcess('worker-1', worker)
   * ```
   */
  registerUtilityProcess(identifier: string, process: UtilityProcess): void

  /**
   * Unregister a utility process (cleanup before manual termination).
   * Note: Automatic cleanup happens on process exit, this is for manual control.
   *
   * @param identifier - Identifier of utility process to unregister
   * @returns {boolean} True if process was unregistered, false if not found
   */
  unregisterUtilityProcess(identifier: string): boolean

  /**
   * Get all registered utility processes.
   *
   * @returns Array of utility process identifiers
   */
  getUtilityProcesses(): string[]
}

// ============================================================================
// DirectIpcUtility
// ============================================================================

/**
 * Event map for DirectIpcUtility (generic parameter)
 * Defines message channels and their argument types.
 */
export interface EventMap {
  [key: string]: (...args: any[]) => any
}

/**
 * Invoke map for DirectIpcUtility (generic parameter)
 * Defines invoke channels and their argument/return types.
 */
export interface InvokeMap {
  [key: string]: (...args: any[]) => any
}

/**
 * Options for DirectIpcUtility.instance()
 */
export interface DirectIpcUtilityOptions<TIdentifierStrings extends string = string> {
  /** Unique identifier for this utility process */
  identifier?: TIdentifierStrings

  /** Custom logger (defaults to console) */
  log?: DirectIpcLogger

  /** Default timeout for invoke operations (ms, default: 30000) */
  defaultTimeout?: number

  /** Registration timeout (ms, default: 5000) */
  registrationTimeout?: number
}

/**
 * Target selector for send() and invoke() operations.
 * Same interface as DirectIpcRenderer for consistency.
 */
export type TargetSelector<TId extends string = string> =
  | { identifier: TId | RegExp }
  | { webContentsId: number }
  | { url: string | RegExp }
  | { allIdentifiers: TId | RegExp }
  | { allUrls: string | RegExp }

/**
 * Options for invoke() calls
 */
export interface InvokeOptions {
  /** Timeout in milliseconds (overrides default) */
  timeout?: number
}

/**
 * DirectIpcUtility class for utility process communication.
 * Parallel to DirectIpcRenderer but runs in utility process context.
 *
 * @template TMessages - Event map defining message channels and arguments
 * @template TInvokes - Invoke map defining RPC channels and arguments/return types
 * @template TIdentifiers - Union of allowed process identifier strings
 */
export interface DirectIpcUtility<
  TMessages extends EventMap = EventMap,
  TInvokes extends InvokeMap = InvokeMap,
  TIdentifiers extends string = string,
> {
  /**
   * Get the singleton instance of DirectIpcUtility.
   *
   * @param options - Configuration options
   * @returns DirectIpcUtility singleton
   *
   * @example
   * ```typescript
   * import { DirectIpcUtility } from 'electron-direct-ipc/utility'
   *
   * type Messages = {
   *   'result': (data: number) => void
   * }
   *
   * const utility = DirectIpcUtility.instance<Messages>({
   *   identifier: 'worker-1'
   * })
   * ```
   */
  instance<M extends EventMap, I extends InvokeMap, T extends string>(
    options?: DirectIpcUtilityOptions<T>
  ): DirectIpcUtility<M, I, T>

  /**
   * Send a typed message to another process.
   *
   * @param target - Target process selector
   * @param message - Message channel name
   * @param args - Message arguments (type-safe based on TMessages)
   * @returns Promise that resolves when message is sent
   *
   * @example
   * ```typescript
   * await utility.send({ identifier: 'main-window' }, 'result', 42)
   * ```
   */
  send<K extends keyof TMessages>(
    target: TargetSelector<TIdentifiers>,
    message: K,
    ...args: Parameters<TMessages[K]>
  ): Promise<void>

  /**
   * Register a listener for incoming messages.
   *
   * @param event - Message channel name
   * @param listener - Handler function
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * utility.on('compute', (sender, data) => {
   *   console.log('Compute request:', data)
   * })
   * ```
   */
  on<K extends keyof TMessages>(
    event: K,
    listener: (sender: DirectIpcTarget, ...args: Parameters<TMessages[K]>) => void
  ): this

  /**
   * Remove a message listener.
   *
   * @param event - Message channel name
   * @param listener - Handler function to remove
   * @returns this (for chaining)
   */
  off<K extends keyof TMessages>(
    event: K,
    listener: Function
  ): this

  /**
   * Invoke a remote handler and await the result.
   *
   * @param target - Target process selector (single target only)
   * @param channel - Invoke channel name
   * @param args - Invoke arguments (type-safe based on TInvokes)
   * @returns Promise resolving to handler's return value
   *
   * @example
   * ```typescript
   * const result = await utility.invoke(
   *   { identifier: 'main-window' },
   *   'getData',
   *   'user-123'
   * )
   * ```
   */
  invoke<K extends keyof TInvokes>(
    target: Omit<TargetSelector<TIdentifiers>, 'allIdentifiers' | 'allUrls'>,
    channel: K,
    ...args: [...Parameters<TInvokes[K]>, options?: InvokeOptions]
  ): Promise<Awaited<ReturnType<TInvokes[K]>>>

  /**
   * Register a handler for incoming invoke requests.
   *
   * @param channel - Invoke channel name
   * @param handler - Handler function (sync or async)
   *
   * @example
   * ```typescript
   * utility.handle('processData', async (sender, input) => {
   *   const result = await heavyComputation(input)
   *   return result
   * })
   * ```
   */
  handle<K extends keyof TInvokes>(
    channel: K,
    handler: (sender: DirectIpcTarget, ...args: Parameters<TInvokes[K]>) => ReturnType<TInvokes[K]>
  ): void

  /**
   * Remove an invoke handler.
   *
   * @param channel - Invoke channel name
   */
  removeHandler<K extends keyof TInvokes>(channel: K): void

  /**
   * Access throttled messaging API (lossy, coalesced).
   * Same as DirectIpcRenderer.throttled
   */
  readonly throttled: DirectIpcUtilityThrottled<TMessages, TInvokes, TIdentifiers>

  /**
   * Access local lifecycle events.
   * Emits: 'target-added', 'target-removed', 'map-updated', 'message-port-added', 'registration-complete', 'registration-failed'
   */
  readonly localEvents: EventEmitter

  /**
   * Get the current process map (all renderers and utility processes).
   *
   * @returns Array of DirectIpcTarget
   */
  getMap(): DirectIpcTarget[]

  /**
   * Get this utility process's identifier.
   *
   * @returns Identifier string or undefined if not set
   */
  getMyIdentifier(): TIdentifiers | undefined

  /**
   * Set this utility process's identifier.
   * Can only be called once during initialization.
   *
   * @param identifier - New identifier
   * @throws {Error} If identifier already set
   */
  setIdentifier(identifier: TIdentifiers): void

  /**
   * Get current registration state.
   *
   * @returns RegistrationState enum value
   */
  getRegistrationState(): RegistrationState

  /**
   * Close all MessagePort connections (cleanup).
   */
  closeAllPorts(): void

  /**
   * Clear all pending invoke requests (reject with error).
   */
  clearPendingInvokes(): void
}

/**
 * Throttled messaging interface for utility processes.
 * Parallel to DirectIpcThrottled.
 */
export interface DirectIpcUtilityThrottled<
  TMessages extends EventMap = EventMap,
  TInvokes extends InvokeMap = InvokeMap,
  TIdentifiers extends string = string,
> {
  /**
   * Send a throttled message (lossy, coalesced per microtask).
   */
  send<K extends keyof TMessages>(
    target: TargetSelector<TIdentifiers>,
    message: K,
    ...args: Parameters<TMessages[K]>
  ): Promise<void>

  /**
   * Register a throttled message listener.
   */
  on<K extends keyof TMessages>(
    event: K,
    listener: (sender: DirectIpcTarget, ...args: Parameters<TMessages[K]>) => void
  ): this

  /**
   * Remove a throttled message listener.
   */
  off<K extends keyof TMessages>(
    event: K,
    listener: Function
  ): this

  /**
   * Access the underlying DirectIpcUtility instance.
   */
  readonly directIpc: DirectIpcUtility<TMessages, TInvokes, TIdentifiers>

  /**
   * Access local lifecycle events.
   */
  readonly localEvents: EventEmitter
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Thrown when attempting to register a utility process with a duplicate identifier.
 */
export class IdentifierConflictError extends Error {
  public readonly existingType: ProcessType

  constructor(identifier: string, existingType: ProcessType) {
    super(`Identifier "${identifier}" already in use by ${existingType}`)
    this.name = 'IdentifierConflictError'
    this.existingType = existingType
  }
}

/**
 * Thrown when attempting to send/invoke a utility process that doesn't exist.
 */
export class UtilityProcessNotFoundError extends Error {
  public readonly identifier: string

  constructor(identifier: string) {
    super(`Utility process not found: ${identifier}`)
    this.name = 'UtilityProcessNotFoundError'
    this.identifier = identifier
  }
}

/**
 * Thrown when a utility process terminates unexpectedly during an invoke.
 */
export class UtilityProcessTerminatedError extends Error {
  public readonly identifier: string

  constructor(identifier: string) {
    super(`Process terminated unexpectedly: ${identifier}`)
    this.name = 'UtilityProcessTerminatedError'
    this.identifier = identifier
  }
}

/**
 * Thrown when utility process registration times out.
 */
export class RegistrationTimeoutError extends Error {
  public readonly identifier: string
  public readonly timeoutMs: number

  constructor(identifier: string, timeoutMs: number) {
    super(`Utility process registration timed out after ${timeoutMs}ms: ${identifier}`)
    this.name = 'RegistrationTimeoutError'
    this.identifier = identifier
    this.timeoutMs = timeoutMs
  }
}

// ============================================================================
// Logger Interface (existing, for reference)
// ============================================================================

/**
 * Pluggable logger interface (same as existing DirectIpcLogger).
 */
export interface DirectIpcLogger {
  error(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  debug(message: string, ...args: any[]): void
}

// ============================================================================
// IPC Channel Constants (extended)
// ============================================================================

/**
 * IPC channel names used for DirectIpc communication.
 */
export const DIRECT_IPC_CHANNELS = {
  SUBSCRIBE: 'direct-ipc:subscribe',
  UPDATE_IDENTIFIER: 'direct-ipc:update-identifier',
  GET_PORT: 'direct-ipc:get-port',
  MAP_UPDATE: 'direct-ipc:map-update',
  PORT_MESSAGE: 'direct-ipc:port-message',

  // New for utility processes
  UTILITY_REGISTER: 'direct-ipc:utility-register',
  UTILITY_READY: 'direct-ipc:utility-ready',
} as const

/**
 * Local event names emitted by DirectIpcUtility.localEvents
 */
export const DIRECT_IPC_LOCAL_EVENTS = {
  TARGET_ADDED: 'target-added',
  TARGET_REMOVED: 'target-removed',
  MAP_UPDATED: 'map-updated',
  MESSAGE_PORT_ADDED: 'message-port-added',
  REGISTRATION_COMPLETE: 'registration-complete',
  REGISTRATION_FAILED: 'registration-failed',
  MESSAGE: 'message',
} as const
