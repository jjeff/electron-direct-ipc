export type TestDirectIpcMap = {
  'send-message': (msg: string) => void
  'send-object': (obj: object) => void
  'send-number': (num: number) => void
  'send-boolean': (flag: boolean) => void
  'send-multiple-args': (a: string, b: number, c: boolean) => void
  'throttled-counter': (count: number) => void
  // Utility process messages
  'compute-request': (data: number) => void
  'ping': () => void
  'status-update': (status: string, timestamp: number) => void
}

export type TestDirectIpcInvokeMap = {
  'invoke-echo': (msg: string) => string
  'invoke-sum': (a: number, b: number) => number
  'invoke-sum-array': (arr: number[]) => number
  'throttled-invoke-counter': (count: number) => number
  // Utility process invokes
  'heavy-computation': (numbers: number[]) => Promise<number>
  'get-stats': () => Promise<{ uptime: number; processed: number }>
  'slow-operation': (delay: number) => Promise<string>
}

export type WindowName = `window:${string}` | 'compute-worker';