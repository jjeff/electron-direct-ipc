// Renderer script for Electron test app
// This file runs in the browser context (not Node.js)
// No imports/exports to avoid module system

window.addEventListener('DOMContentLoaded', () => {
  const w = window as any;

  const root = document.getElementById('root');
  if (root) {
    root.innerText = `Electron Test App - Window ${w.windowId}`;
  }

  // Utility process button handlers
  const utilSendCompute = document.getElementById('util-send-compute');
  if (utilSendCompute) {
    utilSendCompute.addEventListener('click', () => {
      console.log('[Renderer] Sending compute request to utility worker');
      w.directIpc.util.sendCompute(5);
    });
  }

  const utilSendPing = document.getElementById('util-send-ping');
  if (utilSendPing) {
    utilSendPing.addEventListener('click', () => {
      console.log('[Renderer] Sending ping to utility worker');
      w.directIpc.util.sendPing();
    });
  }

  const utilInvokeComputation = document.getElementById('util-invoke-computation');
  if (utilInvokeComputation) {
    utilInvokeComputation.addEventListener('click', async () => {
      console.log('[Renderer] Invoking computation on utility worker');
      try {
        const result = await w.directIpc.util.invokeComputation([1, 2, 3, 4, 5]);
        console.log('[Renderer] Computation result:', result);
        alert(`Computation result: ${result}`);
      } catch (error) {
        console.error('[Renderer] Computation error:', error);
        alert(`Error: ${error}`);
      }
    });
  }

  const utilInvokeStats = document.getElementById('util-invoke-stats');
  if (utilInvokeStats) {
    utilInvokeStats.addEventListener('click', async () => {
      console.log('[Renderer] Getting stats from utility worker');
      try {
        const stats = await w.directIpc.util.invokeStats();
        console.log('[Renderer] Stats:', stats);
        alert(`Utility Stats:\nUptime: ${stats.uptime}ms\nProcessed: ${stats.processed}`);
      } catch (error) {
        console.error('[Renderer] Stats error:', error);
        alert(`Error: ${error}`);
      }
    });
  }
});
