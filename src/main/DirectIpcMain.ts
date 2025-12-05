import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  webContents,
  WebContents,
  UtilityProcess,
} from 'electron';
import {
  DIRECT_IPC_CHANNELS,
  DirectIpcMapUpdateMessage,
  DirectIpcPortMessage,
  DirectIpcTarget,
  ProcessType,
} from '../common/DirectIpcCommunication.js';
import { consoleLogger } from "../common/DirectIpcLogger.js";
import { IdentifierConflictError } from '../utility/errors.js';

/**
 * Main process DirectIpc coordinator
 * Manages the registry of renderer processes and facilitates MessagePort creation
 */
export class DirectIpcMain {
  /** Singleton instance */
  private static _instance: DirectIpcMain | null = null

  /**
   * Check if running in main process
   * Protected static method for easy mocking in tests
   */
  protected static isMainProcess(): boolean {
    // In Electron, the main process does not have a 'window' object
    return typeof window === 'undefined' && process && process.type === 'browser';
  }

  /**
   * Get the singleton instance of DirectIpcMain
   */
  public static instance(options = {} as Partial<Pick<DirectIpcMain['d'], 'log'>>): DirectIpcMain {
    if (!DirectIpcMain.isMainProcess()) {
      throw new Error('DirectIpcMain.instance() can only be called from the main process')
    }
    if (!this._instance) {
      this._instance = new DirectIpcMain(options)
    } else {
      if (options.log) {
        this._instance.d.log = options.log
      }
    }
    return this._instance
  }

  public static init(options = {} as Partial<Pick<DirectIpcMain['d'], 'log'>>): DirectIpcMain {
    return this.instance(options);
  } 

  /** Dependencies */
  private d = {
    app: app,
    BrowserWindow: BrowserWindow,
    ipcMain: ipcMain,
    webContents: webContents,
    log: consoleLogger,
  }

  /** Counter for generating unique process IDs */
  private nextProcessId = 1

  /** Map of process ID to DirectIpcTarget info (all process types) */
  private registry = new Map<number, DirectIpcTarget>()

  /** Map of webContentsId to process ID (for renderer lookups) */
  private webContentsIdMap = new Map<number, number>()

  /** Map of identifier to process ID (for quick lookup and conflict detection) */
  private identifierMap = new Map<string, number>()

  /** Map of process ID to UtilityProcess (for utility process references) */
  private utilityProcessMap = new Map<number, UtilityProcess>()

  /**
   * Map to track existing MessageChannels between renderer pairs
   * Key format: "${min(id1,id2)}-${max(id1,id2)}" ensures same key regardless of direction
   */
  private channelPairs = new Map<string, boolean>()

  constructor(dependencies = {} as Partial<DirectIpcMain['d']>) {
    // Merge dependencies with defaults
    this.d = { ...this.d, ...dependencies }

    this.setupIpcHandlers()
  }

  /**
   * Truncate URL for logging (removes query params and limits length)
   */
  private truncatedUrl(rawUrl: string): string {
    if (!rawUrl) return ''
    const u = new URL(rawUrl)
    const urlWithoutArgs = `${u.origin}${u.pathname}`
    return urlWithoutArgs.length > 100
      ? '...' + urlWithoutArgs.slice(-100)
      : urlWithoutArgs
  }

  /**
   * Set up IPC handlers for renderer communication
   */
  private setupIpcHandlers(): void {
    // Handle subscription requests
    this.d.ipcMain.handle(
      DIRECT_IPC_CHANNELS.SUBSCRIBE,
      (event, identifier?: string) => {
        return this.handleSubscribe(event.sender, identifier)
      }
    )

    // Handle identifier update requests
    this.d.ipcMain.handle(
      DIRECT_IPC_CHANNELS.UPDATE_IDENTIFIER,
      (event, identifier: string) => {
        return this.handleUpdateIdentifier(event.sender, identifier)
      }
    )

    // Handle port requests
    this.d.ipcMain.handle(
      DIRECT_IPC_CHANNELS.GET_PORT,
      (
        event,
        target: {
          webContentsId?: number
          identifier?: string | RegExp
          url?: string | RegExp
        }
      ) => {
        return this.handleGetPort(event.sender, target)
      }
    )

    // Handle manual map refresh
    this.d.ipcMain.handle(DIRECT_IPC_CHANNELS.REFRESH_MAP, () => {
      return this.getMapArray()
    })
  }

