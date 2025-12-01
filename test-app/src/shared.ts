export type TestDirectIpcMap = {
  'send-message': (msg: string) => void
  'send-object': (obj: object) => void
  'send-number': (num: number) => void
  'send-boolean': (flag: boolean) => void
  'send-multiple-args': (a: string, b: number, c: boolean) => void
  'throttled-counter': (count: number) => void
}

export type TestDirectIpcInvokeMap = {
  'invoke-echo': (msg: string) => string
  'invoke-sum': (a: number, b: number) => number
  'invoke-sum-array': (arr: number[]) => number
  'throttled-invoke-counter': (count: number) => number
}

export type WindowName = `window:${string}`;