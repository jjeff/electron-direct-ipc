/**
 * Direct IPC messages between renderer and main processes
 */

/**
 * Represents a registered renderer in the DirectIpc system
 */
export type DirectIpcTarget = {
  /** Target webContents id */
  webContentsId: number
  /** Full URL of the webContents */
  url: string
  /** Optional user-defined identifier string */
  identifier?: string
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
} as const
