/**
 * DirectIpcUtility - Utility process DirectIpc client
 * Provides type-safe direct communication between utility processes and renderers
 */

import {
  DIRECT_IPC_CHANNELS,
  DirectIpcMapUpdateMessage,
  DirectIpcPortMessage,
  DirectIpcTarget,
  EventMap,
  InvokeMap,
  TargetSelector,
  DirectIpcMessage,
  InvokeMessage,
  InvokeResponse,
  DirectIpcBase,
  CachedPort,
} from '../common/index.js'
import {
  DirectIpcLogger,
  consoleLogger,
} from '../common/DirectIpcLogger.js'
import { DirectIpcUtilityThrottled } from './DirectIpcUtilityThrottled.js'

// Electron provides process.parentPort in utility processes
// The type is available via @types/node

/**
 * Registration state for utility process during initialization
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

/**
 * Queued message structure for messages sent before registration completes
 */
export interface QueuedMessage {
  target: TargetSelector
  message: string
  args: unknown[]
  throttled: boolean
  timestamp: number
}

/**
 * Options for DirectIpcUtility
 */
export interface DirectIpcUtilityOptions<
  TIdentifierStrings extends string = string,
> {
  log?: DirectIpcLogger
  identifier?: TIdentifierStrings
  defaultTimeout?: number
  registrationTimeout?: number
}

/**
 * Utility process DirectIpc client
 * Provides type-safe direct communication between utility processes and renderers
 *
 * @template TMessageMap - Map of message channels to their handler function signatures (WITHOUT sender)
 * @template TInvokeMap - Map of invoke channels to their handler function signatures (WITHOUT sender)
 * @template TIdentifierStrings - Union of allowed identifier strings for type-safe identifier usage
 */
export class DirectIpcUtility<
  TMessageMap extends EventMap = EventMap,
  TInvokeMap extends InvokeMap = InvokeMap,
  TIdentifierStrings extends string = string,
> extends DirectIpcBase<
  TMessageMap,
  TInvokeMap,
  TIdentifierStrings,
  Electron.MessagePortMain
