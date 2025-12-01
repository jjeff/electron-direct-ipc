import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  webContents,
  WebContents,
} from 'electron';
import {
  DIRECT_IPC_CHANNELS,
  DirectIpcMapUpdateMessage,
  DirectIpcPortMessage,
  DirectIpcTarget,
} from '../common/DirectIpcCommunication.js';
import { consoleLogger } from "../common/DirectIpcLogger.js";

/**
 * Main process DirectIpc coordinator
 * Manages the registry of renderer processes and facilitates MessagePort creation
 */
export class DirectIpcMain {
  /** Singleton instance */
  private static _instance: DirectIpcMain | null = null

  /**
   * Get the singleton instance of DirectIpcMain
   */
  public static instance(options = {} as Partial<Pick<DirectIpcMain['d'], 'log'>>): DirectIpcMain {
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

  /** Map of webContentsId to DirectIpcTarget info */
  private registry = new Map<number, DirectIpcTarget>()

  /** Map of identifier to webContentsId (for quick lookup and conflict detection) */
  private identifierMap = new Map<string, number>()

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

    // Check for identifier conflict
    if (identifier) {
      const existingId = this.identifierMap.get(identifier)
      if (existingId !== undefined && existingId !== webContentsId) {
        throw new Error(
          `DirectIpc identifier "${identifier}" is already in use by webContents ${existingId}`
        )
      }
    }

    // If this renderer is re-subscribing (e.g., after a reload), clear all channel pairs
    // involving it, since the old MessagePorts are now invalid
    const wasAlreadyRegistered = this.registry.has(webContentsId)
    if (wasAlreadyRegistered) {
      const identifierStr = identifier ? `"${identifier}"` : `#${webContentsId}`
      this.d.log.silly?.(
        `DirectIpcMain::handleSubscribe - Renderer ${identifierStr} re-subscribing, clearing channel pairs`
      )
      this.clearChannelPairsForWebContents(webContentsId)
    }

    // Register this renderer
    const targetInfo: DirectIpcTarget = {
      webContentsId,
      url,
      ...(identifier ? { identifier } : {}),
    }

    this.registry.set(webContentsId, targetInfo)
    if (identifier) {
      this.identifierMap.set(identifier, webContentsId)
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
    const existing = this.registry.get(webContentsId)

    if (!existing) {
      throw new Error(
        `DirectIpc: Cannot update identifier for unregistered webContents #${webContentsId} "${newIdentifier}" at ${this.truncatedUrl(sender.getURL())}`
      )
    }

    // Check for identifier conflict
    const conflictingId = this.identifierMap.get(newIdentifier)
    if (conflictingId !== undefined && conflictingId !== webContentsId) {
      const conflictingTarget = this.registry.get(conflictingId)
      const conflictingUrl = conflictingTarget?.url
        ? this.truncatedUrl(conflictingTarget.url)
        : 'unknown'
      throw new Error(
        `DirectIpc identifier "${newIdentifier}" (requested by "${this.truncatedUrl(sender.getURL())}") is already in use by webContents #${conflictingId} at ${conflictingUrl}`
      )
    }

    const oldIdentifier = existing.identifier
      ? `"${existing.identifier}"`
      : '(none)'
    this.d.log.silly?.(
      `DirectIpcMain::handleUpdateIdentifier - #${webContentsId} at ${this.truncatedUrl(existing.url)}: ${oldIdentifier} -> "${newIdentifier}"`
    )

    // Remove old identifier mapping
    if (existing.identifier) {
      this.identifierMap.delete(existing.identifier)
    }

    // Update to new identifier
    existing.identifier = newIdentifier
    this.identifierMap.set(newIdentifier, webContentsId)

    // Broadcast update
    this.broadcastMapUpdate()
  }

  /**
   * Handle a port request - create MessageChannel and distribute ports
   */
  private handleGetPort(
    sender: WebContents,
    target: {
      webContentsId?: number
      identifier?: string | RegExp
      url?: string | RegExp
    }
  ): boolean {
    const targetWebContents = this.findWebContents(target)

    if (!targetWebContents) {
      const senderInfo = this.registry.get(sender.id)
      const senderStr = senderInfo?.identifier
        ? `"${senderInfo.identifier}"`
        : `#${sender.id}`
      const senderUrl = senderInfo?.url
        ? ` at ${this.truncatedUrl(senderInfo.url)}`
        : ''
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Could not find target from ${senderStr}${senderUrl}:`,
        target
      )
      return false
    }

    const senderInfo = this.registry.get(sender.id)
    if (!senderInfo) {
      this.d.log.error?.(
        `DirectIpcMain::handleGetPort - Sender not registered: #${sender.id} at ${this.truncatedUrl(sender.getURL())}`
      )
      return false
    }

    // Create normalized pair key (ensures same key regardless of direction)
    const pairKey = this.getChannelPairKey(sender.id, targetWebContents.id)

    // Get target info for logging
    const targetInfo = this.registry.get(targetWebContents.id)
    const senderStr = senderInfo.identifier
      ? `"${senderInfo.identifier}"`
      : `#${sender.id}`
    const targetStr = targetInfo?.identifier
      ? `"${targetInfo.identifier}"`
      : `#${targetWebContents.id}`

    // Check if a channel already exists between these renderers
    if (this.channelPairs.has(pairKey)) {
      this.d.log.silly?.(
        `DirectIpcMain::handleGetPort - Channel already exists between ${senderStr} and ${targetStr}, reusing`
      )
      return true
    }

    this.d.log.silly?.(
      `DirectIpcMain::handleGetPort - Creating channel between ${senderStr} and ${targetStr}`
    )

    // Create MessageChannel in the main process
    const { port1, port2 } = new MessageChannelMain()

    // Send port2 to target with sender info
    const portMessage: DirectIpcPortMessage = { sender: senderInfo }
    targetWebContents.postMessage(
      DIRECT_IPC_CHANNELS.PORT_MESSAGE,
      portMessage,
      [port2]
    )

    // Send port1 back to sender with target info
    const senderMessage: DirectIpcPortMessage = { sender: targetInfo! }
    sender.postMessage(DIRECT_IPC_CHANNELS.PORT_MESSAGE, senderMessage, [port1])

    // Mark this pair as having a channel
    this.channelPairs.set(pairKey, true)

    return true
  }

