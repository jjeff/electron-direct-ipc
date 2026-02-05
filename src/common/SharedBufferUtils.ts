/**
 * SharedBufferUtils - Utilities for working with SharedArrayBuffer and transferable objects
 *
 * SharedArrayBuffer allows true shared memory between processes in Electron.
 * Unlike regular ArrayBuffer transfers (which move ownership), SharedArrayBuffer
 * allows multiple processes to read and write to the same memory region.
 *
 * IMPORTANT: SharedArrayBuffer requires specific security headers to be enabled:
 * - Cross-Origin-Opener-Policy: same-origin
 * - Cross-Origin-Embedder-Policy: require-corp
 *
 * In Electron, you typically set these in your main process when creating windows.
 */

/**
 * Options for creating a shared buffer
 */
export interface SharedBufferOptions {
  /** Size in bytes */
  byteLength: number
  /** Optional initial data to copy into the buffer */
  initialData?: ArrayBufferView | number[]
}

/**
 * Typed array constructors that can be used with SharedArrayBuffer
 */
export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor

/**
 * Union of all typed array types
 */
export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

/**
 * Wrapper for SharedArrayBuffer with metadata
 */
export interface SharedBufferHandle<T extends TypedArray = Uint8Array> {
  /** The underlying SharedArrayBuffer */
  buffer: SharedArrayBuffer
  /** A typed array view of the buffer */
  view: T
  /** Byte length of the buffer */
  byteLength: number
  /** Type of the view (e.g., 'Int32Array', 'Float64Array') */
  viewType: string
}

/**
 * Message containing SharedArrayBuffer data
 */
export interface SharedBufferMessage {
  /** The shared buffer */
  buffer: SharedArrayBuffer
  /** Byte offset in the buffer (for views) */
  byteOffset?: number
  /** Byte length of the data */
  byteLength?: number
  /** Type of typed array to use for the view */
  viewType?: string
}

/**
 * Check if SharedArrayBuffer is available in the current environment
 * @returns true if SharedArrayBuffer is available
 */
export function isSharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

/**
 * Check if an object is a SharedArrayBuffer
 * @param obj - Object to check
 * @returns true if obj is a SharedArrayBuffer
 */
export function isSharedArrayBuffer(obj: unknown): obj is SharedArrayBuffer {
  return obj instanceof SharedArrayBuffer
}

/**
 * Check if an object is a transferable (ArrayBuffer, MessagePort, etc.)
 * @param obj - Object to check
 * @returns true if obj is transferable
 */
export function isTransferable(obj: unknown): obj is Transferable {
  return (
    obj instanceof ArrayBuffer ||
    (typeof MessagePort !== 'undefined' && obj instanceof MessagePort) ||
    (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)
  )
}

/**
 * Create a SharedArrayBuffer with the specified size
 * @param byteLength - Size in bytes
 * @returns A new SharedArrayBuffer
 * @throws Error if SharedArrayBuffer is not available
 */
export function createSharedBuffer(byteLength: number): SharedArrayBuffer {
  if (!isSharedArrayBufferAvailable()) {
    throw new Error(
      'SharedArrayBuffer is not available. Ensure you have the correct security headers enabled.'
    )
  }
  return new SharedArrayBuffer(byteLength)
}

/**
 * Create a SharedArrayBuffer with a typed array view
 * @param TypedArrayClass - The typed array constructor to use
 * @param length - Number of elements (not bytes)
 * @returns SharedBufferHandle with buffer and typed view
 */
export function createSharedTypedArray<T extends TypedArray>(
  TypedArrayClass: new (buffer: SharedArrayBuffer) => T,
  length: number
): SharedBufferHandle<T> {
  const bytesPerElement = (TypedArrayClass as unknown as { BYTES_PER_ELEMENT: number })
    .BYTES_PER_ELEMENT
  const byteLength = length * bytesPerElement
  const buffer = createSharedBuffer(byteLength)
  const view = new TypedArrayClass(buffer)

  return {
    buffer,
    view,
    byteLength,
    viewType: TypedArrayClass.name,
  }
}

/**
 * Create a SharedArrayBuffer initialized with data from an existing array
 * @param data - Source data to copy
 * @returns SharedBufferHandle with the copied data
 */
export function createSharedBufferFrom<T extends TypedArray>(data: T): SharedBufferHandle<T> {
  const byteLength = data.byteLength
  const buffer = createSharedBuffer(byteLength)

  // Create a view of the same type and copy data
  const Constructor = data.constructor as new (buffer: SharedArrayBuffer) => T
  const view = new Constructor(buffer)

  // Copy elements
  for (let i = 0; i < data.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(view as any)[i] = (data as any)[i]
  }

  return {
    buffer,
    view,
    byteLength,
    viewType: Constructor.name,
  }
}

/**
 * Create a typed array view of a SharedArrayBuffer
 * @param buffer - The SharedArrayBuffer
 * @param TypedArrayClass - The typed array constructor to use
 * @param byteOffset - Optional byte offset
 * @param length - Optional number of elements
 * @returns A typed array view of the buffer
 */