> {
  // Singleton
  private static _instance: DirectIpcUtility | null = null

  /**
   * Check if running in utility process
   * Protected static method for easy mocking in tests
   */
  protected static isUtilityProcess(): boolean {
    return process && process.type === 'utility'
  }

  /**
   * Get the singleton instance
   */
  public static instance<
    TMessageMap extends EventMap = EventMap,
    TInvokeMap extends InvokeMap = InvokeMap,
    TProcessIdentifier extends string = string,
  >(
    options?: DirectIpcUtilityOptions<TProcessIdentifier>
  ): DirectIpcUtility<TMessageMap, TInvokeMap, TProcessIdentifier> {
    if (!DirectIpcUtility.isUtilityProcess()) {
      throw new Error('DirectIpcUtility.instance() can only be called from a utility process')
    }
    if (!DirectIpcUtility._instance) {
      DirectIpcUtility._instance = new DirectIpcUtility(options)
    }
    if (options) {
      const { identifier, log, defaultTimeout, registrationTimeout } = options
      if (identifier && !DirectIpcUtility._instance.myIdentifier) {
        DirectIpcUtility._instance.myIdentifier = identifier
      }
      if (log) {
        DirectIpcUtility._instance.log = log
      }
      if (defaultTimeout !== undefined) {
        DirectIpcUtility._instance.defaultTimeout = defaultTimeout
      }
      if (registrationTimeout !== undefined) {
        DirectIpcUtility._instance.registrationTimeout = registrationTimeout
      }
    }
    return DirectIpcUtility._instance as DirectIpcUtility<
      TMessageMap,
      TInvokeMap,
      TProcessIdentifier
    >
  }

  /** Cached ports to other processes, keyed by identifier */
  private portCache = new Map<string, CachedPort<Electron.MessagePortMain>>()

  /** Registration timeout (ms) */
  private registrationTimeout = 5000

  /** Current registration state */
  private registrationState: RegistrationState = RegistrationState.UNINITIALIZED

  /** Message queue for messages sent before registration completes */
  private messageQueue: QueuedMessage[] = []

  /**
   * Throttled message sending/receiving for high-frequency updates.
   * Use this for lossy communication where only the latest value matters.
   *
   * @example
   * // High-frequency position updates (throttled)
   * directIpc.throttled.send({ identifier: 'renderer' }, 'position-update', x, y)
   *
   * // Important events (not throttled)
   * directIpc.send({ identifier: 'renderer' }, 'button-clicked')
   */
  public readonly throttled: DirectIpcUtilityThrottled<
    TMessageMap,
    TInvokeMap,
    TIdentifierStrings
  >

  constructor(options?: DirectIpcUtilityOptions<TIdentifierStrings>) {
    super()

    this.log = options?.log || consoleLogger
    if (options?.identifier !== undefined) {
      this.myIdentifier = options.identifier
    }
    this.defaultTimeout = options?.defaultTimeout ?? 30000
    this.registrationTimeout = options?.registrationTimeout ?? 5000

    // Initialize throttled wrapper
    this.throttled = new DirectIpcUtilityThrottled(this, { log: this.log })

    // Start registration process
    this.initializeRegistration()
  }

  // ===== IMPLEMENT ABSTRACT METHODS FROM BASE CLASS =====

  /**
   * Get unique key for caching a port (uses identifier or process ID)
   */
  protected getPortCacheKey(target: DirectIpcTarget): string {
    return target.identifier || String(target.id)
  }

  /**
   * Send message via a MessagePortMain
   */
  protected postMessageToPort(
    port: Electron.MessagePortMain,
    message: unknown
  ): void {
    port.postMessage(message)
  }

  /**
   * Set up message listener on a MessagePortMain
   */
  protected setupPortListener(
    port: Electron.MessagePortMain,
    handler: (data: unknown) => void
  ): void {
    port.on('message', (event) => handler(event.data))
  }

  /**
   * Clean up a port when target is removed
   */
  protected cleanupPort(target: DirectIpcTarget): void {
    this.portCache.delete(this.getPortCacheKey(target))
  }

  /**
   * Close all MessagePort connections
   */
  public closeAllPorts(): void {
    for (const [, cached] of this.portCache) {
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
    if ('identifier' in selector) {
      const pattern = selector.identifier
      return this.map.filter((t) => {
        if (!t.identifier) return false
        if (pattern instanceof RegExp) {
          return pattern.test(t.identifier)
        }
        return t.identifier === pattern
      })
    }

    if ('webContentsId' in selector) {
      return this.map.filter((t) => t.webContentsId === selector.webContentsId)
    }

    if ('url' in selector) {
      const pattern = selector.url
      return this.map.filter((t) => {
        if (!t.url) return false
        if (pattern instanceof RegExp) {
          return pattern.test(t.url)
        }
        return t.url === pattern
      })
    }

    if ('allIdentifiers' in selector) {
      const pattern = selector.allIdentifiers
      return this.map.filter((t) => {
        if (!t.identifier) return false
        // Don't send to ourselves
        if (t.identifier === this.myIdentifier) return false
        if (pattern instanceof RegExp) {
          return pattern.test(t.identifier)
        }
        return t.identifier === pattern
      })
    }

    if ('allUrls' in selector) {
      const pattern = selector.allUrls
      return this.map.filter((t) => {
        if (!t.url) return false
        if (pattern instanceof RegExp) {
          return pattern.test(t.url)
        }
        return t.url === pattern
      })
    }

    return []
  }

  /**
   * Get or request a port for a target
   */
  protected async getPort(target: {
    webContentsId?: number
    identifier?: TIdentifierStrings | RegExp
    url?: string | RegExp
  }): Promise<Electron.MessagePortMain> {
    // Find the target
    const targets = this.findTargets(target as TargetSelector<TIdentifierStrings>)
    if (targets.length === 0) {
      throw new Error('No target found')
    }
    if (targets.length > 1) {
      throw new Error('Multiple targets found (use specific selector)')
    }

    const targetProcess = targets[0]!
    const targetId = this.getPortCacheKey(targetProcess)

    // Check cache
    const cached = this.portCache.get(targetId)
    if (cached) {
      return cached.port
    }

    // Request port from main process
    return this.requestPort(targetProcess)
  }

  // ===== OVERRIDE BASE METHODS =====

  /**
   * Handle map update from main process
   * Overridden to handle registration lifecycle
   */
  protected handleMapUpdate(newMap: DirectIpcTarget[]): void {
    // Call base implementation FIRST to update the map
    super.handleMapUpdate(newMap)

    // Handle registration lifecycle AFTER map is updated
    if (this.registrationState === RegistrationState.SUBSCRIBING) {
      this.registrationState = RegistrationState.REGISTERED
      this.localEvents.emit('registration-complete')
      void this.flushMessageQueue()
    }
  }

  // ===== UTILITY-SPECIFIC METHODS =====

  /**
   * Initialize registration with main process
   */
  private initializeRegistration(): void {
    const parentPort = process.parentPort
    if (!parentPort) {
      const error = new Error(
        'DirectIpcUtility can only be used in a utility process with process.parentPort available'
      )
      this.log.error?.(
        'DirectIpcUtility::initializeRegistration - process.parentPort not available:',
        error
      )
      this.registrationState = RegistrationState.FAILED
      this.localEvents.emit('registration-failed', error)
      return
    }

    this.log.debug?.(
      `DirectIpcUtility::initializeRegistration - Starting registration for ${this.myIdentifier || 'unnamed utility process'}`
    )

    this.registrationState = RegistrationState.SUBSCRIBING

    // Set up listener for messages from main process
    parentPort.on('message', (event) => {
      // ParentPort message events have data and ports properties
      const data = event.data !== undefined ? event.data : event
      // In utility processes, ports are MessagePort (web standard), not MessagePortMain
      const ports = event.ports
      this.handleParentPortMessage(data, ports)
    })

    // Send registration request to main process
    parentPort.postMessage({
      channel: DIRECT_IPC_CHANNELS.UTILITY_REGISTER,
      identifier: this.myIdentifier,
    })

    // Set registration timeout
    const timeoutId = setTimeout(() => {
      if (this.registrationState === RegistrationState.SUBSCRIBING) {
        const error = new Error(
          `Utility process registration timed out after ${this.registrationTimeout}ms`
        )
        this.log.error?.(
          'DirectIpcUtility::initializeRegistration - Timeout:',
          error
        )
        this.registrationState = RegistrationState.FAILED
        this.localEvents.emit('registration-failed', error)
      }
    }, this.registrationTimeout)

    // Clear timeout once registered
    this.localEvents.once('registration-complete', () => {
      clearTimeout(timeoutId)
    })
  }

  /**
   * Handle messages from parent port (main process)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleParentPortMessage(data: any, ports?: Electron.MessagePortMain[]): void {
    // Handle MAP_UPDATE
    if (data.channel === DIRECT_IPC_CHANNELS.MAP_UPDATE) {
      const mapData = data as DirectIpcMapUpdateMessage
      this.handleMapUpdate(mapData.map)
      return
    }

    // Handle PORT_MESSAGE (when main sends us a MessagePort to communicate with a renderer/utility)
    if (data.channel === DIRECT_IPC_CHANNELS.PORT_MESSAGE) {
      const portData = data as DirectIpcPortMessage
      const port = ports && ports[0]
      if (port && portData.sender) {
        this.handleNewPort(port, portData.sender)
      }
      return
    }
  }

  /**
   * Handle new MessagePort from main process
   */
  private handleNewPort(port: Electron.MessagePortMain, sender: DirectIpcTarget): void {
    const targetId = this.getPortCacheKey(sender)

    // Cache the port
    this.portCache.set(targetId, { port, info: sender })
    this.localEvents.emit('message-port-added', sender)

    // Set up port message handler
    port.on('message', (event) => {
      const data = event.data
      this.handlePortMessage(data, sender)
    })

    port.start()
  }

  /**
   * Handle messages from MessagePort
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlePortMessage(data: any, sender: DirectIpcTarget): void {
    // Handle invoke requests
    if (data.type === 'invoke') {
      this.handleInvokeRequest(data as InvokeMessage, sender)
      return
    }

    // Handle invoke responses
    if (data.type === 'invoke-response') {
      this.handleInvokeResponse(data as InvokeResponse)
      return
    }

    // Handle regular messages
    if (data.message) {
      const { message, args } = data as DirectIpcMessage
      this.log.debug?.(
        `DirectIpcUtility::handlePortMessage - Received message "${String(message)}" from ${sender.identifier || sender.id}`
      )
      // Type assertion needed due to complex generic type manipulation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(super.emit as any)(message, sender, ...(args || []))
      this.localEvents.emit('message', sender, data)
    }
  }

  /**
   * Handle invoke request from another process
   */
  private async handleInvokeRequest(
    request: InvokeMessage,
    sender: DirectIpcTarget
  ): Promise<void> {
    const { channel, requestId, args } = request
    const handler = this.handlers.get(channel)

    if (!handler) {
      // Send error response
      const targetId = this.getPortCacheKey(sender)
      const cachedPort = this.portCache.get(targetId)
      if (cachedPort) {
        cachedPort.port.postMessage({
          type: 'invoke-response',
          requestId,
          success: false,
          error: `No handler registered for channel: ${channel}`,
        } as InvokeResponse)
      }
      return
    }

    try {
      const result = await handler(sender, ...args)
      const targetId = this.getPortCacheKey(sender)
      const cachedPort = this.portCache.get(targetId)
      if (cachedPort) {
        cachedPort.port.postMessage({
          type: 'invoke-response',
          requestId,
          success: true,
          data: result,
        } as InvokeResponse)
      }
    } catch (error) {
      const targetId = this.getPortCacheKey(sender)
      const cachedPort = this.portCache.get(targetId)
      if (cachedPort) {
        cachedPort.port.postMessage({
          type: 'invoke-response',
          requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as InvokeResponse)
      }
    }
  }

  /**
   * Flush queued messages after registration completes
   */
  private async flushMessageQueue(): Promise<void> {
    if (this.messageQueue.length === 0) return

    this.log.debug?.(
      `DirectIpcUtility::flushMessageQueue - Flushing ${this.messageQueue.length} queued messages`
    )

    const queue = [...this.messageQueue]
    this.messageQueue = []

    for (const queuedMsg of queue) {
      try {

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.send as any)(
          queuedMsg.target,
          queuedMsg.message,
          ...queuedMsg.args
        )
      } catch (error) {
        this.log.error?.(
          `DirectIpcUtility::flushMessageQueue - Error flushing message "${queuedMsg.message}":`,
          error
        )
      }
    }
  }

  /**
   * Send a message to another process
   */
  public async send<K extends keyof TMessageMap>(
    target: TargetSelector<TIdentifierStrings>,
    message: K,
    ...args: Parameters<TMessageMap[K]>
  ): Promise<void> {
    // Queue message if not registered yet
    if (this.registrationState !== RegistrationState.REGISTERED) {
      this.log.debug?.(
        `DirectIpcUtility::send - Queuing message "${String(message)}" (state: ${this.registrationState})`
      )
      this.messageQueue.push({
        target,
        message: String(message),
        args,
        throttled: false,
        timestamp: Date.now(),
      })
      return
    }

    // Find target processes
    const targets = this.findTargets(target)
    if (targets.length === 0) {
      this.log.warn?.(
        `DirectIpcUtility::send - No targets found for message "${String(message)}"`
      )
      return
    }

    // Send to each target
    for (const t of targets) {
      this.log.debug?.(
        `DirectIpcUtility::send - Calling sendToTarget for ${t.identifier || t.id}`
      )
      await this.sendToTarget(t, message, args)
    }
  }

  /**
   * Send message to a specific target
   */
  private async sendToTarget<K extends keyof TMessageMap>(
    target: DirectIpcTarget,
    message: K,
    args: Parameters<TMessageMap[K]>
  ): Promise<void> {
    const targetId = this.getPortCacheKey(target)

    this.log.debug?.(
      `DirectIpcUtility::sendToTarget - Sending message "${String(message)}" to target ${targetId}`
    )

    // Get or request port for this target
    let cachedPort = this.portCache.get(targetId)
    if (!cachedPort) {
      await this.requestPort(target)
      cachedPort = this.portCache.get(targetId)
    }

    if (!cachedPort) {
      this.log.warn?.(
        `DirectIpcUtility::sendToTarget - No port available for ${targetId}`
      )
      return
    }

    // Send the message
    const messageData = {
      message: String(message),
      args,
    }

    this.log.debug?.(
      `DirectIpcUtility::sendToTarget - Sending message "${String(message)}" to ${targetId}`
    )

    cachedPort.port.postMessage(messageData)
  }

  /**
   * Request a MessagePort for a target process
   */
  private async requestPort(
    target: DirectIpcTarget
  ): Promise<Electron.MessagePortMain> {
    const parentPort = (process as NodeJS.Process & { parentPort?: unknown }).parentPort as unknown as
      | {
          postMessage: (value: unknown, transfer?: unknown[]) => void
          on: (event: string, listener: (event: { data: unknown; ports?: Electron.MessagePortMain[] }) => void) => void
          removeListener: (event: string, listener: (...args: unknown[]) => void) => void
        }
      | undefined

    if (!parentPort) {
      throw new Error('DirectIpcUtility::requestPort - process.parentPort not available')
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.log.error?.(
          `DirectIpcUtility::requestPort - Timeout waiting for port: ${JSON.stringify(target)}`
        )
        reject(new Error('Timeout waiting for MessagePort'))
      }, this.defaultTimeout)

      // Listen for PORT_MESSAGE response
      const portMessageHandler = (event: { data: unknown; ports?: Electron.MessagePortMain[] }) => {
        const data = event.data as { channel?: string }

        if (data.channel !== DIRECT_IPC_CHANNELS.PORT_MESSAGE) {
          return
        }

        const portData = data as DirectIpcPortMessage
        const port = event.ports && event.ports[0]

        // Check if this port is for our requested target
        const matchesTarget =
          (target.identifier && portData.sender?.identifier === target.identifier) ||
          (target.webContentsId && portData.sender?.webContentsId === target.webContentsId)

        if (!matchesTarget || !port) {
          return
        }

        // Clear timeout and remove listener
        clearTimeout(timeout)
        parentPort.removeListener('message', portMessageHandler as (...args: unknown[]) => void)

        // Set up port handlers
        this.handleNewPort(port, portData.sender)

        // Return the port
        resolve(port)
      }

      // Add listener
      parentPort.on('message', portMessageHandler)

      // Send GET_PORT request to main process
      parentPort.postMessage({
        channel: DIRECT_IPC_CHANNELS.GET_PORT,
        target,
      })
    })
  }

  /**
   * Invoke a handler on another process
   */
  public async invoke<K extends keyof TInvokeMap>(
    target: Omit<TargetSelector<TIdentifierStrings>, 'allIdentifiers' | 'allUrls'>,
    channel: K,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...argsWithOptions: any[]
  ): Promise<Awaited<ReturnType<TInvokeMap[K]>>> {
    // Extract options from args
    const { options, invokeArgs } = this.extractInvokeOptions(argsWithOptions)

    // Find single target
    const targets = this.findTargets(target as TargetSelector<TIdentifierStrings>)
    if (targets.length === 0) {
      throw new Error('No target found for invoke')
    }
    if (targets.length > 1) {
      throw new Error('Multiple targets found for invoke (use single target selector)')
    }

    const targetProcess = targets[0]!
    const targetId = this.getPortCacheKey(targetProcess)

    // Get or request port
    let cachedPort = this.portCache.get(targetId)
    if (!cachedPort) {
      await this.requestPort(targetProcess)
      cachedPort = this.portCache.get(targetId)
    }

    if (!cachedPort) {
      throw new Error(`No port available for ${targetId}`)
    }

    // Generate request ID and create promise
    const requestId = this.createInvokeRequestId()
    const timeoutMs = options?.timeout || this.defaultTimeout

    const promise = this.createInvokePromise<Awaited<ReturnType<TInvokeMap[K]>>>(
      requestId,
      timeoutMs,
      String(channel)
    )

    // Send invoke message
    const invokeMessage: InvokeMessage = {
      type: 'invoke',
      channel: String(channel),
      requestId,
      args: invokeArgs,
    }

    cachedPort.port.postMessage(invokeMessage)

    return promise
  }

  /**
   * Get current registration state
   */
  public getRegistrationState(): RegistrationState {
    return this.registrationState
  }

  /**
   * Set this utility process's identifier
   */
  public setIdentifier(identifier: TIdentifierStrings): void {
    if (this.myIdentifier) {
      throw new Error('Identifier already set and cannot be changed')
    }
    this.myIdentifier = identifier
  }
}
