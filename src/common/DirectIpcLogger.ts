/**
 * Logger interface for DirectIpc
 */
export interface DirectIpcLogger {
  silly?: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
  info?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

/**
 * Console-based logger fallback
 */

export const consoleLogger: DirectIpcLogger = {
  silly: () => { }, // console.debug would be too verbose
  debug: () => { }, // console.debug would be too verbose
  info: console.log,
  warn: console.warn,
  error: console.error,
};
