import {
  DirectIpcLogger,
  EventMap,
  InvokeMap,
  TargetSelector,
  TypedEventEmitter,
  WithSender,
  DirectIpcEventMap,
} from '../common/index.js'
import { DirectIpcTarget } from '../common/DirectIpcCommunication.js'
import { DirectIpcUtility } from './DirectIpcUtility.js'

/**
 * ## DirectIpcUtilityThrottled - Lossy Message Coalescing for Utility Processes
 *
 * **Note:** You typically access this via `directIpc.throttled` rather than creating
 * instances directly. DirectIpcUtility automatically creates a throttled instance.
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
 * ### Performance Characteristics
 *
 * - **Latency:** ~1ms added latency (one microtask delay)
 * - **Throughput:** High - parallel sends after coalescing
 * - **Message loss:** 0% for latest value, 100% for intermediate values
 * - **Memory:** O(channels) - one pending message per unique target+channel
 *
 * @template TMessageMap - Map of message channels to handler signatures (WITHOUT sender)
 * @template TInvokeMap - Map of invoke channels to handler signatures (WITHOUT sender)
 * @template TIdentifierStrings - Union of allowed identifier strings
 */
export class DirectIpcUtilityThrottled<
  TMessageMap extends EventMap = EventMap,
  TInvokeMap extends InvokeMap = InvokeMap,
  TIdentifierStrings extends string = string,
