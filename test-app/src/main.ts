import { app, BrowserWindow, ipcMain, Menu, MenuItem, utilityProcess, screen } from 'electron'
import * as path from 'path'
import { DirectIpcMain } from 'electron-direct-ipc/main'

// Set up DirectIpc handling in main
const directIpcMain = DirectIpcMain.init()

let winCounter = 0

function createWindow() {
  const menuHeight = screen.getPrimaryDisplay().workArea.y
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    x: 30 * winCounter,
    y: menuHeight + 30 * winCounter,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disable sandbox for better module resolution in preload
      additionalArguments: [`--win-id=${++winCounter}`],
    },
  })
  // win.webContents.openDevTools();
  win.loadFile(path.join(__dirname, 'index.html'))
}

function setupMenu() {
  const template: Electron.MenuItemConstructorOptions = {
    label: 'Test App',
    submenu: [
      {
        label: 'New Window',
        id: 'new-window',
        accelerator: 'CmdOrCtrl+N',
        click: () => createWindow(),
      } as Electron.MenuItemConstructorOptions,
      { type: 'separator' } as Electron.MenuItemConstructorOptions,
      {
        label: 'Quit',
        id: 'quit',
        accelerator: 'CmdOrCtrl+Q',
        role: 'quit',
      } as Electron.MenuItemConstructorOptions,
    ],
  }

  const menuItem = new MenuItem(template)
  const appMenu = Menu.getApplicationMenu()
  appMenu?.append(menuItem)
  Menu.setApplicationMenu(appMenu!)
}

let utility: Electron.UtilityProcess

app.whenReady().then(() => {
  setupMenu()

  // Spawn utility process worker
  console.log('[Main] Spawning utility process worker...')
  utility = utilityProcess.fork(path.join(__dirname, 'utility-worker.js'), [], {
    serviceName: 'compute-worker',
  })

  // Register utility process with DirectIpcMain
  directIpcMain.registerUtilityProcess('compute-worker', utility)
  console.log('[Main] Utility process registered with identifier "compute-worker"')

  // Handle worker exit
  utility.on('exit', (code) => {
    console.log(`[Main] Utility process exited with code ${code}`)
  })

  // create 2 windows
  createWindow()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('E2E_POST_MESSAGE', (event, msg) => {
  console.log(`[Main] Received E2E_POST_MESSAGE: ${msg}`)
  return utility.postMessage(msg)
})

ipcMain.handle('E2E_TERMINATE_UTILITY', (_event) => {
  console.log('[Main] Terminating utility process as per E2E_TERMINATE_UTILITY request')
  utility.kill()
})

ipcMain.handle(
  'E2E_WAIT_FOR_MESSAGE',
  async (_event, propertyMatcher: Record<string, unknown>, timeout = 5000) => {
    console.log(
      `[Main] Setting up listener for E2E_WAIT_FOR_MESSAGE: ${JSON.stringify(propertyMatcher)}`
    )
    return await new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        utility.removeListener('message', messageHandler)
        reject(new Error('Timeout waiting for matching message'))
      }, timeout)

      const messageHandler = (msg: any) => {
        const isMatch = Object.entries(propertyMatcher).every(([key, value]) => msg[key] === value)
        if (isMatch) {
          clearTimeout(timeoutId)
          utility.removeListener('message', messageHandler)
          console.log(`[Main] E2E_WAIT_FOR_MESSAGE matched: ${JSON.stringify(msg)}`)
          resolve(msg)
        }
      }

      utility.on('message', messageHandler)
    })
  }
)

// ============================================================================
// BENCHMARK: Traditional IPC handlers for comparison testing
// These handlers demonstrate the "old way" of doing renderer-to-renderer
// communication via the main process relay pattern.
// ============================================================================

// Track all windows by their ID for relay functionality
const windowsById = new Map<string, BrowserWindow>()

// Register window when it's created
ipcMain.handle('BENCHMARK_REGISTER_WINDOW', (event, windowId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    windowsById.set(windowId, win)
  }
  return true
})

// Traditional IPC: Simple ping through main (renderer -> main -> renderer response)
ipcMain.handle('BENCHMARK_IPC_PING', (_event, index: number) => {
  return index
})

// Traditional IPC: Relay message from one renderer to another via main process
// This is the classic pattern: renderer1 -> main -> renderer2
ipcMain.handle(
  'BENCHMARK_IPC_RELAY',
  async (_event, targetWindowId: string, channel: string, data: unknown) => {
    const targetWin = windowsById.get(targetWindowId)
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send(channel, data)
      return true
    }
    return false
  }
)

// Traditional IPC: Relay with response (renderer1 -> main -> renderer2 -> main -> renderer1)
// This simulates invoke-like behavior through main process relay
let relayResponseHandlers = new Map<string, (response: unknown) => void>()
let relayRequestId = 0

ipcMain.handle(
  'BENCHMARK_IPC_RELAY_INVOKE',
  async (_event, targetWindowId: string, channel: string, data: unknown) => {
    const targetWin = windowsById.get(targetWindowId)
    if (!targetWin || targetWin.isDestroyed()) {
      throw new Error(`Window ${targetWindowId} not found`)
    }

    const requestId = `relay-${++relayRequestId}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        relayResponseHandlers.delete(requestId)
        reject(new Error('Relay invoke timeout'))
      }, 5000)

      relayResponseHandlers.set(requestId, (response) => {
        clearTimeout(timeout)
        relayResponseHandlers.delete(requestId)
        resolve(response)
      })

      targetWin.webContents.send(channel, { requestId, data })
    })
  }
)

// Handle relay responses coming back through main
ipcMain.on('BENCHMARK_IPC_RELAY_RESPONSE', (_event, requestId: string, response: unknown) => {
  const handler = relayResponseHandlers.get(requestId)
  if (handler) {
    handler(response)
  }
})
