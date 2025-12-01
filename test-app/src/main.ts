import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import {DirectIpcMain} from 'electron-direct-ipc/main';

// Set up DirectIpc handling in main
DirectIpcMain.init();

let winCounter = 0;

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    x: 30 * winCounter,
    y: 30 * winCounter,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disable sandbox for better module resolution in preload
      additionalArguments: [`--win-id=${++winCounter}`],
    },
  });
  // win.webContents.openDevTools();
  win.loadFile(path.join(__dirname, 'index.html'));
}



function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
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
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  setupMenu();
  // create 2 windows
  createWindow();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