export function createViewOfSharedBuffer<T extends TypedArray>(
  buffer: SharedArrayBuffer,
  TypedArrayClass: new (buffer: SharedArrayBuffer, byteOffset?: number, length?: number) => T,
  byteOffset?: number,
  length?: number
): T {
  return new TypedArrayClass(buffer, byteOffset, length)
}

/**
 * Copy data from a regular ArrayBuffer to a SharedArrayBuffer
 * @param source - Source ArrayBuffer or TypedArray
 * @returns A new SharedArrayBuffer with the copied data
 */
export function copyToSharedBuffer(source: ArrayBuffer | ArrayBufferView): SharedArrayBuffer {
  const sourceBytes =
    source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer)

  const sharedBuffer = createSharedBuffer(sourceBytes.byteLength)
  const destBytes = new Uint8Array(sharedBuffer)

  destBytes.set(sourceBytes)

  return sharedBuffer
}

/**
 * Extract transferable objects from a message for use with postMessage transfer list
 * This recursively finds ArrayBuffer instances in the message
 * @param message - The message to scan
 * @returns Array of transferable objects found
 */
export function extractTransferables(message: unknown): Transferable[] {
  const transferables: Transferable[] = []
  const visited = new WeakSet()

  function scan(obj: unknown): void {
    if (obj === null || obj === undefined) return
    if (typeof obj !== 'object') return

    // Prevent circular reference issues
    if (visited.has(obj as object)) return
    visited.add(obj as object)

    // Check if this is a transferable
    if (isTransferable(obj)) {
      transferables.push(obj)
      return
    }

    // Don't scan SharedArrayBuffer (they're shared, not transferred)
    if (isSharedArrayBuffer(obj)) return

    // Scan typed arrays for their underlying buffer
    if (ArrayBuffer.isView(obj)) {
      const view = obj as ArrayBufferView
      if (view.buffer instanceof ArrayBuffer) {
        transferables.push(view.buffer)
      }
      return
    }

    // Recursively scan arrays
    if (Array.isArray(obj)) {
      for (const item of obj as unknown[]) {
        scan(item)
      }
      return
    }

    // Recursively scan object properties
    for (const key of Object.keys(obj as object)) {
      scan((obj as Record<string, unknown>)[key])
    }
  }

  scan(message)
  return transferables
}

/**
 * Atomics helper - Use Atomics for thread-safe operations on shared memory
 *
 * Note: Atomics operations only work with Int8Array, Uint8Array, Int16Array,
 * Uint16Array, Int32Array, Uint32Array, BigInt64Array, and BigUint64Array
 * backed by SharedArrayBuffer.
 */
export const SharedAtomics = {
  /**
   * Atomically add a value and return the old value
   */
  add<T extends Int32Array | Uint32Array | BigInt64Array | BigUint64Array>(
    typedArray: T,
    index: number,
    value: T extends BigInt64Array | BigUint64Array ? bigint : number
  ): T extends BigInt64Array | BigUint64Array ? bigint : number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Atomics.add(typedArray as any, index, value as any) as any
  },

  /**
   * Atomically compare and exchange
   */
  compareExchange<T extends Int32Array | Uint32Array | BigInt64Array | BigUint64Array>(
    typedArray: T,
    index: number,
    expectedValue: T extends BigInt64Array | BigUint64Array ? bigint : number,
    replacementValue: T extends BigInt64Array | BigUint64Array ? bigint : number
  ): T extends BigInt64Array | BigUint64Array ? bigint : number {
    return Atomics.compareExchange(
      typedArray as any,
      index,
      expectedValue as any,
      replacementValue as any
    ) as any
  },

  /**
   * Atomically load a value
   */
  load<T extends Int32Array | Uint32Array | BigInt64Array | BigUint64Array>(
    typedArray: T,
    index: number
  ): T extends BigInt64Array | BigUint64Array ? bigint : number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Atomics.load(typedArray as any, index) as any
  },

  /**
   * Atomically store a value
   */
  store<T extends Int32Array | Uint32Array | BigInt64Array | BigUint64Array>(
    typedArray: T,
    index: number,
    value: T extends BigInt64Array | BigUint64Array ? bigint : number
  ): T extends BigInt64Array | BigUint64Array ? bigint : number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Atomics.store(typedArray as any, index, value as any) as any
  },

  /**
   * Wait for a value to change (blocking)
   * Only works in workers/utility processes, not main thread
   */
  wait(
    typedArray: Int32Array | BigInt64Array,
    index: number,
    value: number | bigint,
    timeout?: number
  ): 'ok' | 'not-equal' | 'timed-out' {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Atomics.wait(typedArray as any, index, value as any, timeout)
  },

  /**
   * Wake up waiting threads
   */
  notify(typedArray: Int32Array | BigInt64Array, index: number, count?: number): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Atomics.notify(typedArray as any, index, count)
  },
}
