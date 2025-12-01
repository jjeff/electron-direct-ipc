import { ipcRenderer } from 'electron'
import { EventEmitter } from 'events'
import {
  DIRECT_IPC_CHANNELS,
  DirectIpcMapUpdateMessage,
  DirectIpcPortMessage,
  DirectIpcTarget,
} from '../common/DirectIpcCommunication.js'
import {
  DirectIpcLogger,
  consoleLogger,
} from '../common/DirectIpcLogger.js'
import { DirectIpcThrottled } from './DirectIpcThrottled.js'

type Awaitable<T> = T | Promise<T>

/**
 * Utility type to expand/prettify complex types in IDE tooltips
 */
type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

export interface EventMap {
  [key: string]: (...args: any[]) => any
}

export interface InvokeMap {
  [key: string]: (...args: any[]) => Awaitable<any>
}

/**
 * Options for DirectIpcRenderer
 * @template TIdentifierStrings - Union of allowed identifier strings
 */
export interface DirectIpcRendererOptions<
  TIdentifierStrings extends string = string,
> {
  log?: DirectIpcLogger
  identifier?: TIdentifierStrings
  defaultTimeout?: number
}

/**
 * Dependencies for DirectIpcRenderer (for testing/injection)
 */
export interface DirectIpcRendererDependencies {
  ipcRenderer?: typeof ipcRenderer
}

/**
 * Options for invoke calls
 */
export interface InvokeOptions {
  timeout?: number
}

/**
 * Message format for regular DirectIpc messages
 * args is the tuple of arguments expected by the event handler (Parameters<> of the handler function)
 */
export type DirectIpcMessage<
  TMessageMap extends EventMap = EventMap,
  K extends keyof TMessageMap = keyof TMessageMap,
> = {
  message: K
  args: Parameters<TMessageMap[K]>
}

/**
 * Message format for invoke/handle pattern
 */
type InvokeMessage = {
  type: 'invoke'
  channel: string
  requestId: string
  args: unknown[]
}

type InvokeResponse = {
  type: 'invoke-response'
  requestId: string
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Handler function type for invoke/handle pattern
 */
type InvokeHandler<T extends InvokeMap = InvokeMap> = (
  ...args: Parameters<T[keyof T]>
) => Promise<ReturnType<T[keyof T]>> | ReturnType<T[keyof T]>

/**
 * Base event map for DirectIpcRenderer internal events
 * These events do NOT include sender as first argument
 */
export type DirectIpcEventMap = {
  'target-added': (target: DirectIpcTarget) => void
  'target-removed': (target: DirectIpcTarget) => void
  'message-port-added': (target: DirectIpcTarget) => void
  'map-updated': (map: DirectIpcTarget[]) => void
  message: (sender: DirectIpcTarget, message: unknown) => void
}

/**
 * Cached port information
 */
interface CachedPort {
  port: MessagePort
  info: DirectIpcTarget
}

/**
 * Prepends 'sender: DirectIpcTarget' to every handler function in an EventMap (event name already identifies channel).
 */
type WithSender<T extends EventMap> = {
  [K in keyof T]: (
    sender: DirectIpcTarget,
    ...args: Parameters<T[K]>
  ) => ReturnType<T[K]>
}

export interface TypedEventEmitter<Events extends EventMap> {
  addListener<E extends keyof Events>(event: E, listener: Events[E]): this
  on<E extends keyof Events>(event: E, listener: Events[E]): this
  once<E extends keyof Events>(event: E, listener: Events[E]): this
  prependListener<E extends keyof Events>(event: E, listener: Events[E]): this
  prependOnceListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): this

  off<E extends keyof Events>(event: E, listener: Events[E]): this
  removeAllListeners<E extends keyof Events>(event?: E): this
  removeListener<E extends keyof Events>(event: E, listener: Events[E]): this
  emit<Event extends keyof Events>(
    event: Event | Event[],
    ...values: Parameters<Events[Event]>
  ): boolean
  // The sloppy `eventNames()` return type is to mitigate type incompatibilities - see #5
  eventNames(): (keyof Events | string | symbol)[]
  rawListeners<E extends keyof Events>(event: E): Events[E][]
  listeners<E extends keyof Events>(event: E): Events[E][]
  listenerCount<E extends keyof Events>(event: E): number

  getMaxListeners(): number
  setMaxListeners(maxListeners: number): this
}

