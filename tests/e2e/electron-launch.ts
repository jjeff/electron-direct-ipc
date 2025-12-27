/**
 * Shared Electron launch utilities for E2E tests
 * Handles platform-specific flags and CI environment configuration
 */
import { _electron as electron, ElectronApplication } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Get the path to the test app's main.js file
 */
export function getTestAppPath(): string {
  return path.join(__dirname, '../../test-app/dist/main.js')
}

/**
 * Get launch arguments for Electron based on the current environment
 * Includes necessary flags for CI environments (Linux, Windows, macOS)
 */
export function getElectronLaunchArgs(mainPath: string): string[] {
  const args = [mainPath]

  if (process.env.CI) {
    // Required for running in containerized/CI environments
    args.push('--no-sandbox')
    args.push('--disable-dev-shm-usage')

    // Disable GPU acceleration - helps with Windows CI and headless environments
    args.push('--disable-gpu')
    args.push('--disable-gpu-compositing')

    // Disable unnecessary features for testing
    args.push('--disable-software-rasterizer')
    args.push('--disable-extensions')

    // Use software rendering (more reliable in CI)
    args.push('--use-gl=swiftshader')
  }

  return args
}

/**
 * Launch Electron with proper configuration for CI environments
 */
export async function launchElectron(mainPath?: string): Promise<ElectronApplication> {
  const appPath = mainPath ?? getTestAppPath()
  const args = getElectronLaunchArgs(appPath)

  console.log(`Launching Electron with args: ${args.join(' ')}`)

  const app = await electron.launch({
    args,
    timeout: process.env.CI ? 60_000 : 30_000, // Longer timeout for CI
  })

  return app
}

/**
 * Wait for a specific number of windows to be ready
 * Returns a map of window IDs to Page objects
 */
export async function waitForWindows(
  app: ElectronApplication,
  expectedCount: number,
  timeout: number = process.env.CI ? 60_000 : 10_000
): Promise<Record<string, Awaited<ReturnType<ElectronApplication['firstWindow']>>>> {
  const windows: Record<string, Awaited<ReturnType<ElectronApplication['firstWindow']>>> = {}

  app.on('window', async (page) => {
    try {
      const winId = await page.evaluate(() => (window as any).windowId)
      console.log(`Detected window with ID: ${winId}`)
      if (winId) {
        windows[winId] = page
      }
    } catch (e) {
      console.log('Failed to get window ID:', e)
    }
  })

  const startTime = Date.now()
  while (Object.keys(windows).length < expectedCount) {
    if (Date.now() - startTime > timeout) {
      throw new Error(
        `Timeout waiting for ${expectedCount} windows. Got ${Object.keys(windows).length}: [${Object.keys(windows).join(', ')}]`
      )
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  return windows
}
