/**
 * Example utility process worker for electron-direct-ipc
 *
 * This file demonstrates how to set up a utility process that can
 * communicate with renderer processes using DirectIpcUtility.
 */

import { DirectIpcUtility } from 'electron-direct-ipc/utility'

console.log('[Utility Worker] Starting...')

// Message types for this worker
type WorkerMessageMap = {
  'compute-request': (data: number) => void
  ping: () => void
  'status-update': (status: string, timestamp: number) => void
  // Throttled messages
  'throttled-position': (x: number, y: number) => void
  'throttled-progress': (percent: number) => void
}

type WorkerInvokeMap = {
  'heavy-computation': (numbers: number[]) => Promise<number>
  'get-stats': () => Promise<{ uptime: number; processed: number }>
  'slow-operation': (delay: number) => Promise<string>
  // Throttled testing handlers
  'get-throttled-stats': () => Promise<{
    lastPosition: { x: number; y: number }
    receiveCount: number
  }>
  'reset-throttled-stats': () => Promise<boolean>
  'send-throttled-progress': (count: number) => Promise<number>
  // E2E testing handler - trigger broadcast on demand
  'broadcast-status': () => Promise<boolean>
}

// Create DirectIpcUtility instance with identifier
const utility = DirectIpcUtility.instance<WorkerMessageMap, WorkerInvokeMap>({
  identifier: 'compute-worker',
})

console.log('[Utility Worker] DirectIpcUtility initialized with identifier "compute-worker"')

// Track statistics
let processedCount = 0
const startTime = Date.now()

// Listen for compute requests
console.log('[Utility Worker] Setting up compute-request listener...')
utility.on('compute-request', async (sender, data: number) => {
  console.log(
    `[Utility Worker] *** COMPUTE-REQUEST HANDLER TRIGGERED *** from ${sender.identifier || sender.webContentsId}: ${data}`
  )

  // Simulate heavy computation
  const result = data * data
  processedCount++

  console.log(`[Utility Worker] Computed result: ${result}, sending back to sender`)

  // Send result back using sender info
  if (sender.identifier) {
    await utility.send({ identifier: sender.identifier }, 'compute-request', result)
  } else if (sender.webContentsId) {
    await utility.send({ webContentsId: sender.webContentsId }, 'compute-request', result)
  }
})

// Listen for ping messages
utility.on('ping', async (sender) => {
  console.log(`[Utility Worker] Received ping from ${sender.identifier || sender.webContentsId}`)

  // Send status update back
  if (sender.identifier) {
    await utility.send({ identifier: sender.identifier }, 'status-update', 'pong', Date.now())
  } else if (sender.webContentsId) {
    await utility.send({ webContentsId: sender.webContentsId }, 'status-update', 'pong', Date.now())
  }
})

// Handle heavy computation invoke requests
utility.handle('heavy-computation', async (sender, numbers: number[]) => {
  console.log(
    `[Utility Worker] Received heavy-computation invoke from ${sender.identifier || sender.webContentsId} with ${numbers.length} numbers`
  )

  // Simulate heavy computation
  const sum = numbers.reduce((a, b) => a + b, 0)
  processedCount++

  console.log(`[Utility Worker] Computed sum: ${sum}`)
  return sum
})

// Handle stats invoke requests
utility.handle('get-stats', async (sender) => {
  console.log(
    `[Utility Worker] Received get-stats invoke from ${sender.identifier || sender.webContentsId}`
  )

  const uptime = Date.now() - startTime
  return {
    uptime,
    processed: processedCount,
  }
})

// Handle slow operation (for timeout testing)
utility.handle('slow-operation', async (sender, delay: number) => {
  console.log(
    `[Utility Worker] Received slow-operation invoke from ${sender.identifier || sender.webContentsId} with delay ${delay}ms`
  )

  await new Promise((resolve) => setTimeout(resolve, delay))
  return `Completed after ${delay}ms`
})

// ============================================================================
// Throttled message handling
// ============================================================================

// Track received throttled positions for testing
let lastReceivedPosition = { x: -1, y: -1 }
let throttledPositionReceiveCount = 0

// Listen for throttled position updates from renderers (using throttled receiver)
utility.throttled.on('throttled-position', (sender, x, y) => {
  throttledPositionReceiveCount++
  lastReceivedPosition = { x, y }
  console.log(
    `[Utility Worker] [Throttled] Received position update from ${sender.identifier}: x=${x}, y=${y} (total received: ${throttledPositionReceiveCount})`
  )
})

// Handle request to get throttled stats (for E2E verification)
utility.handle('get-throttled-stats', async () => {
  return {
    lastPosition: lastReceivedPosition,
    receiveCount: throttledPositionReceiveCount,
  }
})

// Handle request to reset throttled stats
utility.handle('reset-throttled-stats', async () => {
  lastReceivedPosition = { x: -1, y: -1 }
  throttledPositionReceiveCount = 0
  console.log('[Utility Worker] Throttled stats reset')
  return true
})

// Handle request to send throttled progress updates to a renderer
utility.handle('send-throttled-progress', async (sender, count: number) => {
  console.log(
    `[Utility Worker] Sending ${count} throttled progress updates to ${sender.identifier}`
  )

  // Send many rapid throttled updates - only the last should arrive
  for (let i = 0; i <= count; i++) {
    const percent = Math.round((i / count) * 100)
    if (sender.identifier) {
      utility.throttled.send({ identifier: sender.identifier }, 'throttled-progress', percent)
    } else if (sender.webContentsId) {
      utility.throttled.send({ webContentsId: sender.webContentsId }, 'throttled-progress', percent)
    }
  }

  // Wait for microtask to flush the throttled sends before returning
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
  // Add a small delay to ensure messages are delivered
  await new Promise((resolve) => setTimeout(resolve, 50))

  return count
})

// Handle request to broadcast status to all renderers (for E2E testing without waiting for periodic interval)
utility.handle('broadcast-status', async () => {
  console.log('[Utility Worker] Broadcasting status on demand')
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  await utility.send(
    { allIdentifiers: /.*/ },
    'status-update',
    `alive (${processedCount} processed)`,
    Date.now()
  )
  console.log(`[Utility Worker] On-demand status broadcast complete - uptime: ${uptime}s`)
  return true
})

// Send periodic status updates to all renderers
setInterval(() => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  console.log(
    `[Utility Worker] Periodic status update - uptime: ${uptime}s, processed: ${processedCount}`
  )
  console.log(`[Utility Worker] Current map has ${utility['map']?.length || 0} processes`)

  // Broadcast status to all renderers
  console.log(`[Utility Worker] Attempting to send status-update to all renderers...`)
  void utility
    .send(
      { allIdentifiers: /.*/ },
      'status-update',
      `alive (${processedCount} processed)`,
      Date.now()
    )
    .then(() => console.log('[Utility Worker] Status update sent successfully'))
    .catch((err) => console.error('[Utility Worker] Failed to send status update:', err))
}, 5000)

console.log('[Utility Worker] Ready and listening for messages')

// Listen for registration events
utility.localEvents.on('registration-complete', () => {
  console.log('[Utility Worker] Registration complete with main process')
})

utility.localEvents.on('registration-failed', (error) => {
  console.error('[Utility Worker] Registration failed:', error)
})

utility.localEvents.on('map-updated', (map) => {
  console.log(`[Utility Worker] Process map updated - ${map.length} processes available`)
})