/**
 * Renderer process DirectIpc client
 * Provides type-safe direct communication between renderer processes
 * @template TMessageMap - Map of message channels to their handler function signatures (WITHOUT sender)
 * @template TInvokeMap - Map of invoke channels to their handler function signatures (WITHOUT sender)
 * @template TIdentifierStrings - Union of allowed identifier strings for type-safe identifier usage
 *
 * Note: When listening to events from TMessageMap or TInvokeMap, the listener signature
 * will automatically include 'sender: DirectIpcTarget' as the first parameter.
 */
export class DirectIpcRenderer<
  TMessageMap extends EventMap = EventMap,
  TInvokeMap extends InvokeMap = InvokeMap,
  TIdentifierStrings extends string = string,
> extends (EventEmitter as {
  new <TMessageMap extends EventMap>(): Prettify<
    TypedEventEmitter<WithSender<TMessageMap>>
  >
})<TMessageMap> {
  // singleton
  private static _instance: DirectIpcRenderer | null = null

  /**
   * Get the singleton instance
   * If identifier is provided, sets/updates the identifier
   * @template TMessageMap - Map of message channels to their handler function signatures
   * @template TInvokeMap - Map of invoke channels to their handler function signatures
   * @template TProcessIdentifier - Union of allowed identifier strings for type-safe identifier usage
   */
  public static instance<
    TMessageMap extends EventMap = EventMap,
    TInvokeMap extends InvokeMap = InvokeMap,
    TProcessIdentifier extends string = string,
  >(
    options?: DirectIpcRendererOptions<TProcessIdentifier>
  ): DirectIpcRenderer<TMessageMap, TInvokeMap, TProcessIdentifier> {
    if (!DirectIpcRenderer._instance) {
      DirectIpcRenderer._instance = DirectIpcRenderer._createInstance(options)
    }
    if (options) {
      const { identifier, log, defaultTimeout } = options
      if (identifier) {
        DirectIpcRenderer._instance.setIdentifier(identifier).catch((error) => {
          DirectIpcRenderer._instance?.log.error?.(
            'DirectIpcRenderer::instance - setIdentifier failed:',
            error
          )
        })
      }
      if (log) {
        DirectIpcRenderer._instance.log = log
      }
      if (defaultTimeout !== undefined) {
        DirectIpcRenderer._instance.setDefaultTimeout(defaultTimeout)
      }
    }
    return DirectIpcRenderer._instance as DirectIpcRenderer<
      TMessageMap,
      TInvokeMap,
      TProcessIdentifier
    >
  }

  /**
   * Create a new instance of DirectIpcRenderer (for testing purposes only)
   * @internal
   * @template TMessageMap - Map of message channels to their handler function signatures
   * @template TInvokeMap - Map of invoke channels to their handler function signatures
   * @template TProcessIdentifier - Union of allowed identifier strings for type-safe identifier usage
   */
  public static _createInstance<
    TMessageMap extends EventMap = EventMap,
    TInvokeMap extends InvokeMap = InvokeMap,
    TProcessIdentifier extends string = string,
  >(
    options?: DirectIpcRendererOptions<TProcessIdentifier>,
    dependencies?: DirectIpcRendererDependencies
  ): DirectIpcRenderer<TMessageMap, TInvokeMap, TProcessIdentifier> {
    return new DirectIpcRenderer(options, dependencies) as DirectIpcRenderer<
      TMessageMap,
      TInvokeMap,
      TProcessIdentifier
    >
  }

  /** Dependencies */
  private d: Required<DirectIpcRendererDependencies>

  /** Logger */
  private log: DirectIpcLogger

  /** Current map of all registered renderers */
  private map: DirectIpcTarget[] = []

  /** Cached ports to other renderers, keyed by webContentsId */
  private portCache = new Map<number, CachedPort>()

  /** Registry of handlers for invoke/handle pattern */
  private handlers = new Map<string, InvokeHandler>()

  /** Pending invoke requests waiting for responses */
  private pendingInvokes = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()

  /** Counter for generating unique request IDs */
  private requestIdCounter = 0

  /** Default timeout for invoke calls (ms) */
  private defaultTimeout = 5000

  /** This renderer's optional identifier */
  private myIdentifier?: TIdentifierStrings

  public readonly localEvents =
    new EventEmitter() as TypedEventEmitter<DirectIpcEventMap>

  /**
   * Throttled message sending/receiving for high-frequency updates.
   * Use this for lossy communication where only the latest value matters.
   *
   * @example
   * // High-frequency position updates (throttled)
   * directIpc.throttled.sendToIdentifier('output', 'position-update', x, y)
   *
   * // Important events (not throttled)
   * directIpc.sendToIdentifier('output', 'button-clicked')
   */
  public readonly throttled: import('./DirectIpcThrottled').DirectIpcThrottled<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >

  private constructor(
    options: DirectIpcRendererOptions<TIdentifierStrings> = {},
    dependencies: DirectIpcRendererDependencies = {}
  ) {
    super()

    this.d = {
      ipcRenderer: dependencies.ipcRenderer ?? ipcRenderer,
    }

    this.log = options.log ?? consoleLogger

    // Set default timeout from options if provided
    if (options.defaultTimeout !== undefined) {
      this.defaultTimeout = options.defaultTimeout
    }

    this.setupIpcListeners()
    this.subscribe(options.identifier)

    // Initialize throttled wrapper after other setup
    this.throttled = new DirectIpcThrottled(this, { log: this.log })
  }

  /**
   * Set up IPC listeners for messages from main process
   */
  private setupIpcListeners(): void {
    // Listen for map updates
    this.d.ipcRenderer.on(
      DIRECT_IPC_CHANNELS.MAP_UPDATE,
      (_event, message: DirectIpcMapUpdateMessage) => {
        this.handleMapUpdate(message.map)
      }
    )

    // Listen for port messages
    this.d.ipcRenderer.on(
      DIRECT_IPC_CHANNELS.PORT_MESSAGE,
      (event, message: DirectIpcPortMessage) => {
        const port = event.ports[0]
        if (!port) {
          this.log.error?.('DirectIpcRenderer::PORT_MESSAGE - No port in event')
          return
        }

        this.handlePortMessage(port, message.sender)
      }
    )
  }

  /**
   * Subscribe to the DirectIpc system
   */
  private async subscribe(identifier?: TIdentifierStrings): Promise<void> {
    try {
      const map = await this.d.ipcRenderer.invoke(
        DIRECT_IPC_CHANNELS.SUBSCRIBE,
        identifier
      )
      this.handleMapUpdate(map)
      if (identifier) {
        this.myIdentifier = identifier
      }
    } catch (error) {
      this.log.error?.('DirectIpcRenderer::subscribe - Failed:', error)
      throw error
    }
  }

  /**
   * Set or update this renderer's identifier
   * @param identifier - The identifier string to set (must be one of TIdentifierStrings)
   */
  async setIdentifier(identifier: TIdentifierStrings): Promise<void> {
    try {
      if (this.myIdentifier === identifier) {
        return
      }
      await this.d.ipcRenderer.invoke(
        DIRECT_IPC_CHANNELS.UPDATE_IDENTIFIER,
        identifier
      )
      this.myIdentifier = identifier
      this.log.silly?.(
        `DirectIpcRenderer::setIdentifier - Set to ${identifier}`
      )
    } catch (error) {
      this.log.error?.('DirectIpcRenderer::setIdentifier - Failed:', error)
      throw error
    }
  }

  /**
   * Handle incoming map update
   */
  private handleMapUpdate(newMap: DirectIpcTarget[]): void {
    this.log.silly?.('DirectIpcRenderer::handleMapUpdate', newMap)

    // Detect removed targets
    const newWebContentsIds = new Set(newMap.map((t) => t.webContentsId))
    for (const oldTarget of this.map) {
      if (!newWebContentsIds.has(oldTarget.webContentsId)) {
        this.localEvents.emit('target-removed', oldTarget)
        // Clean up cached port
        const cached = this.portCache.get(oldTarget.webContentsId)
        if (cached) {
          cached.port.close()
          this.portCache.delete(oldTarget.webContentsId)
        }
      }
    }

    // Detect added targets
    const oldWebContentsIds = new Set(this.map.map((t) => t.webContentsId))
    for (const newTarget of newMap) {
      if (!oldWebContentsIds.has(newTarget.webContentsId)) {
        this.localEvents.emit('target-added', newTarget)
      }
    }

    this.map = newMap
    this.localEvents.emit('map-updated', newMap)
  }

  /**
   * Handle incoming MessagePort from main process
   */
  private handlePortMessage(
    port: MessagePort,
    senderInfo: DirectIpcTarget
  ): void {
    this.log.silly?.('DirectIpcRenderer::handlePortMessage', senderInfo)

    // Set up port message handler
    port.onmessage = (
      e: MessageEvent<
        DirectIpcMessage<TMessageMap> | InvokeMessage | InvokeResponse
      >
    ) => {
      const data = e.data

      // Handle invoke responses
      if (data && typeof data === 'object' && 'type' in data) {
        if (data.type === 'invoke-response') {
          this.handleInvokeResponse(data as InvokeResponse)
          return
        } else if (data.type === 'invoke') {
          this.handleInvokeRequest(port, data as InvokeMessage)
          return
        }
      }

      // Handle regular DirectIPC messages
      const m = data as Prettify<DirectIpcMessage<TMessageMap>>
      this.localEvents.emit('message', senderInfo, m)
      // Also emit the specific message type
      this.emit(
        m.message,
        ...([senderInfo, ...m.args] as Parameters<
          WithSender<TMessageMap>[keyof TMessageMap]
        >)
      )
    }

    // Set up port close handler
    port.addEventListener('close', () => {
      this.log.silly?.(
        `DirectIpcRenderer::port.close - port closed for webContentsId ${senderInfo.webContentsId}`
      )
      this.portCache.delete(senderInfo.webContentsId)
    })

    port.start()

    // Cache the port
    this.portCache.set(senderInfo.webContentsId, {
      port,
      info: senderInfo,
    })

    // Emit message-port-added event so getPort() promises can resolve
    this.localEvents.emit('message-port-added', senderInfo)
  }

  /**
   * Resolve a target to its webContentsId using the local map
   */
  public resolveTargetToWebContentsId(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): number | undefined {
    // If webContentsId is directly provided, return it
    if (target.webContentsId !== undefined) {
      return target.webContentsId
    }

    // Search by identifier
    if (target.identifier !== undefined) {
      if (typeof target.identifier === 'string') {
        // Exact match
        const match = this.map.find((t) => t.identifier === target.identifier)
        return match ? match.webContentsId : undefined
      } else if (target.identifier instanceof RegExp) {
        const regex = target.identifier

        const matches = this.map.filter(
          (t) => t.identifier && regex.test(t.identifier)
        )

        if (matches.length === 1) {
          return matches[0]!.webContentsId
        } else if (matches.length > 1) {
          throw new Error(
            'DirectIpcRenderer::Multiple matches found for identifier regex'
          )
        }
        // No matches - return undefined
        return undefined
      }
    }

    // Search by URL
    if (target.url !== undefined) {
      if (typeof target.url === 'string') {
        // Exact match
        const match = this.map.find((t) => t.url === target.url)
        return match ? match.webContentsId : undefined
      } else if (target.url instanceof RegExp) {
        const regex = target.url

        const matches = this.map.filter((t) => regex.test(t.url))

        if (matches.length === 1) {
          return matches[0]!.webContentsId
        } else if (matches.length > 1) {
          throw new Error(
            'DirectIpcRenderer::Multiple matches found for URL regex'
          )
        }
        // No matches - return undefined
        return undefined
      }
    }

    return undefined
  }

  /**
   * Get or create a port to a target renderer
   */
  private async getPort(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): Promise<MessagePort> {
    // Try to resolve the target to a webContentsId using our local map
    // This allows us to check the cache even when searching by identifier/URL
    const webContentsId = this.resolveTargetToWebContentsId(target)

    // Check if we already have a cached port for this webContentsId
    if (webContentsId !== undefined) {
      const cached = this.portCache.get(webContentsId)
      if (cached) {
        this.log.silly?.(
          `DirectIpcRenderer::getPort - Using cached port for webContentsId ${webContentsId}`
        )
        return cached.port
      }
    }

    // Set up promise to wait for port before invoking
    const portPromise = new Promise<MessagePort>((resolve, reject) => {
      const messagePortAddedListener = (addedTarget: DirectIpcTarget) => {
        // Check if this is the target we're waiting for
        let isMatch = false

        if (target.webContentsId !== undefined) {
          isMatch = addedTarget.webContentsId === target.webContentsId
        } else if (target.identifier !== undefined) {
          const regex =
            typeof target.identifier === 'string'
              ? new RegExp(`^${target.identifier}$`)
              : target.identifier
          isMatch = addedTarget.identifier
            ? regex.test(addedTarget.identifier)
            : false
        } else if (target.url !== undefined) {
          const regex =
            typeof target.url === 'string' ? new RegExp(target.url) : target.url
          isMatch = regex.test(addedTarget.url)
        }

        if (isMatch) {
          clearTimeout(timeout)
          this.off('message-port-added', messagePortAddedListener as any)
          const cached = this.portCache.get(addedTarget.webContentsId)
          if (cached) {
            resolve(cached.port)
          } else {
            reject(new Error('Port was added but not cached'))
          }
        }
      }

      const timeout = setTimeout(() => {
        this.off('message-port-added', messagePortAddedListener as any)
        this.log.error?.(
          `DirectIpcRenderer::getPort - Timeout waiting for port: ${JSON.stringify(target)}`,
          target
        )
        reject(new Error('Timeout waiting for MessagePort'))
      }, this.defaultTimeout)

      // Listen for the message-port-added event
      this.localEvents.on('message-port-added', messagePortAddedListener)
    })

    // Request port from main process
    const success = await this.d.ipcRenderer.invoke(
      DIRECT_IPC_CHANNELS.GET_PORT,
      target
    )

    if (!success) {
      throw new Error('DirectIpc: Failed to get port for target')
    }

    // Wait for the port to arrive via the event listener
    return portPromise
  }

  /**
   * Send a message to a target identified by webContentsId
   */
  async sendToWebContentsId<T extends keyof TMessageMap>(
    webContentsId: number,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    const port = await this.getPort({ webContentsId })
    if (!port) {
      throw new Error(
        `DirectIpcRenderer::sendToWebContentsId - No port found for webContentsId ${webContentsId}`
      )
    }
    port.postMessage({ message, args })
  }

  /**
   * Send a message to a target identified by identifier
   * Throws if multiple matches found
   * @param identifier - The identifier string or regex pattern (string must be one of TIdentifierStrings)
   */
  async sendToIdentifier<T extends keyof TMessageMap>(
    identifier: TIdentifierStrings | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    const port = await this.getPort({ identifier })
    if (!port) {
      throw new Error(
        `DirectIpcRenderer::sendToIdentifier - No port found for "${identifier}"`
      )
    }
    port.postMessage({ message, args })
  }

  /**
   * Send a message to a target identified by URL pattern
   * Throws if multiple matches found
   */
  async sendToUrl<T extends keyof TMessageMap>(
    url: string | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    const port = await this.getPort({ url })
    if (!port) {
      throw new Error(
        `DirectIpcRenderer::sendToUrl - No port found for "${url}"`
      )
    }
    port.postMessage({ message, args })
  }

  /**
   * Send a message to all targets matching identifier pattern
   * @param identifier - The identifier string or regex pattern (string must be one of TIdentifierStrings)
   */
  async sendToAllIdentifiers<T extends keyof TMessageMap>(
    identifier: TIdentifierStrings | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    const regex =
      typeof identifier === 'string' ? new RegExp(identifier) : identifier
    const targets = this.map.filter(
      (p) => p.identifier && regex.test(p.identifier)
    )
    // warn if no targets found
    if (targets.length === 0) {
      this.log.warn?.(
        `DirectIpcRenderer::sendToAllIdentifiers - No targets found for identifier pattern "${identifier}"`
      )
      return
    }

    this.log.silly?.(
      `DirectIpcRenderer::sendToAllIdentifiers - Sending to ${targets.length} targets for pattern "${identifier}" with message "${message as string}"`
    )

    await Promise.all(
      targets.map((target) =>
        this.sendToWebContentsId(target.webContentsId, message, ...args)
      )
    )
  }

  /**
   * Send a message to all targets matching URL pattern
   */
  async sendToAllUrls<T extends keyof TMessageMap>(
    url: string | RegExp,
    message: T,
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    const regex = typeof url === 'string' ? new RegExp(url) : url
    const targets = this.map.filter((p) => regex.test(p.url))

    await Promise.all(
      targets.map((target) =>
        this.sendToWebContentsId(target.webContentsId, message, ...args)
      )
    )
  }

  /**
   * Register a handler for invoke calls on a specific channel
   */
  handle<T extends keyof TInvokeMap>(
    channel: T,
    handler: WithSender<TInvokeMap>[T]
  ): void {
    this.log.silly?.(
      'DirectIpcRenderer::handle - Registering handler for channel'
    )
    if (this.handlers.has(channel as string)) {
      this.log.warn?.(
        `DirectIpcRenderer::handle - Handler already exists for ${channel as string}, replacing`
      )
    }
    this.handlers.set(channel as string, handler as InvokeHandler)
  }

  /**
   * Remove a handler for a specific channel
   */
  removeHandler<T extends keyof TInvokeMap>(channel: T): void {
    this.log.silly?.(
      `DirectIpcRenderer::removeHandler - Removing handler for ${channel as string}`
    )
    this.handlers.delete(channel as string)
  }

  /**
   * Invoke a handler on a remote renderer by webContentsId
   */
  async invokeWebContentsId<T extends keyof TInvokeMap>(
    webContentsId: number,
    channel: T,
    ...args: [
      ...params: TInvokeMap[T] extends (...args: infer P) => any ? P : never,
      options?: InvokeOptions,
    ]
  ): Promise<
    TInvokeMap[T] extends (...args: any[]) => infer R ? Awaited<R> : unknown
  > {
    const port = await this.getPort({ webContentsId })
    // Extract options from the last argument if it's an InvokeOptions object
    const lastArg = args[args.length - 1]
    const isOptionsObject =
      lastArg &&
      typeof lastArg === 'object' &&
      !Array.isArray(lastArg) &&
      'timeout' in lastArg
    const options = isOptionsObject ? (lastArg as InvokeOptions) : undefined
    const invokeArgs = isOptionsObject ? args.slice(0, -1) : args
    return this.invokeOnPort(port, channel as string, options, ...invokeArgs)
  }

  /**
   * Invoke a handler on a remote renderer by identifier
   * @param identifier - The identifier string or regex pattern (string must be one of TIdentifierStrings)
   */
  async invokeIdentifier<T extends keyof TInvokeMap>(
    identifier: TIdentifierStrings | RegExp,
    channel: T,
    ...args: [
      ...params: TInvokeMap[T] extends (...args: infer P) => any ? P : never,
      options?: InvokeOptions,
    ]
  ): Promise<
    TInvokeMap[T] extends (...args: any[]) => infer R ? Awaited<R> : unknown
  > {
    const port = await this.getPort({ identifier })
    // Extract options from the last argument if it's an InvokeOptions object
    const lastArg = args[args.length - 1]
    const isOptionsObject =
      lastArg &&
      typeof lastArg === 'object' &&
      !Array.isArray(lastArg) &&
      'timeout' in lastArg
    const options = isOptionsObject ? (lastArg as InvokeOptions) : undefined
    const invokeArgs = isOptionsObject ? args.slice(0, -1) : args
    return this.invokeOnPort(port, channel as string, options, ...invokeArgs)
  }

  /**
   * Invoke a handler on a remote renderer by URL
   */
  async invokeUrl<T extends keyof TInvokeMap>(
    url: string | RegExp,
    channel: T,
    ...args: [
      ...params: TInvokeMap[T] extends (...args: infer P) => any ? P : never,
      options?: InvokeOptions,
    ]
  ): Promise<
    TInvokeMap[T] extends (...args: any[]) => infer R ? Awaited<R> : unknown
  > {
    const port = await this.getPort({ url })
    // Extract options from the last argument if it's an InvokeOptions object
    const lastArg = args[args.length - 1]
    const isOptionsObject =
      lastArg &&
      typeof lastArg === 'object' &&
      !Array.isArray(lastArg) &&
      'timeout' in lastArg
    const options = isOptionsObject ? (lastArg as InvokeOptions) : undefined
    const invokeArgs = isOptionsObject ? args.slice(0, -1) : args
    return this.invokeOnPort(port, channel as string, options, ...invokeArgs)
  }

  /**
   * Invoke a handler on a specific port
   */
  private async invokeOnPort<T>(
    port: MessagePort,
    channel: string,
    options?: InvokeOptions,
    ...args: unknown[]
  ): Promise<T> {
    const requestId = `${++this.requestIdCounter}-${Date.now()}`
    const timeoutMs = options?.timeout ?? this.defaultTimeout

    this.log.silly?.('DirectIpcRenderer::invoke - invoking channel')

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingInvokes.delete(requestId)
        reject(
          new Error(`DirectIpc invoke timeout after ${timeoutMs}ms: ${channel}`)
        )
      }, timeoutMs)

      // Store pending request
      this.pendingInvokes.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      })

      // Send invoke message
      const message: InvokeMessage = {
        type: 'invoke',
        channel,
        requestId,
        args,
      }
      port.postMessage(message)
    })
  }

  /**
   * Handle an incoming invoke request
   */
  private async handleInvokeRequest(
    port: MessagePort,
    message: InvokeMessage
  ): Promise<void> {
    const { channel, requestId, args } = message

    this.log.silly?.('DirectIpcRenderer::handleInvokeRequest - handling invoke')

    const handler = this.handlers.get(channel)
    if (!handler) {
      this.log.error?.(
        'DirectIpcRenderer::handleInvokeRequest - No handler for channel'
      )
      const response: InvokeResponse = {
        type: 'invoke-response',
        requestId,
        success: false,
        error: 'No handler registered for channel',
      }
      port.postMessage(response)
      return
    }

    try {
      // get the cached port info for the sender
      const senderInfo = Array.from(this.portCache.values()).find(
        (c) => c.port === port
      )?.info
      const result = await handler(senderInfo, ...args)
      const response: InvokeResponse = {
        type: 'invoke-response',
        requestId,
        success: true,
        data: result,
      }
      port.postMessage(response)
    } catch (error) {
      this.log.error?.(
        'DirectIpcRenderer::handleInvokeRequest - Handler error',
        error
      )
      const response: InvokeResponse = {
        type: 'invoke-response',
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
      port.postMessage(response)
    }
  }

  /**
   * Handle an incoming invoke response
   */
  private handleInvokeResponse(response: InvokeResponse): void {
    const { requestId, success, data, error } = response

    this.log.silly?.(
      'DirectIpcRenderer::handleInvokeResponse - handling response'
    )

    const pending = this.pendingInvokes.get(requestId)
    if (!pending) {
      this.log.warn?.(
        'DirectIpcRenderer::handleInvokeResponse - No pending request'
      )
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
   * Manually refresh the map from main process
   */
  async refreshMap(): Promise<DirectIpcTarget[]> {
    const map = await this.d.ipcRenderer.invoke(DIRECT_IPC_CHANNELS.REFRESH_MAP)
    this.handleMapUpdate(map)
    return map
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
   * Get the current array of all registered target processes
   */
  getMap(): DirectIpcTarget[] {
    return [...this.map]
  }

  /**
   * Get this renderer's identifier
   * @returns The identifier string or undefined if not set
   */
  getMyIdentifier(): TIdentifierStrings | undefined {
    return this.myIdentifier
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
   * Close all cached ports (useful for shutdown)
   */
  closeAllPorts(): void {
    for (const cached of this.portCache.values()) {
      cached.port.close()
    }
    this.portCache.clear()
  }
}
