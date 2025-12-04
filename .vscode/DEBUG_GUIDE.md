# Debugging the Test App

This workspace includes VSCode debug configurations for the Electron test app.

## Available Debug Configurations

### 1. Debug Test App (Main Process)
- Debugs only the Electron main process
- Automatically builds the library and test-app before launching
- Best for debugging main process code (DirectIpcMain, utility process registration, etc.)
- **Use this to debug**: `test-app/src/main.ts`, `src/main/DirectIpcMain.ts`

### 2. Debug Test App (Renderer Process)
- Attaches to the renderer process for debugging
- **Requires**: Main process must be running with `--remote-debugging-port=9222`
- Best for debugging renderer/preload code
- **Use this to debug**: `test-app/src/preload.ts`, `test-app/src/renderer.ts`, `src/renderer/DirectIpcRenderer.ts`

### 3. Debug Test App (Main + Enable Renderer Debugging)
- Like #1, but enables remote debugging on port 9222
- Use this if you plan to also attach the renderer debugger
- Automatically builds before launching

### 4. Debug Test App (Full Stack) - **RECOMMENDED**
- Compound configuration that launches both main and renderer debuggers
- Automatically builds everything, launches main process with debugging enabled, then attaches to renderer
- Best for full-stack debugging where you need to trace messages across processes
- **This is the easiest way to debug the current renderer→utility communication issue**

## How to Debug

### Quick Start (Recommended)
1. Press `F5` or click "Run and Debug" in the sidebar
2. Select "Debug Test App (Full Stack)" from the dropdown
3. The app will build and launch with both debuggers attached
4. Set breakpoints in any file (main, renderer, preload, or library code)

### Debugging Specific Code

#### To debug DirectIpcRenderer subscription:
1. Open `src/renderer/DirectIpcRenderer.ts`
2. Set breakpoint in the `subscribe()` method (line ~358)
3. Set breakpoint in `handleMapUpdate()` method (line ~400)
4. Launch "Debug Test App (Full Stack)"
5. Breakpoints will hit when the renderer subscribes

#### To debug utility process registration:
1. Open `src/main/DirectIpcMain.ts`
2. Set breakpoint in `registerUtilityProcess()` (line ~761)
3. Set breakpoint in `broadcastMapUpdate()` (line ~688)
4. Launch "Debug Test App (Main Process)"
5. Breakpoints will hit during startup

#### To debug renderer sending messages:
1. Open `src/renderer/DirectIpcRenderer.ts`
2. Set breakpoint in the `send()` method (line ~725)
3. Open `test-app/src/preload.ts`
4. Set breakpoint in the `sendCompute` function (line ~27)
5. Launch "Debug Test App (Full Stack)"
6. Click the "Send Compute" button in the app
7. Trace the message flow

## Current Issue Being Debugged

The renderer's map is empty (`mapSize: 0`) when trying to send to utility processes.

**Key breakpoints to set:**
1. `src/renderer/DirectIpcRenderer.ts:364` - After subscribe gets the map
2. `src/renderer/DirectIpcRenderer.ts:400` - handleMapUpdate receives newMap
3. `src/renderer/DirectIpcRenderer.ts:425` - Map assignment
4. `src/main/DirectIpcMain.ts:244` - handleSubscribe returns map to renderer
5. `src/main/DirectIpcMain.ts:689` - getMapArray creates the map

## Tips

- **Source Maps**: All configurations include source map support, so you can debug TypeScript directly
- **Console Output**: Main process logs appear in the VSCode Debug Console
- **Renderer DevTools**: When renderer debugging is enabled, you can also use Chrome DevTools (View → Toggle Developer Tools in the Electron app)
- **Breakpoints**: You can set breakpoints before launching - they'll be bound when the code loads
- **Stop All**: The compound configuration will stop both debuggers when you stop debugging

## Build Tasks

You can also manually run build tasks:
- **Cmd+Shift+B** (or **Ctrl+Shift+B**): Opens build task menu
  - "Build Library": Builds the main library
  - "Build Test App": Builds the test app
  - "Build All": Builds both (this is the default)
  - "Watch Test App": Starts TypeScript watch mode for test-app

## Troubleshooting

### "Cannot connect to runtime process"
- Make sure the test-app dependencies are installed: `cd test-app && npm install`

### Breakpoints not binding
- Make sure you've built the code (`Cmd+Shift+B` → "Build All")
- Check that source maps are being generated (they should be by default)

### Renderer debugger won't attach
- Make sure main process is running with `--remote-debugging-port=9222`
- Try waiting a few seconds after main process launches before attaching
- Use the "Debug Test App (Full Stack)" compound configuration instead
