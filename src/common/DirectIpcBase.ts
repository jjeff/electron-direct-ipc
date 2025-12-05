/**
 * DirectIpcBase - Abstract base class for DirectIpc implementations
 * Provides shared functionality for both renderer and utility process implementations
 */

import { EventEmitter } from 'events'
import {
  DirectIpcTarget,
  EventMap,
  InvokeMap,
  Prettify,
  InvokeOptions,
  TargetSelector,
  InvokeResponse,
  InvokeHandler,
  WithSender,
  TypedEventEmitter,
} from './index.js'
import { DirectIpcLogger } from './DirectIpcLogger.js'

/**
 * Base event map for DirectIpc internal events
 * These events do NOT include sender as first argument
 */
export type DirectIpcEventMap = {
  'target-added': (target: DirectIpcTarget) => void
  'target-removed': (target: DirectIpcTarget) => void
  'message-port-added': (target: DirectIpcTarget) => void
  'map-updated': (map: DirectIpcTarget[]) => void
  'registration-complete': () => void
  'registration-failed': (error: Error) => void
  message: (sender: DirectIpcTarget, message: unknown) => void
}

/**
 * Cached port information
 */
export interface CachedPort<TPort> {
  port: TPort
  info: DirectIpcTarget
}

/**
 * Abstract base class for DirectIpc implementations
 * @template TMessageMap - Map of message channels to their handler function signatures (WITHOUT sender)
 * @template TInvokeMap - Map of invoke channels to their handler function signatures (WITHOUT sender)
 * @template TIdentifierStrings - Union of allowed identifier strings for type-safe identifier usage
 * @template TPort - Port type (MessagePort for renderer, MessagePortMain for utility)
 */
export abstract class DirectIpcBase<
  TMessageMap extends EventMap = EventMap,
  TInvokeMap extends InvokeMap = InvokeMap,
  TIdentifierStrings extends string = string,
  TPort = MessagePort | Electron.MessagePortMain,