  /**
   * Set up lifecycle listeners for a specific webContents
   */
  private setupWebContentsListeners(sender: WebContents): void {
    const webContentsId = sender.id

    // Listen for destruction
    sender.on('destroyed', () => {
      this.handleWebContentsDestroyed(webContentsId)
    })

    // Listen for URL changes (navigation)
    sender.on('did-navigate', () => {
      this.handleUrlChanged(webContentsId, sender.getURL())
    })

    // Listen for in-page navigation (same-document navigation)
    sender.on('did-navigate-in-page', () => {
      this.handleUrlChanged(webContentsId, sender.getURL())
    })
  }

  /**
   * Handle URL change for a registered webContents
   */
  private handleUrlChanged(webContentsId: number, newUrl: string): void {
    const target = this.registry.get(webContentsId)
    if (!target) return

    // Only update and broadcast if URL actually changed
    if (target.url !== newUrl) {
      const identifier = target.identifier
        ? `"${target.identifier}"`
        : `#${webContentsId}`
      this.d.log.silly?.(
        `DirectIpcMain::handleUrlChanged - ${identifier}: ${target.url} -> ${newUrl}`
      )
      target.url = newUrl
      this.broadcastMapUpdate()
    }
  }

  /**
   * Handle a subscription request from a renderer
   */
  private handleSubscribe(
    sender: WebContents,
    identifier?: string
  ): DirectIpcTarget[] {
    const webContentsId = sender.id
    const url = sender.getURL()

    this.d.log.silly?.(
      `DirectIpcMain::handleSubscribe - webContentsId: ${webContentsId}, identifier: ${identifier}, url: ${this.truncatedUrl(url)}`
    )

    // Get or assign process ID for this renderer
    let processId = this.webContentsIdMap.get(webContentsId)
    const wasAlreadyRegistered = processId !== undefined

    if (!processId) {
      processId = this.nextProcessId++
      this.webContentsIdMap.set(webContentsId, processId)
    }

    // Check for identifier conflict
    if (identifier) {
      const existingId = this.identifierMap.get(identifier)
      if (existingId !== undefined && existingId !== processId) {
        throw new Error(
          `DirectIpc identifier "${identifier}" is already in use by process ${existingId}`
        )
      }
    }

    // If this renderer is re-subscribing (e.g., after a reload), clear all channel pairs
    // involving it, since the old MessagePorts are now invalid
    if (wasAlreadyRegistered) {
      const identifierStr = identifier ? `"${identifier}"` : `#${webContentsId}`
      this.d.log.silly?.(
        `DirectIpcMain::handleSubscribe - Renderer ${identifierStr} re-subscribing, clearing channel pairs`
      )
      this.clearChannelPairsForProcess(processId)
    }

    // Register this renderer
    const targetInfo: DirectIpcTarget = {
      id: processId,
      webContentsId,
      url,
      processType: ProcessType.RENDERER,
      ...(identifier ? { identifier } : {}),
    }

    this.registry.set(processId, targetInfo)
    if (identifier) {
      this.identifierMap.set(identifier, processId)
    }

    // Set up lifecycle listeners for this webContents (only if not already registered)
    if (!wasAlreadyRegistered) {
      this.setupWebContentsListeners(sender)
    }

    // Broadcast update to all other renderers
    this.broadcastMapUpdate()

    // Return current map to the new subscriber
    return this.getMapArray()
  }