> {
  /**
   * The underlying DirectIpcUtility instance
   * Use this for non-throttled operations like invoke/handle
   */
  public readonly directIpc: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >

  /**
   * Pending outgoing messages awaiting send (coalesced by target+channel)
   * Key format: "type:target:channel" where type is "id", "wc", "url", "allid", or "allurl"
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
      targetType: 'single' | 'multiple'
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
  public readonly handle: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['handle']
  public readonly removeHandler: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['removeHandler']
  public readonly invoke: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['invoke']
  public readonly getMap: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getMap']
  public readonly getMyIdentifier: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getMyIdentifier']
  public readonly setDefaultTimeout: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['setDefaultTimeout']
  public readonly getDefaultTimeout: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getDefaultTimeout']
  public readonly getRegistrationState: DirectIpcUtility<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >['getRegistrationState']

  /**
   * Create a new throttled wrapper around a DirectIpcUtility instance
   *
   * @param directIpc - The DirectIpcUtility instance to wrap
   * @param options - Optional configuration
   */
  constructor(
    directIpc: DirectIpcUtility<TMessageMap, TInvokeMap, TIdentifierStrings>,
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
    this.invoke = directIpc.invoke.bind(directIpc)
    this.getMap = directIpc.getMap.bind(directIpc)
    this.getMyIdentifier = directIpc.getMyIdentifier.bind(directIpc)
    this.setDefaultTimeout = directIpc.setDefaultTimeout.bind(directIpc)
    this.getDefaultTimeout = directIpc.getDefaultTimeout.bind(directIpc)
    this.getRegistrationState = directIpc.getRegistrationState.bind(directIpc)
  }

  // ============================================================================
  // Send Methods (Throttled)
  // ============================================================================

  /**
   * Send a message to target process(es) using a TargetSelector (throttled)
   *
   * Multiple calls to the same target+channel in one tick will be coalesced,
   * keeping only the latest message. The message is sent on the next microtask.
   *
   * @param target - TargetSelector specifying which process(es) to send to
   * @param message - Message channel name
   * @param args - Message arguments
   *
   * @example
   * // Send to single identifier (throttled)
   * directIpc.throttled.send({ identifier: 'renderer' }, 'cursor-position', x, y)
   *
   * // Send to webContentsId (throttled)
   * directIpc.throttled.send({ webContentsId: 123 }, 'update', data)
   *
   * // Send to all matching identifiers (throttled)
   * directIpc.throttled.send({ allIdentifiers: /^renderer/ }, 'broadcast', msg)
   */
  async send<T extends keyof TMessageMap>(
    target: TargetSelector<TIdentifierStrings>,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => unknown ? P : never
  ): Promise<void> {
    // Generate coalescing key based on target type
    let key: string
    let targetForSend: {
      webContentsId?: number
      identifier?: TIdentifierStrings | RegExp
      url?: string | RegExp
    }
    let targetType: 'single' | 'multiple' = 'single'

    if ('webContentsId' in target) {
      key = `wc:${target.webContentsId}:${String(message)}`
      targetForSend = { webContentsId: target.webContentsId }
      this.log?.silly?.(
        `DirectIpcUtilityThrottled::send - Queueing ${String(message)} to webContentsId ${target.webContentsId}`
      )
    } else if ('identifier' in target) {
      key = `id:${String(target.identifier)}:${String(message)}`
      targetForSend = { identifier: target.identifier }
      this.log?.silly?.(
        `DirectIpcUtilityThrottled::send - Queueing ${String(message)} to identifier ${String(target.identifier)}`
      )
    } else if ('url' in target) {
      key = `url:${String(target.url)}:${String(message)}`
      targetForSend = { url: target.url }
      this.log?.silly?.(
        `DirectIpcUtilityThrottled::send - Queueing ${String(message)} to url ${String(target.url)}`
      )
    } else if ('allIdentifiers' in target) {
      key = `allid:${String(target.allIdentifiers)}:${String(message)}`
      targetForSend = { identifier: target.allIdentifiers }
      targetType = 'multiple'
      this.log?.silly?.(
        `DirectIpcUtilityThrottled::send - Queueing ${String(message)} to allIdentifiers ${String(target.allIdentifiers)}`
      )
    } else if ('allUrls' in target) {
      key = `allurl:${String(target.allUrls)}:${String(message)}`
      targetForSend = { url: target.allUrls }
      targetType = 'multiple'
      this.log?.silly?.(
        `DirectIpcUtilityThrottled::send - Queueing ${String(message)} to allUrls ${String(target.allUrls)}`
      )
    } else {
      throw new Error('DirectIpcUtilityThrottled::send - Invalid target selector')
    }

    // Store latest message (overwrites any previous for same key)
    this.pendingSends.set(key, {
      target: targetForSend,
      message,
      args,
      targetType,
    })

    // Schedule send on next microtask
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
          'DirectIpcUtilityThrottled::flushSends - Error flushing sends:',
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
      `DirectIpcUtilityThrottled::flushSends - Flushing ${this.pendingSends.size} pending sends`
    )

    const sends = Array.from(this.pendingSends.values())
    this.pendingSends.clear()

    // Send all coalesced messages in parallel
    await Promise.all(
      sends.map(({ target, message, args, targetType }) => {
        // Build TargetSelector based on target and targetType
        let targetSelector: TargetSelector<TIdentifierStrings>

        if (target.webContentsId !== undefined) {
          targetSelector = { webContentsId: target.webContentsId }
        } else if (target.identifier !== undefined) {
          targetSelector =
            targetType === 'multiple'
              ? { allIdentifiers: target.identifier }
              : { identifier: target.identifier }
        } else if (target.url !== undefined) {
          targetSelector =
            targetType === 'multiple'
              ? { allUrls: target.url }
              : { url: target.url }
        } else {
          return Promise.resolve()
        }

        return this.directIpc.send(targetSelector, message, ...(args as never))
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
      `DirectIpcUtilityThrottled::on - Registering throttled listener for ${String(event)}`
    )

    // Track this listener
    if (!this.listeners.has(event as keyof TMessageMap)) {
      this.listeners.set(event as keyof TMessageMap, new Set())

      // Register internal coalescing handler on directIpc (only once per channel)
      this.directIpc.on(
        event,
        this.createCoalescingHandler(event as keyof TMessageMap) as never
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
      `DirectIpcUtilityThrottled::off - Removing throttled listener for ${String(event)}`
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
        `DirectIpcUtilityThrottled::coalescingHandler - Queueing received message on ${String(channel)}`
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
      `DirectIpcUtilityThrottled::flushReceives - Flushing ${this.pendingReceives.size} pending receives`
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
            `DirectIpcUtilityThrottled::flushReceives - Listener error on ${String(channel)}:`,
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