> extends (EventEmitter as {
  new <TMessageMap extends EventMap>(): Prettify<TypedEventEmitter<WithSender<TMessageMap>>>
})<TMessageMap> {
  // ===== PROTECTED STATE (accessible by subclasses) =====

  /** Logger */
  protected log!: DirectIpcLogger

  /** Current map of all registered processes */
  protected map: DirectIpcTarget[] = []

  /** Registry of handlers for invoke/handle pattern */
  protected handlers = new Map<string, InvokeHandler>()

  /** Pending invoke requests waiting for responses */
  protected pendingInvokes = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()

  /** Counter for generating unique request IDs */
  protected requestIdCounter = 0

  /** Default timeout for invoke calls (ms) */
  protected defaultTimeout!: number

  /** This process's optional identifier */
  protected myIdentifier?: TIdentifierStrings

  /** Local event emitter for lifecycle events */
  public readonly localEvents: TypedEventEmitter<DirectIpcEventMap>

  // ===== CONSTRUCTOR =====

  constructor() {
    super()
    this.localEvents = new EventEmitter() as TypedEventEmitter<DirectIpcEventMap>
  }

  // ===== ABSTRACT METHODS (must be implemented by subclasses) =====

  /**
   * Get unique key for caching a port
   * Renderer uses process ID, Utility uses identifier
   */
  protected abstract getPortCacheKey(target: DirectIpcTarget): string | number

  /**
   * Send message via a port
   * Different port types have different APIs
   */
  protected abstract postMessageToPort(port: TPort, message: unknown): void

  /**
   * Set up message listener on a port
   * MessagePort uses onmessage, MessagePortMain uses on('message')
   */
  protected abstract setupPortListener(port: TPort, handler: (data: unknown) => void): void

  /**
   * Get or request a port for a target
   * Implementation differs significantly between Renderer and Utility
   */
  protected abstract getPort(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): Promise<TPort>

  /**
   * Find targets matching a selector
   * Returns array to support "allIdentifiers" and "allUrls" patterns
   */
  protected abstract findTargets(selector: TargetSelector<TIdentifierStrings>): DirectIpcTarget[]

  /**
   * Clean up a port (to be called when target is removed)
   * Subclasses override to access their specific portCache
   */
  protected abstract cleanupPort(target: DirectIpcTarget): void

  /**
   * Close all MessagePort connections
   */
  public abstract closeAllPorts(): void

  /**
   * Send a message to target(s)
   * Base implementation handles common validation, subclasses override for specifics
   */
  public abstract send<T extends keyof TMessageMap>(
    target: TargetSelector<TIdentifierStrings>,
    message: T,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'any' used in conditional type for parameter extraction
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void>

  /**
   * Invoke a handler on a remote process
   */
  public abstract invoke<T extends keyof TInvokeMap>(
    target: Omit<TargetSelector<TIdentifierStrings>, 'allIdentifiers' | 'allUrls'>,
    channel: T,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Promise<any>

  // ===== CONCRETE METHODS (shared implementation) =====

  /**
   * Handle map update from main process
   * Base implementation handles common logic, subclasses can override for lifecycle hooks
   */
  protected handleMapUpdate(newMap: DirectIpcTarget[]): void {
    const oldMap = this.map
    this.map = newMap

    this.localEvents.emit('map-updated', newMap)

    // Detect added/removed targets
    this.emitMapChanges(oldMap, newMap)
  }

  /**
   * Emit target-added and target-removed events
   */
  protected emitMapChanges(oldMap: DirectIpcTarget[], newMap: DirectIpcTarget[]): void {
    const oldKeys = new Set(oldMap.map((t) => this.getPortCacheKey(t)))
    const newKeys = new Set(newMap.map((t) => this.getPortCacheKey(t)))

    // Detect added targets
    for (const target of newMap) {
      const key = this.getPortCacheKey(target)
      if (!oldKeys.has(key)) {
        this.localEvents.emit('target-added', target)
      }
    }

    // Detect removed targets
    for (const target of oldMap) {
      const key = this.getPortCacheKey(target)
      if (!newKeys.has(key)) {
        this.localEvents.emit('target-removed', target)
        this.cleanupPort(target)
      }
    }
  }

  /**
   * Handle an incoming invoke response
   */
  protected handleInvokeResponse(response: InvokeResponse): void {
    const { requestId, success, data, error } = response

    this.log.silly?.('DirectIpcBase::handleInvokeResponse - handling response')

    const pending = this.pendingInvokes.get(requestId)
    if (!pending) {
      this.log.warn?.('DirectIpcBase::handleInvokeResponse - No pending request')
      return
    }

    // Clean up
    clearTimeout(pending.timeout)
    this.pendingInvokes.delete(requestId)

    // Resolve or reject
    if (success) {
      pending.resolve(data)
    } else {
      pending.reject(new Error(error ?? 'Unknown error in invoke response'))
    }
  }

  /**
   * Register a handler for invoke calls on a specific channel
   */
  handle<T extends keyof TInvokeMap>(channel: T, handler: WithSender<TInvokeMap>[T]): void {
    this.log.silly?.('DirectIpcBase::handle - Registering handler for channel')
    if (this.handlers.has(channel as string)) {
      this.log.warn?.(
        `DirectIpcBase::handle - Handler already exists for ${channel as string}, replacing`
      )
    }
    this.handlers.set(channel as string, handler as InvokeHandler)
  }

  /**
   * Remove a handler for a specific channel
   */
  removeHandler<T extends keyof TInvokeMap>(channel: T): void {
    this.log.silly?.(`DirectIpcBase::removeHandler - Removing handler for ${channel as string}`)
    this.handlers.delete(channel as string)
  }

  /**
   * Get the current array of all registered target processes
   */
  getMap(): DirectIpcTarget[] {
    return [...this.map]
  }

  /**
   * Get this process's identifier
   * @returns The identifier string or undefined if not set
   */
  getMyIdentifier(): TIdentifierStrings | undefined {
    return this.myIdentifier
  }

  /**
   * Set the default timeout for invoke calls
   */
  setDefaultTimeout(ms: number): void {
    this.defaultTimeout = ms
  }

  /**
   * Get the current default timeout
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout
  }

  /**
   * Clean up all pending invokes (useful for testing or shutdown)
   */
  clearPendingInvokes(): void {
    for (const [, pending] of this.pendingInvokes.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('DirectIpc cleared all pending invokes'))
    }
    this.pendingInvokes.clear()
  }

  /**
   * Create invoke request ID
   */
  protected createInvokeRequestId(): string {
    return `${++this.requestIdCounter}-${Date.now()}`
  }

  /**
   * Create invoke promise with timeout
   */
  protected createInvokePromise<T>(
    requestId: string,
    timeoutMs: number,
    channel: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingInvokes.delete(requestId)
        reject(new Error(`DirectIpc invoke timeout after ${timeoutMs}ms: ${channel}`))
      }, timeoutMs)

      this.pendingInvokes.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })
    })
  }

  /**
   * Extract InvokeOptions from args array
   */
  protected extractInvokeOptions(args: unknown[]): {
    options?: InvokeOptions
    invokeArgs: unknown[]
  } {
    if (args.length === 0) {
      return { invokeArgs: args }
    }

    const lastArg = args[args.length - 1]
    const isOptionsObject =
      lastArg != null &&
      typeof lastArg === 'object' &&
      !Array.isArray(lastArg) &&
      'timeout' in lastArg

    if (isOptionsObject) {
      return {
        options: lastArg as InvokeOptions,
        invokeArgs: args.slice(0, -1),
      }
    }

    return { invokeArgs: args }
  }
}
