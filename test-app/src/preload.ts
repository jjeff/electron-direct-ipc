// Preload script for Electron test app

import { contextBridge } from 'electron'
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer';
import type { TestDirectIpcInvokeMap, TestDirectIpcMap, WindowName } from './shared';

const windowId = process.argv.find(arg => arg.startsWith('--win-id='))?.split('=')[1] || 'unknown';
console.log(`Preload script loaded for window ID: ${windowId}`);
const directIpc = DirectIpcRenderer.instance<TestDirectIpcMap, TestDirectIpcInvokeMap, WindowName>({ identifier: `window:${windowId}` });
// if windowId is 1, use 2, and vice versa
const otherWindowId = windowId === '1' ? '2' : '1';

// Track received throttled progress messages for E2E testing
// This array is kept in preload context and exposed via contextBridge
const throttledProgressReceived: number[] = [];

/** ---- API for contextBridge ---- */

contextBridge.exposeInMainWorld('directIpc', {
  getMap: () => directIpc.getMap(),
  sendMessage: (msg: string) => directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-message', msg),
  sendObject: (obj: object) => directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-object', obj),
  sendNumber: (num: number) => directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-number', num),
  sendBoolean: (flag: boolean) => directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-boolean', flag),
  sendMultipleArgs: (a: string, b: number, c: boolean) => directIpc.send({ identifier: `window:${otherWindowId}` }, 'send-multiple-args', a, b, c),
  invokeEcho: (msg: string): Promise<string> => directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-echo', msg),
  invokeSum: (a: number, b: number): Promise<number> => directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-sum', a, b),
  invokeSumArray: (arr: number[]): Promise<number> => directIpc.invoke({ identifier: `window:${otherWindowId}` }, 'invoke-sum-array', arr),

  // Utility process methods
  util: {
    sendCompute: (num: number) => directIpc.send({ identifier: 'compute-worker' }, 'compute-request', num),
    sendPing: () => directIpc.send({ identifier: 'compute-worker' }, 'ping'),
    invokeComputation: (numbers: number[]): Promise<number> => directIpc.invoke({ identifier: 'compute-worker' }, 'heavy-computation', numbers),
    invokeStats: (): Promise<{ uptime: number; processed: number }> => directIpc.invoke({ identifier: 'compute-worker' }, 'get-stats'),
    invokeSlowOperation: (delay: number, timeout?: number): Promise<string> =>
      timeout
        ? directIpc.invoke({ identifier: 'compute-worker' }, 'slow-operation', delay, { timeout })
        : directIpc.invoke({ identifier: 'compute-worker' }, 'slow-operation', delay),
    // Throttled utility methods
    sendThrottledPosition: (x: number, y: number) => directIpc.throttled.send({ identifier: 'compute-worker' }, 'throttled-position', x, y),
    invokeThrottledStats: (): Promise<{ lastPosition: { x: number; y: number }; receiveCount: number }> =>
      directIpc.invoke({ identifier: 'compute-worker' }, 'get-throttled-stats'),
    resetThrottledStats: (): Promise<boolean> => directIpc.invoke({ identifier: 'compute-worker' }, 'reset-throttled-stats'),
    requestThrottledProgress: (count: number): Promise<number> => directIpc.invoke({ identifier: 'compute-worker' }, 'send-throttled-progress', count),
    // E2E testing - trigger status broadcast on demand (avoids 5s wait for periodic update)
    broadcastStatus: (): Promise<boolean> => directIpc.invoke({ identifier: 'compute-worker' }, 'broadcast-status'),
  },

  // Throttled methods
  throttled: {
    sendCounter: (count: number) => directIpc.throttled.send({ identifier: `window:${otherWindowId}` }, 'throttled-counter', count),
    invokeCounter: (count: number): Promise<number> => directIpc.throttled.invoke({ identifier: `window:${otherWindowId}` }, 'throttled-invoke-counter', count),
  },

  // E2E testing helpers for throttled progress tracking
  // These expose the preload-side array to the page context
  testing: {
    getThrottledProgressReceived: (): number[] => throttledProgressReceived,
    resetThrottledProgressReceived: () => { throttledProgressReceived.length = 0; },
  }
});

