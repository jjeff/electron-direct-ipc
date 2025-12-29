import { test, expect, _electron as electron } from '@playwright/test'
import { getElectronLaunchArgs, getTestAppPath } from './electron-launch.js'

test.describe('Debug Console Output', () => {
  test('capture console logs from main and utility processes', async () => {
    const logs: string[] = []

    // Launch Electron app with proper CI flags
    const testAppPath = getTestAppPath()
    const launchArgs = getElectronLaunchArgs(testAppPath)

    console.log('Launching Electron app for debug console test...')
    const app = await electron.launch({
      args: launchArgs,
      timeout: process.env.CI ? 60_000 : 30_000,
    })

    // Capture console output from main process
    app.process().stdout?.on('data', (data) => {
      const output = data.toString()
      console.log('[STDOUT]', output)
      logs.push(output)
    })

    app.process().stderr?.on('data', (data) => {
      const output = data.toString()
      console.log('[STDERR]', output)
      logs.push(output)
    })

    // Get the first window
    const window = await app.firstWindow()

    // Capture console from renderer
    window.on('console', (msg) => {
      console.log(`[RENDERER ${msg.type()}]`, msg.text())
      logs.push(`[RENDERER] ${msg.text()}`)
    })

    // Wait a bit for initialization
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Check if we see DirectIpc logs
    const directIpcLogs = logs.filter(
      (log) => log.includes('DirectIpc') || log.includes('[Main]') || log.includes('[Utility')
    )

    console.log('\n=== Captured Logs ===')
    directIpcLogs.forEach((log) => console.log(log))
    console.log('=== End Logs ===\n')

    // Wait a bit more to see periodic messages
    await new Promise((resolve) => setTimeout(resolve, 6000))

    // Print final logs
    const finalLogs = logs.filter(
      (log) => log.includes('DirectIpc') || log.includes('[Main]') || log.includes('[Utility')
    )
    console.log('\n=== Final Logs ===')
    finalLogs.forEach((log) => console.log(log))
    console.log('=== End Final Logs ===\n')

    await app.close()

    // Just pass the test - we're using this to see logs
    expect(true).toBe(true)
  })
})
