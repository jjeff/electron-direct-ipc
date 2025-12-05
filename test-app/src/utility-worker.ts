/**
 * Example utility process worker for electron-direct-ipc
 *
 * This file demonstrates how to set up a utility process that can
 * communicate with renderer processes using DirectIpcUtility.
 */

import { DirectIpcUtility } from 'electron-direct-ipc/utility';

console.log('[Utility Worker] Starting...');

// Message types for this worker
type WorkerMessageMap = {
  'compute-request': (data: number) => void;
  'ping': () => void;
  'status-update': (status: string, timestamp: number) => void;
};

type WorkerInvokeMap = {
  'heavy-computation': (numbers: number[]) => Promise<number>;
  'get-stats': () => Promise<{ uptime: number; processed: number }>;
  'slow-operation': (delay: number) => Promise<string>;
};

// Create DirectIpcUtility instance with identifier
const utility = DirectIpcUtility.instance<WorkerMessageMap, WorkerInvokeMap>({
  identifier: 'compute-worker',
});

console.log('[Utility Worker] DirectIpcUtility initialized with identifier "compute-worker"');

// Track statistics
let processedCount = 0;
const startTime = Date.now();

// Listen for compute requests
console.log('[Utility Worker] Setting up compute-request listener...');
utility.on('compute-request', async (sender, data: number) => {
  console.log(`[Utility Worker] *** COMPUTE-REQUEST HANDLER TRIGGERED *** from ${sender.identifier || sender.webContentsId}: ${data}`);

  // Simulate heavy computation
  const result = data * data;
  processedCount++;

  console.log(`[Utility Worker] Computed result: ${result}, sending back to sender`);

  // Send result back using sender info
  if (sender.identifier) {
    await utility.send({ identifier: sender.identifier }, 'compute-request', result);
  } else if (sender.webContentsId) {
    await utility.send({ webContentsId: sender.webContentsId }, 'compute-request', result);
  }
});

// Listen for ping messages
utility.on('ping', async (sender) => {
  console.log(`[Utility Worker] Received ping from ${sender.identifier || sender.webContentsId}`);

  // Send status update back
  if (sender.identifier) {
    await utility.send({ identifier: sender.identifier }, 'status-update', 'pong', Date.now());
  } else if (sender.webContentsId) {
    await utility.send({ webContentsId: sender.webContentsId }, 'status-update', 'pong', Date.now());
  }
});

// Handle heavy computation invoke requests
utility.handle('heavy-computation', async (sender, numbers: number[]) => {
  console.log(`[Utility Worker] Received heavy-computation invoke from ${sender.identifier || sender.webContentsId} with ${numbers.length} numbers`);

  // Simulate heavy computation
  const sum = numbers.reduce((a, b) => a + b, 0);
  processedCount++;

  console.log(`[Utility Worker] Computed sum: ${sum}`);
  return sum;
});

// Handle stats invoke requests
utility.handle('get-stats', async (sender) => {
  console.log(`[Utility Worker] Received get-stats invoke from ${sender.identifier || sender.webContentsId}`);

  const uptime = Date.now() - startTime;
  return {
    uptime,
    processed: processedCount,
  };
});

// Handle slow operation (for timeout testing)
utility.handle('slow-operation', async (sender, delay: number) => {
  console.log(`[Utility Worker] Received slow-operation invoke from ${sender.identifier || sender.webContentsId} with delay ${delay}ms`);

  await new Promise(resolve => setTimeout(resolve, delay));
  return `Completed after ${delay}ms`;
});

// Send periodic status updates to all renderers
setInterval(() => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[Utility Worker] Periodic status update - uptime: ${uptime}s, processed: ${processedCount}`);
  console.log(`[Utility Worker] Current map has ${utility['map']?.length || 0} processes`);

  // Broadcast status to all renderers
  console.log(`[Utility Worker] Attempting to send status-update to all renderers...`);
  void utility.send({ allIdentifiers: /.*/ }, 'status-update', `alive (${processedCount} processed)`, Date.now())
    .then(() => console.log('[Utility Worker] Status update sent successfully'))
    .catch(err => console.error('[Utility Worker] Failed to send status update:', err));
}, 5000);

console.log('[Utility Worker] Ready and listening for messages');

// Listen for registration events
utility.localEvents.on('registration-complete', () => {
  console.log('[Utility Worker] Registration complete with main process');
});

utility.localEvents.on('registration-failed', (error) => {
  console.error('[Utility Worker] Registration failed:', error);
});

utility.localEvents.on('map-updated', (map) => {
  console.log(`[Utility Worker] Process map updated - ${map.length} processes available`);
});