  /**
   * Handle an identifier update request
   */
  private handleUpdateIdentifier(
    sender: WebContents,
    newIdentifier: string
  ): void {
    const webContentsId = sender.id
    const processId = this.webContentsIdMap.get(webContentsId)

    if (!processId) {
      throw new Error(
        `DirectIpc: Cannot update identifier for unregistered webContents #${webContentsId} "${newIdentifier}" at ${this.truncatedUrl(sender.getURL())}`
      )
    }

    const existing = this.registry.get(processId)
    if (!existing) {
      throw new Error(
        `DirectIpc: Cannot find registry entry for process ${processId} (webContents #${webContentsId})`
      )
    }

    // Check for identifier conflict
    const conflictingProcessId = this.identifierMap.get(newIdentifier)
    if (conflictingProcessId !== undefined && conflictingProcessId !== processId) {
      const conflictingTarget = this.registry.get(conflictingProcessId)
      const conflictingUrl = conflictingTarget?.url
        ? this.truncatedUrl(conflictingTarget.url)
        : 'unknown'
      throw new Error(
        `DirectIpc identifier "${newIdentifier}" (requested by "${this.truncatedUrl(sender.getURL())}") is already in use by process ${conflictingProcessId} at ${conflictingUrl}`
      )
    }

    const oldIdentifier = existing.identifier
      ? `"${existing.identifier}"`
      : '(none)'
    const urlStr = existing.url ? this.truncatedUrl(existing.url) : '(no url)'
    this.d.log.silly?.(
      `DirectIpcMain::handleUpdateIdentifier - process ${processId} (webContents #${webContentsId}) at ${urlStr}: ${oldIdentifier} -> "${newIdentifier}"`
    )

    // Remove old identifier mapping
    if (existing.identifier) {
      this.identifierMap.delete(existing.identifier)
    }

    // Update to new identifier
    existing.identifier = newIdentifier
    this.identifierMap.set(newIdentifier, processId)

    // Broadcast update
    this.broadcastMapUpdate()
  }

  /**
   * Handle a port request - create MessageChannel and distribute ports
   * Supports both renderer-to-renderer and renderer-to-utility communication
   */
  private handleGetPort(
    sender: WebContents,
    target: {
      webContentsId?: number
      identifier?: string | RegExp
      url?: string | RegExp
    }
  ): boolean {
    // Get sender process ID
    const senderProcessId = this.webContentsIdMap.get(sender.id)
    if (!senderProcessId) {
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Sender not registered: #${sender.id}`
      )
      return false
    }

