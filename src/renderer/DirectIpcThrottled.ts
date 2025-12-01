import {
  DirectIpcRenderer,
  EventMap,
  InvokeMap,
  DirectIpcLogger,
  TypedEventEmitter,
  DirectIpcEventMap,
} from './DirectIpcRenderer'
import { DirectIpcTarget } from '../common/DirectIpcCommunication'

/**
 * Prepends 'sender: DirectIpcTarget' to every handler function in an EventMap
 */
type WithSender<T extends EventMap> = {
  [K in keyof T]: (
    sender: DirectIpcTarget,
    ...args: Parameters<T[K]>
  ) => ReturnType<T[K]>
}

/**
 * ## DirectIpcThrottled - Lossy Message Coalescing
 *
 * **Note:** You typically access this via `directIpc.throttled` rather than creating
 * instances directly. DirectIpcRenderer automatically creates a throttled instance.
 *
 * Provides automatic message throttling using microtask coalescing. This is a **lossy**
 * communication pattern where intermediate messages are dropped, keeping only the latest
 * message per event loop tick.
 *
 * ### How It Works
 *
 * **Send-side coalescing:**
 * - Multiple sends to the same target+channel in one tick → only last message sent
 * - Sends are batched and dispatched on next microtask (~1ms)
 * - All pending sends dispatched in parallel for maximum throughput
 *
 * **Receive-side coalescing:**
 * - Multiple receives on same channel in one tick → listeners called once with latest
 * - Received messages queued and dispatched on next microtask
 * - All listeners receive the same (latest) coalesced value
 *
 * ### When to Use Throttled Messages
 *
 * ✅ **Use `directIpc.throttled` when:**
 * - Sending high-frequency state updates (position, volume, progress)
 * - Only the **latest value** matters (replaceable state, not events)
 * - You're experiencing backpressure (sender faster than receiver)
 * - UI updates that can safely skip intermediate frames
 * - Real-time data feeds where staleness is unacceptable
 *
 * ❌ **Use regular `directIpc` when:**
 * - Every message is unique and important (user actions, commands)
 * - Messages represent discrete events (not continuous state)
 * - Order of messages matters for correctness
 * - You need guaranteed delivery of every message
 * - Messages trigger side effects that can't be skipped
 * - Using invoke/handle pattern (already request-response, no throttling needed)
 *
 * ### Checklist for Correct Usage
 *
 * Before using `.throttled`, verify ALL of these are true:
 *
 * - [ ] Your message represents **replaceable state** (not unique events)
 * - [ ] Only the **latest value** matters (intermediate values can be lost)
 * - [ ] Missing intermediate updates is **acceptable** for your use case
 * - [ ] You're experiencing **backpressure** or very high message rates (>60Hz)
 * - [ ] The message is **idempotent** (same value sent twice = same effect as once)
 *
 * If ANY of these are false, use regular `directIpc` methods instead.
 *
 * ### Examples
 *
 * ```typescript
 * // Setup - throttled is automatically available
 * const directIpc = DirectIpcRenderer.instance<MyMessages>({ identifier: 'controller' })
 *
 * // ✅ GOOD: High-frequency state updates (throttled)
 * // Only the final position (1000) will be sent
 * for (let i = 0; i <= 1000; i++) {
 *   directIpc.throttled.sendToIdentifier('output', 'playback-position', i)
 * }
 *
 * // ✅ GOOD: Receive high-frequency updates (throttled)
 * // Listener called once per microtask with latest value
 * directIpc.throttled.on('volume-level', (sender, level) => {
 *   updateVolumeUI(level) // Only latest level shown
 * })
 *
 * // ✅ GOOD: Important user actions (NOT throttled)
 * directIpc.sendToIdentifier('output', 'play-button-clicked')
 *
 * // ✅ GOOD: Unique events (NOT throttled)
 * directIpc.sendToIdentifier('output', 'clip-added', clip)
 *
 * // ✅ GOOD: Mix throttled and non-throttled for different channels
 * directIpc.throttled.sendToIdentifier('output', 'position-update', position)
 * directIpc.sendToIdentifier('output', 'song-changed', songId)
 * ```
 *
 * ### Performance Characteristics
 *
 * - **Latency:** ~1ms added latency (one microtask delay)
 * - **Throughput:** High - parallel sends after coalescing
 * - **Message loss:** 0% for latest value, 100% for intermediate values
 * - **Memory:** O(channels) - one pending message per unique target+channel
 *
 * ### Thread Safety
 *
 * This class is designed for single-threaded use within one renderer process.
 * It is NOT thread-safe across Web Workers or multiple processes.
 *
 * @template TMessageMap - Map of message channels to handler signatures (WITHOUT sender)
 * @template TInvokeMap - Map of invoke channels to handler signatures (WITHOUT sender)
 * @template TIdentifierStrings - Union of allowed identifier strings
 *
 * @example
 * // Access via directIpc.throttled property
 * const directIpc = DirectIpcRenderer.instance<Messages>({ identifier: 'my-window' })
 *
 * // Send throttled messages
 * directIpc.throttled.sendToIdentifier('output', 'cursor-position', x, y)
 *
 * // Receive throttled messages
 * directIpc.throttled.on('mouse-move', (sender, x, y) => {
 *   updateCursor(x, y)
 * })
 * ```
 */
