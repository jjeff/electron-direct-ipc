import { ipcRenderer } from 'electron'
import {
  DIRECT_IPC_CHANNELS,
  DirectIpcMapUpdateMessage,
  DirectIpcPortMessage,
  DirectIpcTarget,
  EventMap,
  InvokeMap,
  Prettify,
  InvokeOptions,
  TargetSelector,
  DirectIpcMessage,
  InvokeMessage,
  InvokeResponse,
  WithSender,
  DirectIpcBase,
  CachedPort,
} from '../common/index.js'
import {
  DirectIpcLogger,
  consoleLogger,
} from '../common/DirectIpcLogger.js'
import { DirectIpcThrottled } from './DirectIpcThrottled.js'

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
> extends DirectIpcBase<TMessageMap, TInvokeMap, TIdentifierStrings, MessagePort> {
  // singleton
  private static _instance: DirectIpcRenderer | null = null

  /**
   * Check if running in renderer process
   * Protected static method for easy mocking in tests
   */
  protected static isRendererProcess(): boolean {
    return process && process.type === 'renderer'
  }

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
    if (!DirectIpcRenderer.isRendererProcess()) {
      throw new Error('DirectIpcRenderer.instance() can only be called from the renderer process')
    }
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

  /** Cached ports to other processes (renderers and utilities), keyed by process ID */
  private portCache = new Map<number, CachedPort<MessagePort>>()

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
    this.defaultTimeout = options.defaultTimeout ?? 5000

    this.setupIpcListeners()
    this.subscribe(options.identifier)

    // Initialize throttled wrapper after other setup
    this.throttled = new DirectIpcThrottled(this, { log: this.log })
  }

  // ===== IMPLEMENT ABSTRACT METHODS FROM BASE CLASS =====

  /**
   * Get unique key for caching a port (uses process ID)
   */
  protected getPortCacheKey(target: DirectIpcTarget): number {
    return target.id
  }

  /**
   * Send message via a MessagePort
   */
  protected postMessageToPort(port: MessagePort, message: unknown): void {
    port.postMessage(message)
  }

  /**
   * Set up message listener on a MessagePort
   */
  protected setupPortListener(
    port: MessagePort,
    handler: (data: unknown) => void
  ): void {
    port.onmessage = (e: MessageEvent) => handler(e.data)
  }

  /**
   * Clean up a port when target is removed
   */
  protected cleanupPort(target: DirectIpcTarget): void {
    const cached = this.portCache.get(target.id)
    if (cached) {
      cached.port.close()
      this.portCache.delete(target.id)
    }
  }

  /**
   * Close all cached ports
   */
  public closeAllPorts(): void {
    for (const cached of this.portCache.values()) {
      cached.port.close()
    }
    this.portCache.clear()
  }

  /**
   * Find targets matching a selector
   */
  protected findTargets(
    selector: TargetSelector<TIdentifierStrings>
  ): DirectIpcTarget[] {
    // Handle "all" patterns
    if ('allIdentifiers' in selector) {
      const identifier = selector.allIdentifiers
      const regex =
        typeof identifier === 'string' ? new RegExp(identifier) : identifier
      return this.map.filter((p) => p.identifier && regex.test(p.identifier))
    }

    if ('allUrls' in selector) {
      const url = selector.allUrls
      const regex = typeof url === 'string' ? new RegExp(url) : url
      return this.map.filter((p) => p.url && regex.test(p.url))
    }

    // Handle single target patterns
    if ('webContentsId' in selector) {
      const match = this.map.find((t) => t.webContentsId === selector.webContentsId)
      return match ? [match] : []
    }

    if ('identifier' in selector) {
      if (typeof selector.identifier === 'string') {
        const match = this.map.find((t) => t.identifier === selector.identifier)
        return match ? [match] : []
      } else if (selector.identifier instanceof RegExp) {
        const regex = selector.identifier
        const matches = this.map.filter(
          (t) => t.identifier && regex.test(t.identifier)
        )
        if (matches.length > 1) {
          throw new Error(
            'DirectIpcRenderer::Multiple matches found for identifier regex'
          )
        }
        return matches
      }
    }

    if ('url' in selector) {
      if (typeof selector.url === 'string') {
        const match = this.map.find((t) => t.url === selector.url)
        return match ? [match] : []
      } else if (selector.url instanceof RegExp) {
        const regex = selector.url
        const matches = this.map.filter((t) => t.url && regex.test(t.url))
        if (matches.length > 1) {
          throw new Error(
            'DirectIpcRenderer::Multiple matches found for URL regex'
          )
        }
        return matches
      }
    }

    return []
  }

  /**
   * Get or create a port to a target renderer or utility process
   */
  protected async getPort(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): Promise<MessagePort> {
    // Try to resolve the target to a process ID using our local map
    // This allows us to check the cache even when searching by identifier/URL
    const processId = this.resolveTargetToProcessId(target)

    // Check if we already have a cached port for this process ID
    if (processId !== undefined) {
      const cached = this.portCache.get(processId)
      if (cached) {
        this.log.silly?.(
          `DirectIpcRenderer::getPort - Using cached port for process ${processId}`
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
          isMatch = addedTarget.url ? regex.test(addedTarget.url) : false
        }

        if (isMatch) {
          clearTimeout(timeout)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Type assertion needed due to EventEmitter type limitations with locally scoped listeners
          this.localEvents.off('message-port-added', messagePortAddedListener as any)
          const cached = this.portCache.get(addedTarget.id)
          if (cached) {
            resolve(cached.port)
          } else {
            reject(new Error('Port was added but not cached'))
          }
        }
      }

      const timeout = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Type assertion needed due to EventEmitter type limitations with locally scoped listeners
        this.localEvents.off('message-port-added', messagePortAddedListener as any)
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

  // ===== RENDERER-SPECIFIC METHODS =====

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
   * Handle incoming MessagePort from main process
   */
  private handlePortMessage(
    port: MessagePort,
    senderInfo: DirectIpcTarget
  ): void {
    const senderStr = senderInfo.identifier ? `"${senderInfo.identifier}"` : `#${senderInfo.id}`
    this.log.info?.(
      `DirectIpcRenderer::handlePortMessage - Received port from ${senderStr} (${senderInfo.processType})`
    )

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
        `DirectIpcRenderer::port.close - port closed for ${senderInfo.identifier || `process-${senderInfo.id}` || 'unknown'}`
      )
      this.portCache.delete(senderInfo.id)
    })

    port.start()

    // Cache the port using process ID
    this.portCache.set(senderInfo.id, {
      port,
      info: senderInfo,
    })

    // Emit message-port-added event so getPort() promises can resolve
    this.localEvents.emit('message-port-added', senderInfo)
  }

  /**
   * Resolve a target to its process ID using the local map
   */
  private resolveTargetToProcessId(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): number | undefined {
    // If webContentsId is provided, find matching process by webContentsId
    if (target.webContentsId !== undefined) {
      const match = this.map.find((t) => t.webContentsId === target.webContentsId)
      return match?.id
    }

    // Search by identifier
    if (target.identifier !== undefined) {
      if (typeof target.identifier === 'string') {
        // Exact match
        const match = this.map.find((t) => t.identifier === target.identifier)
        return match?.id
      } else if (target.identifier instanceof RegExp) {
        const regex = target.identifier

        const matches = this.map.filter(
          (t) => t.identifier && regex.test(t.identifier)
        )

        if (matches.length === 1) {
          return matches[0]!.id
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
        return match?.id
      } else if (target.url instanceof RegExp) {
        const regex = target.url

        const matches = this.map.filter((t) => t.url && regex.test(t.url))

        if (matches.length === 1) {
          return matches[0]!.id
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
   * Resolve a target to its webContentsId using the local map
   * @deprecated Use resolveTargetToProcessId instead
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
        return match?.webContentsId
      } else if (target.url instanceof RegExp) {
        const regex = target.url

        const matches = this.map.filter((t) => t.url && regex.test(t.url))

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
   * Send a message to target renderer(s) using a TargetSelector
   *
   * @example
   * // Send to specific webContentsId
   * await directIpc.send({ webContentsId: 123 }, 'my-message', arg1, arg2)
   *
   * // Send to single identifier (throws if multiple matches)
   * await directIpc.send({ identifier: 'output' }, 'my-message', arg1, arg2)
   *
   * // Send to single URL pattern (throws if multiple matches)
   * await directIpc.send({ url: /^https:\/\/example/ }, 'my-message', arg1, arg2)
   *
   * // Send to all matching identifiers
   * await directIpc.send({ allIdentifiers: /^output/ }, 'my-message', arg1, arg2)
   *
   * // Send to all matching URLs
   * await directIpc.send({ allUrls: 'https://example.com' }, 'my-message', arg1, arg2)
   */
  async send<T extends keyof TMessageMap>(
    target: TargetSelector<TIdentifierStrings>,
    message: T,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'any' used in conditional type for parameter extraction
    ...args: TMessageMap[T] extends (...args: infer P) => any ? P : never
  ): Promise<void> {
    // Handle "all" patterns - these require targets to exist in the map
    if ('allIdentifiers' in target || 'allUrls' in target) {
      const targets = this.findTargets(target)

      if (targets.length === 0) {
        this.log.warn?.(
          `DirectIpcRenderer::send - No targets found for pattern`
        )
        return
      }

      this.log.silly?.(
        `DirectIpcRenderer::send - Sending to ${targets.length} target(s) with message "${message as string}"`
      )

      await Promise.all(
        targets.map(async (t) => {
          if (t.webContentsId !== undefined) {
            const port = await this.getPort({ webContentsId: t.webContentsId })
            if (port) {
              port.postMessage({ message, args })
            }
          }
        })
      )
      return
    }

    // Handle single target - can work with targets not yet in map (getPort will wait)
    let selector: {
      webContentsId?: number
      identifier?: TIdentifierStrings | RegExp
      url?: string | RegExp
    }

    if ('webContentsId' in target) {
      selector = { webContentsId: target.webContentsId }
    } else if ('identifier' in target) {
      selector = { identifier: target.identifier }
    } else if ('url' in target) {
      selector = { url: target.url }
    } else {
      throw new Error('DirectIpcRenderer::send - Invalid target selector')
    }

    const port = await this.getPort(selector)
    if (port) {
      port.postMessage({ message, args })
    }
  }

  /**
   * Invoke a handler on a remote renderer using a TargetSelector
   * Note: Only single-target selectors are supported (not allIdentifiers/allUrls)
   *
   * @example
   * // Invoke on specific webContentsId
   * const result = await directIpc.invoke({ webContentsId: 123 }, 'get-data', arg1, arg2)
   *
   * // Invoke on identifier (throws if multiple matches)
   * const result = await directIpc.invoke({ identifier: 'output' }, 'get-data', arg1, arg2)
   *
   * // Invoke on URL pattern (throws if multiple matches)
   * const result = await directIpc.invoke({ url: /^https:\/\/example/ }, 'get-data', arg1, arg2)
   *
   * // With timeout option
   * const result = await directIpc.invoke({ identifier: 'output' }, 'get-data', arg1, { timeout: 5000 })
   */
  async invoke<T extends keyof TInvokeMap>(
    target: Omit<TargetSelector<TIdentifierStrings>, 'allIdentifiers' | 'allUrls'>,
    channel: T,
    ...args: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...params: TInvokeMap[T] extends (...args: infer P) => any ? P : never,
      options?: InvokeOptions,
    ]
  ): Promise<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TInvokeMap[T] extends (...args: any[]) => infer R ? Awaited<R> : unknown
  > {
    // Build selector for getPort based on target type
    let selector: {
      webContentsId?: number
      identifier?: TIdentifierStrings | RegExp
      url?: string | RegExp
    }

    if ('webContentsId' in target) {
      selector = { webContentsId: (target as { webContentsId: number }).webContentsId }
    } else if ('identifier' in target) {
      selector = { identifier: (target as { identifier: TIdentifierStrings | RegExp }).identifier }
    } else if ('url' in target) {
      selector = { url: (target as { url: string | RegExp }).url }
    } else {
      throw new Error('DirectIpcRenderer::invoke - Invalid target selector')
    }

    const port = await this.getPort(selector)

    // Extract options from the last argument if it's an InvokeOptions object
    const { options, invokeArgs } = this.extractInvokeOptions(args)
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
    const requestId = this.createInvokeRequestId()
    const timeoutMs = options?.timeout ?? this.defaultTimeout

    this.log.silly?.('DirectIpcRenderer::invoke - invoking channel')

    const promise = this.createInvokePromise<T>(requestId, timeoutMs, channel)

    // Send invoke message
    const message: InvokeMessage = {
      type: 'invoke',
      channel,
      requestId,
      args,
    }
    port.postMessage(message)

    return promise
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
   * Manually refresh the map from main process
   */
  async refreshMap(): Promise<DirectIpcTarget[]> {
    const map = await this.d.ipcRenderer.invoke(DIRECT_IPC_CHANNELS.REFRESH_MAP)
    this.handleMapUpdate(map)
    return map
  }
}
