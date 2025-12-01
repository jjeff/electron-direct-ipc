// Preload script for Electron test app

import { contextBridge } from 'electron'
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer';
import type { TestDirectIpcInvokeMap, TestDirectIpcMap, WindowName } from './shared';

const windowId = process.argv.find(arg => arg.startsWith('--win-id='))?.split('=')[1] || 'unknown';
console.log(`Preload script loaded for window ID: ${windowId}`);
const directIpc = DirectIpcRenderer.instance<TestDirectIpcMap, TestDirectIpcInvokeMap, WindowName>({ identifier: `window:${windowId}` });
const throttled = directIpc.throttled;
// if windowId is 1, use 2, and vice versa
const otherWindowId = windowId === '1' ? '2' : '1';

/** ---- API for contextBridge ---- */

contextBridge.exposeInMainWorld('directIpc', {
  sendMessage: (msg: string) => directIpc.sendToIdentifier(`window:${otherWindowId}`, 'send-message', msg),
  sendObject: (obj: object) => directIpc.sendToIdentifier(`window:${otherWindowId}`, 'send-object', obj),
  sendNumber: (num: number) => directIpc.sendToIdentifier(`window:${otherWindowId}`, 'send-number', num),
  sendBoolean: (flag: boolean) => directIpc.sendToIdentifier(`window:${otherWindowId}`, 'send-boolean', flag),
  sendMultipleArgs: (a: string, b: number, c: boolean) => directIpc.sendToIdentifier(`window:${otherWindowId}`, 'send-multiple-args', a, b, c),
  invokeEcho: (msg: string): Promise<string> => directIpc.invokeIdentifier(`window:${otherWindowId}`, 'invoke-echo', msg),
  invokeSum: (a: number, b: number): Promise<number> => directIpc.invokeIdentifier(`window:${otherWindowId}`, 'invoke-sum', a, b),
  invokeSumArray: (arr: number[]): Promise<number> => directIpc.invokeIdentifier(`window:${otherWindowId}`, 'invoke-sum-array', arr),

  // Throttled methods
  throttled: {
    sendCounter: (count: number) => throttled.sendToIdentifier(`window:${otherWindowId}`, 'throttled-counter', count),
    invokeCounter: (count: number): Promise<number> => throttled.invokeIdentifier(`window:${otherWindowId}`, 'throttled-invoke-counter', count),
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
  throttled.on('throttled-counter', (sender: any, count: number) => {
    logMessage(`[Throttled Event] throttled-counter from ${sender.identifier}: ${count}`);
  });

  // Throttled invoke handler
  throttled.handle('throttled-invoke-counter', (sender: any, count: number) => {
    logMessage(`[Throttled Invoke] throttled-invoke-counter from ${sender.identifier}: ${count} -> returning ${count}`);
    return count;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  handleDomLoaded();
});