    const senderInfo = this.registry.get(senderProcessId)
    if (!senderInfo) {
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Sender info not found for process ${senderProcessId}`
      )
      return false
    }

    // Find target process (renderer or utility)
    const targetProcessId = this.findProcess(target)
    if (!targetProcessId) {
      const senderStr = senderInfo.identifier ? `"${senderInfo.identifier}"` : `#${sender.id}`
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Could not find target from ${senderStr}:`,
        target
      )
      return false
    }

    const targetInfo = this.registry.get(targetProcessId)
    if (!targetInfo) {
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Target info not found for process ${targetProcessId}`
      )
      return false
    }

    // Create normalized pair key
    const pairKey = this.getChannelPairKey(senderProcessId, targetProcessId)

    // Logging strings
    const senderStr = senderInfo.identifier ? `"${senderInfo.identifier}"` : `#${sender.id}`
    const targetStr = targetInfo.identifier ? `"${targetInfo.identifier}"` : `#${targetProcessId}`

    // Check if channel already exists
    if (this.channelPairs.has(pairKey)) {
      this.d.log.silly?.(
        `DirectIpcMain::handleGetPort - Channel already exists between ${senderStr} and ${targetStr}`
      )
      return true
    }

    this.d.log.silly?.(
      `DirectIpcMain::handleGetPort - Creating channel between ${senderStr} and ${targetStr}`
    )

    // Create MessageChannel
    const { port1, port2 } = new MessageChannelMain()

    // Send port2 to target
    const portMessageToTarget: DirectIpcPortMessage = { sender: senderInfo }
    if (targetInfo.processType === ProcessType.RENDERER && targetInfo.webContentsId) {
      const targetWebContents = this.d.webContents.fromId(targetInfo.webContentsId)
      if (targetWebContents) {
        targetWebContents.postMessage(DIRECT_IPC_CHANNELS.PORT_MESSAGE, portMessageToTarget, [port2])
      }
    } else if (targetInfo.processType === ProcessType.UTILITY) {
      const utilityProcess = this.utilityProcessMap.get(targetProcessId)
      if (utilityProcess) {
        utilityProcess.postMessage({
          channel: DIRECT_IPC_CHANNELS.PORT_MESSAGE,
          ...portMessageToTarget
        }, [port2])
      }
    }

    // Send port1 back to sender
    const portMessageToSender: DirectIpcPortMessage = { sender: targetInfo }
    sender.postMessage(DIRECT_IPC_CHANNELS.PORT_MESSAGE, portMessageToSender, [port1])

    // Mark pair as having a channel
    this.channelPairs.set(pairKey, true)

    return true
  }

  /**
   * Find a process ID by various criteria (works for both renderers and utilities)
   */
  private findProcess(target: {
    webContentsId?: number
    identifier?: string | RegExp
    url?: string | RegExp
  }): number | undefined {
    // Direct webContentsId lookup (renderers only)
    if (target.webContentsId !== undefined) {
      return this.webContentsIdMap.get(target.webContentsId)
    }

    // Identifier lookup (works for both renderers and utilities)
    if (target.identifier !== undefined) {
      const matches = this.findByIdentifier(target.identifier)
      if (matches.length > 1) {
        throw new Error(
          `DirectIpc: Multiple matches found for identifier pattern. Use sendToAll* method instead.`
        )
      }
      if (matches.length === 1 && matches[0]) {
        return matches[0].id
      }
    }

    // URL lookup (renderers only)
    if (target.url !== undefined) {
      const matches = this.findByUrl(target.url)
      if (matches.length > 1) {
        throw new Error(
          `DirectIpc: Multiple matches found for URL pattern. Use sendToAll* method instead.`
        )
      }
      if (matches.length === 1 && matches[0]) {
        return matches[0].id
      }
    }

    return undefined
  }

  /**
   * Handle messages from utility processes
   */
  private handleUtilityProcessMessage(utilityProcessId: number, data: unknown): void {
    this.d.log.debug?.(
      `DirectIpcMain::handleUtilityProcessMessage - Received message from utility ${utilityProcessId}:`,
      data
    )

    // Handle GET_PORT requests from utility process
    if (
      typeof data === 'object' &&
      data !== null &&
      'channel' in data &&
      data.channel === DIRECT_IPC_CHANNELS.GET_PORT &&
      'target' in data
    ) {
      const utilityProcess = this.utilityProcessMap.get(utilityProcessId)
      if (!utilityProcess) {
        this.d.log.error?.(
          `DirectIpcMain::handleUtilityProcessMessage - Utility process ${utilityProcessId} not found`
        )
        return
      }

      const utilityInfo = this.registry.get(utilityProcessId)
      if (!utilityInfo) {
        this.d.log.error?.(
          `DirectIpcMain::handleUtilityProcessMessage - Utility process info not found for ${utilityProcessId}`
        )
        return
      }

      const target = data.target as {
        webContentsId?: number
        identifier?: string | RegExp
        url?: string | RegExp
      }

      // Find target process (renderer or utility)
      const targetProcessId = this.findProcess(target)
      if (!targetProcessId) {
        this.d.log.error?.(
          `DirectIpcMain::handleUtilityProcessMessage - Could not find target from utility "${utilityInfo.identifier}":`,
          target
        )
        return
      }

      const targetInfo = this.registry.get(targetProcessId)
      if (!targetInfo) {
        this.d.log.error?.(
          `DirectIpcMain::handleUtilityProcessMessage - Target info not found for process ${targetProcessId}`
        )
        return
      }

      // Create normalized pair key
      const pairKey = this.getChannelPairKey(utilityProcessId, targetProcessId)

      // Check if channel already exists
      if (this.channelPairs.has(pairKey)) {
        this.d.log.silly?.(
          `DirectIpcMain::handleUtilityProcessMessage - Channel already exists between "${utilityInfo.identifier}" and process ${targetProcessId}`
        )
        return
      }

      this.d.log.info?.(
        `DirectIpcMain::handleUtilityProcessMessage - Creating channel between utility "${utilityInfo.identifier}" (id:${utilityProcessId}) and process ${targetProcessId} (${targetInfo.identifier || targetInfo.processType})`
      )

      // Create MessageChannel
      const { port1, port2 } = new MessageChannelMain()

      // Send port2 to target
      const portMessageToTarget: DirectIpcPortMessage = { sender: utilityInfo }
      if (targetInfo.processType === ProcessType.RENDERER && targetInfo.webContentsId) {
        const targetWebContents = this.d.webContents.fromId(targetInfo.webContentsId)
        if (targetWebContents) {
          targetWebContents.postMessage(DIRECT_IPC_CHANNELS.PORT_MESSAGE, portMessageToTarget, [port2])
        }
      } else if (targetInfo.processType === ProcessType.UTILITY) {
        const targetUtilityProcess = this.utilityProcessMap.get(targetProcessId)
        if (targetUtilityProcess) {
          targetUtilityProcess.postMessage({
            channel: DIRECT_IPC_CHANNELS.PORT_MESSAGE,
            ...portMessageToTarget
          }, [port2])
        }
      }

      // Send port1 back to utility process
      const portMessageToUtility: DirectIpcPortMessage = { sender: targetInfo }
      utilityProcess.postMessage({
        channel: DIRECT_IPC_CHANNELS.PORT_MESSAGE,
        ...portMessageToUtility
      }, [port1])

      // Mark pair as having a channel
      this.channelPairs.set(pairKey, true)
    }
  }

  /**
   * Find all DirectIpcTarget entries matching an identifier pattern
   */
  private findByIdentifier(pattern: string | RegExp): DirectIpcTarget[] {
    const matches: DirectIpcTarget[] = []
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern

    for (const target of this.registry.values()) {
      if (target.identifier && regex.test(target.identifier)) {
        matches.push(target)
      }
    }

    return matches
  }

  /**
   * Find all DirectIpcTarget entries matching a URL pattern
   */
  private findByUrl(pattern: string | RegExp): DirectIpcTarget[] {
    const matches: DirectIpcTarget[] = []
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern

    for (const target of this.registry.values()) {
      if (target.url && regex.test(target.url)) {
        matches.push(target)
      }
    }

    return matches
  }

  /**
   * Generate a normalized key for a renderer pair
   * Uses min/max to ensure same key regardless of direction
   */
  private getChannelPairKey(id1: number, id2: number): string {
    const min = Math.min(id1, id2)
    const max = Math.max(id1, id2)
    return `${min}-${max}`
  }

  /**
   * Clear all channel pairs involving a specific webContents
   * This is necessary when a renderer reloads or is destroyed
   */
  private clearChannelPairsForProcess(processId: number): void {
    const keysToDelete: string[] = []
    for (const pairKey of this.channelPairs.keys()) {
      const [id1Str, id2Str] = pairKey.split('-')
      const id1 = typeof id1Str === 'string' ? parseInt(id1Str, 10) : NaN
      const id2 = typeof id2Str === 'string' ? parseInt(id2Str, 10) : NaN
      if (id1 === processId || id2 === processId) {
        keysToDelete.push(pairKey)
      }
    }
    for (const key of keysToDelete) {
      this.channelPairs.delete(key)
    }
  }

  /**
   * Handle webContents destruction
   */
  private handleWebContentsDestroyed(webContentsId: number): void {
    // Get process ID from webContentsId
    const processId = this.webContentsIdMap.get(webContentsId)
    if (!processId) return

    const target = this.registry.get(processId)
    if (!target) return

    const identifier = target.identifier
      ? `"${target.identifier}"`
      : `#${webContentsId}`
    this.d.log.silly?.(
      `DirectIpcMain::handleWebContentsDestroyed - ${identifier}`
    )

    // Remove from registry
    this.registry.delete(processId)

    // Remove webContentsId mapping
    this.webContentsIdMap.delete(webContentsId)

    // Remove identifier mapping
    if (target.identifier) {
      this.identifierMap.delete(target.identifier)
    }

    // Remove all channelPairs entries involving this process
    this.clearChannelPairsForProcess(processId)

    // Broadcast update
    this.broadcastMapUpdate()
  }

  /**
   * Broadcast map update to all registered renderers and utility processes
   */
  private broadcastMapUpdate(): void {
    const map = this.getMapArray()
    const message: DirectIpcMapUpdateMessage = { map }

    // Send to all renderers
    for (const target of this.registry.values()) {
      if (target.processType === ProcessType.RENDERER && target.webContentsId) {
        try {
          const wc = this.d.webContents.fromId(target.webContentsId)
          if (wc && !wc.isDestroyed()) {
            wc.send(DIRECT_IPC_CHANNELS.MAP_UPDATE, message)
          }
        } catch (error) {
          const identifier = target.identifier
            ? `"${target.identifier}"`
            : `#${target.webContentsId}`
          this.d.log.warn?.(
            `DirectIpcMain::broadcastMapUpdate - Failed to send to renderer ${identifier}:`,
            error
          )
        }
      }
    }

    // Send to all utility processes
    for (const [processId, utilityProcess] of this.utilityProcessMap.entries()) {
      const target = this.registry.get(processId)
      const identifier = target?.identifier || `process-${processId}`
      try {
        this.d.log.debug?.(
          `DirectIpcMain::broadcastMapUpdate - Sending map to utility "${identifier}" with ${map.length} processes`
        )
        utilityProcess.postMessage({
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map,
        })
      } catch (error) {
        this.d.log.warn?.(
          `DirectIpcMain::broadcastMapUpdate - Failed to send to utility process "${identifier}":`,
          error
        )
      }
    }
  }

  /**
   * Get the current map as an array (includes both renderers and utility processes)
   */
  private getMapArray(): DirectIpcTarget[] {
    return Array.from(this.registry.values())
  }

  /**
   * Get the current registry (for testing/debugging)
   */
  public getRegistry(): Map<number, DirectIpcTarget> {
    return new Map(this.registry)
  }

  /**
   * Get the identifier map (for testing/debugging)
   */
  public getIdentifierMap(): Map<string, number> {
    return new Map(this.identifierMap)
  }

  /**
   * Register a utility process with DirectIpcMain
   * @param identifier - Unique identifier for the utility process
   * @param proc - Electron UtilityProcess instance
   * @throws {IdentifierConflictError} If identifier already in use
   * @throws {Error} If process is null or already exited
   */
  public registerUtilityProcess(identifier: string, proc: UtilityProcess): void {
    if (!identifier) {
      throw new Error('DirectIpc: Utility process identifier is required')
    }

    if (!proc) {
      throw new Error('DirectIpc: Utility process instance is required')
    }

    // Check for identifier conflict
    const existingProcessId = this.identifierMap.get(identifier)
    if (existingProcessId !== undefined) {
      const existingProcess = this.registry.get(existingProcessId)
      throw new IdentifierConflictError(identifier, existingProcess?.processType || ProcessType.RENDERER)
    }

    this.d.log.silly?.(
      `DirectIpcMain::registerUtilityProcess - Registering utility process "${identifier}"`
    )

    // Assign new process ID
    const processId = this.nextProcessId++

    // Create target info for the utility process
    const targetInfo: DirectIpcTarget = {
      id: processId,
      identifier,
      processType: ProcessType.UTILITY,
      ...(proc.pid ? { pid: proc.pid } : {}),
    }

    // Store in registry
    this.registry.set(processId, targetInfo)

    // Store utility process reference
    this.utilityProcessMap.set(processId, proc)

    // Store identifier mapping
    this.identifierMap.set(identifier, processId)

    // Set up message listener for GET_PORT requests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Utility process messages are untyped, validated at runtime
    proc.on('message', (data: any) => {
      this.handleUtilityProcessMessage(processId, data)
    })

    // Set up lifecycle listener
    proc.on('exit', (code) => {
      this.handleUtilityProcessExit(processId, code)
    })

    // Broadcast map update to all renderers and utility processes
    this.broadcastMapUpdate()
  }

  /**
   * Unregister a utility process (cleanup before manual termination)
   * @param identifier - Identifier of utility process to unregister
   * @returns {boolean} True if process was unregistered, false if not found
   */
  public unregisterUtilityProcess(identifier: string): boolean {
    const processId = this.identifierMap.get(identifier)
    if (!processId) {
      return false
    }

    const target = this.registry.get(processId)
    if (!target || target.processType !== ProcessType.UTILITY) {
      return false
    }

    this.d.log.silly?.(
      `DirectIpcMain::unregisterUtilityProcess - Unregister utility process "${identifier}"`
    )

    // Remove from all maps
    this.registry.delete(processId)
    this.utilityProcessMap.delete(processId)
    this.identifierMap.delete(identifier)
    this.clearChannelPairsForProcess(processId)

    // Broadcast map update
    this.broadcastMapUpdate()

    return true
  }

  /**
   * Get all registered utility process identifiers
   * @returns Array of utility process identifiers
   */
  public getUtilityProcesses(): string[] {
    const identifiers: string[] = []
    for (const target of this.registry.values()) {
      if (target.processType === ProcessType.UTILITY && target.identifier) {
        identifiers.push(target.identifier)
      }
    }
    return identifiers
  }

  /**
   * Handle utility process exit
   */
  private handleUtilityProcessExit(processId: number, code: number): void {
    const target = this.registry.get(processId)
    if (!target) return

    this.d.log.silly?.(
      `DirectIpcMain::handleUtilityProcessExit - Utility process "${target.identifier}" exited with code ${code}`
    )

    // Remove from all maps
    this.registry.delete(processId)
    this.utilityProcessMap.delete(processId)
    if (target.identifier) {
      this.identifierMap.delete(target.identifier)
    }
    this.clearChannelPairsForProcess(processId)

    // Broadcast update
    this.broadcastMapUpdate()
  }
}