export class DirectIpcThrottled<
  TMessageMap extends EventMap = EventMap,
  TInvokeMap extends InvokeMap = InvokeMap,
  TIdentifierStrings extends string = string,
> {
  /**
   * The underlying DirectIpcRenderer instance
   * Use this for non-throttled operations like invoke/handle
   */
  public readonly directIpc: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >

  /**
   * Pending outgoing messages awaiting send (coalesced by target+channel)
   * Key format: "type:target:channel" where type is "id", "wc", or "url"
   */
  private pendingSends = new Map<
    string,
    {
      target: {
        webContentsId?: number
        identifier?: TIdentifierStrings | RegExp
        url?: string | RegExp
      }
      message: keyof TMessageMap
      args: unknown[]
    }
  >()

  /** Whether a microtask is scheduled for flushing pending sends */
  private sendMicrotaskScheduled = false

  /**
   * Pending incoming messages awaiting dispatch (coalesced by channel)
   */
  private pendingReceives = new Map<
    keyof TMessageMap,
    {
      sender: DirectIpcTarget
      args: unknown[]
    }
  >()

  /** Whether a microtask is scheduled for flushing pending receives */
  private receiveMicrotaskScheduled = false

  /**
   * Listeners registered through this throttled wrapper (per channel)
   * These listeners receive coalesced messages
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private listeners = new Map<keyof TMessageMap, Set<Function>>()

  /** Optional logger (inherited from directIpc if not provided) */
  private log: DirectIpcLogger

  /** Proxy methods (bound in constructor) */
  public readonly handle: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['handle']
  public readonly removeHandler: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['removeHandler']
  public readonly invokeIdentifier: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['invokeIdentifier']
  public readonly invokeWebContentsId: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['invokeWebContentsId']
  public readonly invokeUrl: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['invokeUrl']
  public readonly getMap: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getMap']
  public readonly getMyIdentifier: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getMyIdentifier']
  public readonly setIdentifier: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['setIdentifier']
  public readonly refreshMap: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['refreshMap']
  public readonly setDefaultTimeout: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['setDefaultTimeout']
  public readonly getDefaultTimeout: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getDefaultTimeout']
  public readonly resolveTargetToWebContentsId: DirectIpcRenderer<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['resolveTargetToWebContentsId']

  /**
   * Create a new throttled wrapper around a DirectIpcRenderer instance
   *
   * @param directIpc - The DirectIpcRenderer instance to wrap
   * @param options - Optional configuration
   */
  constructor(
    directIpc: DirectIpcRenderer<TMessageMap, TInvokeMap, TIdentifierStrings>,
    options: { log?: DirectIpcLogger } = {}
  ) {
    this.directIpc = directIpc
    this.log = options.log ?? directIpc['log'] ?? {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }

    // Bind proxy methods in constructor
    this.handle = directIpc.handle.bind(directIpc)
    this.removeHandler = directIpc.removeHandler.bind(directIpc)
    this.invokeIdentifier = directIpc.invokeIdentifier.bind(directIpc)
    this.invokeWebContentsId = directIpc.invokeWebContentsId.bind(directIpc)
    this.invokeUrl = directIpc.invokeUrl.bind(directIpc)
    this.getMap = directIpc.getMap.bind(directIpc)
    this.getMyIdentifier = directIpc.getMyIdentifier.bind(directIpc)
    this.setIdentifier = directIpc.setIdentifier.bind(directIpc)
    this.refreshMap = directIpc.refreshMap.bind(directIpc)
    this.setDefaultTimeout = directIpc.setDefaultTimeout.bind(directIpc)
    this.getDefaultTimeout = directIpc.getDefaultTimeout.bind(directIpc)
    this.resolveTargetToWebContentsId =
      directIpc.resolveTargetToWebContentsId.bind(directIpc)
  }

  // ============================================================================
  // Send Methods (Throttled)
  // ============================================================================

  /**
   * Send a message to a target identified by identifier (throttled)
   *
   * Multiple calls to the same target+channel in one tick will be coalesced,
   * keeping only the latest message. The message is sent on the next microtask.
   *
   * @param identifier - Target identifier string or regex pattern
   * @param message - Message channel name
   * @param args - Message arguments
   */
  async sendToIdentifier<T extends keyof TMessageMap>(
    identifier: TIdentifierStrings | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    const key = `id:${String(identifier)}:${String(message)}`

    this.log?.silly?.(
      `DirectIpcThrottled::sendToIdentifier - Queueing ${String(message)} to ${String(identifier)}`
    )

    // Store latest message (overwrites any previous for same key)
    this.pendingSends.set(key, {
      target: { identifier },
      message,
      args,
    })

    // Schedule send on next microtask
    this.scheduleSend()
  }

  /**
   * Send a message to a target identified by webContentsId (throttled)
   *
   * Multiple calls to the same target+channel in one tick will be coalesced,
   * keeping only the latest message. The message is sent on the next microtask.
   *
   * @param webContentsId - Target webContentsId
   * @param message - Message channel name
   * @param args - Message arguments
   */
  async sendToWebContentsId<T extends keyof TMessageMap>(
    webContentsId: number,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    const key = `wc:${webContentsId}:${String(message)}`

    this.log?.silly?.(
      `DirectIpcThrottled::sendToWebContentsId - Queueing ${String(message)} to ${webContentsId}`
    )

    this.pendingSends.set(key, {
      target: { webContentsId },
      message,
      args,
    })

    this.scheduleSend()
  }

  /**
   * Send a message to a target identified by URL (throttled)
   *
   * Multiple calls to the same target+channel in one tick will be coalesced,
   * keeping only the latest message. The message is sent on the next microtask.
   *
   * @param url - Target URL string or regex pattern
   * @param message - Message channel name
   * @param args - Message arguments
   */
  async sendToUrl<T extends keyof TMessageMap>(
    url: string | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    const key = `url:${String(url)}:${String(message)}`

    this.log?.silly?.(
      `DirectIpcThrottled::sendToUrl - Queueing ${String(message)} to ${String(url)}`
    )

    this.pendingSends.set(key, {
      target: { url },
      message,
      args,
    })

    this.scheduleSend()
  }

  /**
   * Send a message to all targets matching identifier pattern (throttled)
   *
   * Coalesces messages per unique pattern+channel combination.
   * The message is sent on the next microtask to all matching targets.
   *
   * @param identifier - Identifier pattern
   * @param message - Message channel name
   * @param args - Message arguments
   */
  async sendToAllIdentifiers<T extends keyof TMessageMap>(
    identifier: TIdentifierStrings | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    const key = `allid:${String(identifier)}:${String(message)}`

    this.log?.silly?.(
      `DirectIpcThrottled::sendToAllIdentifiers - Queueing ${String(message)} to pattern ${String(identifier)}`
    )

    this.pendingSends.set(key, {
      target: { identifier },
      message,
      args,
    })

    this.scheduleSend()
  }

  /**
   * Send a message to all targets matching URL pattern (throttled)
   *
   * Coalesces messages per unique pattern+channel combination.
   * The message is sent on the next microtask to all matching targets.
   *
   * @param url - URL pattern
   * @param message - Message channel name
   * @param args - Message arguments
   */
  async sendToAllUrls<T extends keyof TMessageMap>(
    url: string | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    const key = `allurl:${String(url)}:${String(message)}`

    this.log?.silly?.(
      `DirectIpcThrottled::sendToAllUrls - Queueing ${String(message)} to pattern ${String(url)}`
    )

    this.pendingSends.set(key, {
      target: { url },
      message,
      args,
    })

    this.scheduleSend()
  }

  /**
   * Schedule pending sends to be flushed on next microtask
   */
  private scheduleSend(): void {
    if (this.sendMicrotaskScheduled) return

    this.sendMicrotaskScheduled = true
    queueMicrotask(() => {
      this.flushSends().catch((error) => {
        this.log?.error?.(
          'DirectIpcThrottled::flushSends - Error flushing sends:',
          error
        )
      })
      this.sendMicrotaskScheduled = false
    })
  }

  /**
   * Flush all pending sends in parallel
   */
  private async flushSends(): Promise<void> {
    if (this.pendingSends.size === 0) return

    this.log?.silly?.(
      `DirectIpcThrottled::flushSends - Flushing ${this.pendingSends.size} pending sends`
    )

    const sends = Array.from(this.pendingSends.values())
    this.pendingSends.clear()

    // Send all coalesced messages in parallel
    await Promise.all(
      sends.map(({ target, message, args }) => {
        if (target.webContentsId !== undefined) {
          return this.directIpc.sendToWebContentsId(
            target.webContentsId,
            message,

            ...(args as any)
          )
        } else if (target.identifier !== undefined) {
          // Check if this is a sendToAll* operation (identifier could be regex)
          const isMultiTarget =
            typeof target.identifier !== 'string' ||
            this.directIpc
              .getMap()
              .filter((t) => t.identifier === target.identifier).length > 1

          if (isMultiTarget) {
            return this.directIpc.sendToAllIdentifiers(
              target.identifier,
              message,

              ...(args as any)
            )
          } else {
            return this.directIpc.sendToIdentifier(
              target.identifier,
              message,

              ...(args as any)
            )
          }
        } else if (target.url !== undefined) {
          // Check if this is a sendToAll* operation
          const isMultiTarget =
            target.url instanceof RegExp ||
            this.directIpc.getMap().filter((t) => t.url === target.url).length >
              1

          if (isMultiTarget) {
            return this.directIpc.sendToAllUrls(
              target.url,
              message,

              ...(args as any)
            )
          } else {
            return this.directIpc.sendToUrl(
              target.url,
              message,

              ...(args as any)
            )
          }
        }
      })
    )
  }

  // ============================================================================
  // Receive Methods (Throttled)
  // ============================================================================

  /**
   * Register a listener for throttled message reception
   *
   * Multiple messages on the same channel received in one tick will be
   * coalesced, and the listener will be called once with the latest value
   * on the next microtask.
   *
   * @param event - Channel name to listen on
   * @param listener - Handler function (receives sender + message args)
   * @returns This instance for chaining
   */
  on<E extends keyof WithSender<TMessageMap>>(
    event: E,
    listener: WithSender<TMessageMap>[E]
  ): this {
    this.log?.silly?.(
      `DirectIpcThrottled::on - Registering throttled listener for ${String(event)}`
    )

    // Track this listener
    if (!this.listeners.has(event as keyof TMessageMap)) {
      this.listeners.set(event as keyof TMessageMap, new Set())

      // Register internal coalescing handler on directIpc (only once per channel)
      this.directIpc.on(
        event,
        this.createCoalescingHandler(event as keyof TMessageMap) as any
      )
    }

    this.listeners.get(event as keyof TMessageMap)!.add(listener)

    return this
  }

  /**
   * Remove a throttled listener
   *
   * @param event - Channel name
   * @param listener - Handler function to remove
   * @returns This instance for chaining
   */
  off<E extends keyof WithSender<TMessageMap>>(
    event: E,
    listener: WithSender<TMessageMap>[E]
  ): this {
    this.log?.silly?.(
      `DirectIpcThrottled::off - Removing throttled listener for ${String(event)}`
    )

    const listeners = this.listeners.get(event as keyof TMessageMap)
    if (listeners) {
      listeners.delete(listener)

      // If no more throttled listeners for this channel, clean up
      if (listeners.size === 0) {
        this.listeners.delete(event as keyof TMessageMap)
        // Note: We don't remove the internal handler from directIpc
        // because EventEmitter doesn't provide a way to identify specific handlers
        // This is a minor memory leak if channels are registered/unregistered frequently
        // but acceptable for most use cases
      }
    }

    return this
  }

  /**
   * Create a coalescing handler that queues incoming messages
   * This is the internal handler registered with directIpc
   */
  private createCoalescingHandler(channel: keyof TMessageMap) {
    return (sender: DirectIpcTarget, ...args: unknown[]) => {
      this.log?.silly?.(
        `DirectIpcThrottled::coalescingHandler - Queueing received message on ${String(channel)}`
      )

      // Store latest received message (overwrites previous for same channel)
      this.pendingReceives.set(channel, { sender, args })

      // Schedule emission on next microtask
      this.scheduleReceive()
    }
  }

  /**
   * Schedule pending receives to be flushed on next microtask
   */
  private scheduleReceive(): void {
    if (this.receiveMicrotaskScheduled) return

    this.receiveMicrotaskScheduled = true
    queueMicrotask(() => {
      this.flushReceives()
      this.receiveMicrotaskScheduled = false
    })
  }

  /**
   * Flush all pending receives to registered listeners
   */
  private flushReceives(): void {
    if (this.pendingReceives.size === 0) return

    this.log?.silly?.(
      `DirectIpcThrottled::flushReceives - Flushing ${this.pendingReceives.size} pending receives`
    )

    for (const [channel, { sender, args }] of this.pendingReceives.entries()) {
      const listeners = this.listeners.get(channel)
      if (!listeners || listeners.size === 0) continue

      // Call all listeners with latest coalesced value
      for (const listener of listeners) {
        try {
          listener(sender, ...args)
        } catch (error) {
          this.log?.error?.(
            `DirectIpcThrottled::flushReceives - Listener error on ${String(channel)}:`,
            error
          )
          // Continue calling other listeners even if one fails
        }
      }
    }

    this.pendingReceives.clear()
  }

  // ============================================================================
  // Proxy Properties (Non-Throttled - pass through to directIpc)
  // ============================================================================
  // Note: Proxy methods are bound in the constructor above
  /**
   * Access to localEvents emitter for non-throttled DirectIpc internal events
   * (target-added, target-removed, map-updated, message)
   */
  get localEvents(): TypedEventEmitter<DirectIpcEventMap> {
    return this.directIpc.localEvents
  }
}