  /**
   * Find a WebContents by various criteria
   */
  private findWebContents(target: {
    webContentsId?: number
    identifier?: string | RegExp
    url?: string | RegExp
  }): WebContents | undefined {
    // Direct webContentsId lookup
    if (target.webContentsId !== undefined) {
      return this.d.webContents.fromId(target.webContentsId)
    }

    // Identifier lookup
    if (target.identifier !== undefined) {
      const matches = this.findByIdentifier(target.identifier)
      if (matches.length > 1) {
        throw new Error(
          `DirectIpc: Multiple matches found for identifier pattern. Use sendToAll* method instead.`
        )
      }
      if (matches.length === 1) {
        if (matches[0] && matches[0].webContentsId !== undefined) {
          return this.d.webContents.fromId(matches[0].webContentsId)
        }
        return undefined
      }
    }

    // URL lookup
    if (target.url !== undefined) {
      const matches = this.findByUrl(target.url)
      if (matches.length > 1) {
        throw new Error(
          `DirectIpc: Multiple matches found for URL pattern. Use sendToAll* method instead.`
        )
      }
      if (matches.length === 1) {
        if (matches[0] && matches[0].webContentsId !== undefined) {
          return this.d.webContents.fromId(matches[0].webContentsId)
        }
        return undefined
      }
    }

    return undefined
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
      if (regex.test(target.url)) {
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
  private clearChannelPairsForWebContents(webContentsId: number): void {
    const keysToDelete: string[] = []
    for (const pairKey of this.channelPairs.keys()) {
      const [id1Str, id2Str] = pairKey.split('-')
      const id1 = typeof id1Str === 'string' ? parseInt(id1Str, 10) : NaN
      const id2 = typeof id2Str === 'string' ? parseInt(id2Str, 10) : NaN
      if (id1 === webContentsId || id2 === webContentsId) {
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
    const target = this.registry.get(webContentsId)
    if (!target) return

    const identifier = target.identifier
      ? `"${target.identifier}"`
      : `#${webContentsId}`
    this.d.log.silly?.(
      `DirectIpcMain::handleWebContentsDestroyed - ${identifier}`
    )

    // Remove from registry
    this.registry.delete(webContentsId)

    // Remove identifier mapping
    if (target.identifier) {
      this.identifierMap.delete(target.identifier)
    }

    // Remove all channelPairs entries involving this webContents
    this.clearChannelPairsForWebContents(webContentsId)

    // Broadcast update
    this.broadcastMapUpdate()
  }

  /**
   * Broadcast map update to all registered renderers
   */
  private broadcastMapUpdate(): void {
    const map = this.getMapArray()
    const message: DirectIpcMapUpdateMessage = { map }

    for (const target of this.registry.values()) {
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
          `DirectIpcMain::broadcastMapUpdate - Failed to send to ${identifier}:`,
          error
        )
      }
    }
  }

  /**
   * Get the current map as an array
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
}
