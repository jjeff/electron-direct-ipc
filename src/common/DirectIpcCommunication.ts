/**
 * Direct IPC messages between renderer and main processes
 */

/**
 * Process type discriminator for DirectIpc targets
 */
export enum ProcessType {
  /** Electron renderer process (BrowserWindow) */
  RENDERER = 'renderer',
  /** Electron utility process (background Node.js worker) */
  UTILITY = 'utility',
}

/**
 * Represents a registered process in the DirectIpc system
 */
export type DirectIpcTarget = {
  /** Unique ID assigned by DirectIpcMain for this process */
  id: number
  /** Target webContents id (only for RENDERER type) */
  webContentsId?: number
  /** Full URL of the webContents (only for RENDERER type) */
  url?: string
  /** Optional user-defined identifier string */
  identifier?: string
  /** Process type discriminator */
  processType: ProcessType
  /** Process ID for diagnostic purposes (optional) */
  pid?: number
}

/**
 * Message sent from Main to all renderers when the map updates
 */
export type DirectIpcMapUpdateMessage = {
  map: DirectIpcTarget[]
}

/**
 * Message sent from Main to a renderer with the other end of a MessagePort
 */
export type DirectIpcPortMessage = {
  /** Information about the sender */
  sender: DirectIpcTarget
}

/**
 * Message string to identify direct IPC messages
 * between renderer and main processes
 */
export const DIRECT_IPC_CHANNEL = '___DIRECT_IPC_MESSAGE___'

/**
 * Channels used for DirectIpc communication
 */
export const DIRECT_IPC_CHANNELS = {
  /** Renderer subscribes to get initial map */
  SUBSCRIBE: `${DIRECT_IPC_CHANNEL}:subscribe`,
  /** Renderer updates its identifier */
  UPDATE_IDENTIFIER: `${DIRECT_IPC_CHANNEL}:update-identifier`,
  /** Renderer requests a port to another renderer */
  GET_PORT: `${DIRECT_IPC_CHANNEL}:get-port`,
  /** Renderer requests manual map refresh */
  REFRESH_MAP: `${DIRECT_IPC_CHANNEL}:refresh-map`,
  /** Main sends map updates */
  MAP_UPDATE: `${DIRECT_IPC_CHANNEL}:map-update`,
  /** Main sends MessagePort to renderer */
  PORT_MESSAGE: `${DIRECT_IPC_CHANNEL}:port`,
  /** Utility process registers with main */
  UTILITY_REGISTER: `${DIRECT_IPC_CHANNEL}:utility-register`,
  /** Utility process signals ready state */
  UTILITY_READY: `${DIRECT_IPC_CHANNEL}:utility-ready`,
} as const

/**
 * Type guard: Check if target is a renderer process
 */
export function isRenderer(
  target: DirectIpcTarget
): target is DirectIpcTarget & { webContentsId: number; url: string } {
  return target.processType === ProcessType.RENDERER
}

/**
 * Type guard: Check if target is a utility process
 */
export function isUtilityProcess(
  target: DirectIpcTarget
): target is DirectIpcTarget & { pid: number } {
  return target.processType === ProcessType.UTILITY
}