contextBridge.exposeInMainWorld('windowId', windowId);

/** ---- Listeners ---- */

// Central function to log messages to the messages div
function logMessage(text: string) {
  const messages = document.getElementById('messages');
  if (messages) {
    const p = document.createElement('p');
    p.innerText = text;
    messages.appendChild(p);
  }
}

function handleDomLoaded() {
  const head = document.getElementById('page-head');
  if (head) {
    head.innerText = `Window ${windowId}`;
  }
  const messages = document.getElementById('messages');
  const clearButton = document.getElementById('clear-messages');
  if (clearButton && messages) {
    clearButton.addEventListener('click', () => {
      messages.innerHTML = '';
    });
  }

  // Set up message listeners (events)
  directIpc.on('send-message', (sender, msg) => {
    logMessage(`[Event] send-message from ${sender.identifier}: ${msg}`);
  });

  directIpc.on('send-object', (sender, obj) => {
    logMessage(`[Event] send-object from ${sender.identifier}: ${JSON.stringify(obj)}`);
  });

  directIpc.on('send-number', (sender, num) => {
    logMessage(`[Event] send-number from ${sender.identifier}: ${num}`);
  });

  directIpc.on('send-boolean', (sender, flag) => {
    logMessage(`[Event] send-boolean from ${sender.identifier}: ${flag}`);
  });

  directIpc.on('send-multiple-args', (sender, a, b, c) => {
    logMessage(`[Event] send-multiple-args from ${sender.identifier}: a="${a}", b=${b}, c=${c}`);
  });

  // Set up invoke handlers (request-response)
  directIpc.handle('invoke-echo', (sender, msg) => {
    logMessage(`[Invoke] invoke-echo from ${sender.identifier}: "${msg}" -> returning "${msg}"`);
    return msg;
  });

  directIpc.handle('invoke-sum', (sender, a, b) => {
    const result = a + b;
    logMessage(`[Invoke] invoke-sum from ${sender.identifier}: ${a} + ${b} = ${result}`);
    return result;
  });

  directIpc.handle('invoke-sum-array', (sender, arr) => {
    const result = arr.reduce((sum, val) => sum + val, 0);
    logMessage(`[Invoke] invoke-sum-array from ${sender.identifier}: [${arr.join(', ')}] = ${result}`);
    return result;
  });

  // Throttled event listener
  directIpc.throttled.on('throttled-counter', (sender, count) => {
    logMessage(`[Throttled Event] throttled-counter from ${sender.identifier}: ${count}`);
  });

  // Throttled invoke handler
  directIpc.throttled.handle('throttled-invoke-counter', (sender, count) => {
    logMessage(`[Throttled Invoke] throttled-invoke-counter from ${sender.identifier}: ${count} -> returning ${count}`);
    return count;
  });

  // Utility process message listeners
  directIpc.on('status-update', (sender, status, timestamp) => {
    logMessage(`[Utility] status-update from ${sender.identifier}: ${status} at ${new Date(timestamp).toLocaleTimeString()}`);
  });

  directIpc.on('compute-request', (sender, result) => {
    logMessage(`[Utility] compute-result from ${sender.identifier}: ${result}`);
  });

  // Throttled progress listener (from utility process)
  // Uses the module-scoped throttledProgressReceived array exposed via contextBridge
  directIpc.throttled.on('throttled-progress', (sender, percent) => {
    throttledProgressReceived.push(percent);
    console.log(`[Preload] Pushed ${percent} to throttledProgressReceived, now has ${throttledProgressReceived.length} items`);
    logMessage(`[Utility Throttled] throttled-progress from ${sender.identifier}: ${percent}%`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  handleDomLoaded();
});