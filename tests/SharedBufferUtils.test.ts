import { describe, it, expect } from 'vitest'
import {
  isSharedArrayBufferAvailable,
  isSharedArrayBuffer,
  isTransferable,
  createSharedBuffer,
  createSharedTypedArray,
  createSharedBufferFrom,
  createViewOfSharedBuffer,
  copyToSharedBuffer,
  extractTransferables,
  SharedAtomics,
} from '../src/common/SharedBufferUtils'

describe('SharedBufferUtils', () => {
  describe('isSharedArrayBufferAvailable', () => {
    it('should return true if SharedArrayBuffer is available', () => {
      // SharedArrayBuffer is available in Node.js test environment
      expect(isSharedArrayBufferAvailable()).toBe(true)
    })
  })

  describe('isSharedArrayBuffer', () => {
    it('should return true for SharedArrayBuffer instances', () => {
      const sab = new SharedArrayBuffer(16)
      expect(isSharedArrayBuffer(sab)).toBe(true)
    })

    it('should return false for regular ArrayBuffer', () => {
      const ab = new ArrayBuffer(16)
      expect(isSharedArrayBuffer(ab)).toBe(false)
    })

    it('should return false for other types', () => {
      expect(isSharedArrayBuffer(null)).toBe(false)
      expect(isSharedArrayBuffer(undefined)).toBe(false)
      expect(isSharedArrayBuffer({})).toBe(false)
      expect(isSharedArrayBuffer([])).toBe(false)
      expect(isSharedArrayBuffer('string')).toBe(false)
      expect(isSharedArrayBuffer(123)).toBe(false)
    })
  })

  describe('isTransferable', () => {
    it('should return true for ArrayBuffer', () => {
      const ab = new ArrayBuffer(16)
      expect(isTransferable(ab)).toBe(true)
    })

    it('should return false for SharedArrayBuffer (they are shared, not transferred)', () => {
      const sab = new SharedArrayBuffer(16)
      expect(isTransferable(sab)).toBe(false)
    })

    it('should return false for non-transferable types', () => {
      expect(isTransferable(null)).toBe(false)
      expect(isTransferable({})).toBe(false)
      expect(isTransferable(new Uint8Array(16))).toBe(false) // TypedArray is not transferable, only its buffer
    })
  })

  describe('createSharedBuffer', () => {
    it('should create a SharedArrayBuffer of specified size', () => {
      const buffer = createSharedBuffer(1024)
      expect(buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(buffer.byteLength).toBe(1024)
    })

    it('should create an empty SharedArrayBuffer', () => {
      const buffer = createSharedBuffer(0)
      expect(buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(buffer.byteLength).toBe(0)
    })
  })

  describe('createSharedTypedArray', () => {
    it('should create Int32Array with SharedArrayBuffer backing', () => {
      const handle = createSharedTypedArray(Int32Array, 10)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Int32Array)
      expect(handle.view.length).toBe(10)
      expect(handle.byteLength).toBe(40) // 10 * 4 bytes
      expect(handle.viewType).toBe('Int32Array')
    })

    it('should create Float64Array with SharedArrayBuffer backing', () => {
      const handle = createSharedTypedArray(Float64Array, 5)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Float64Array)
      expect(handle.view.length).toBe(5)
      expect(handle.byteLength).toBe(40) // 5 * 8 bytes
      expect(handle.viewType).toBe('Float64Array')
    })

    it('should create Uint8Array with SharedArrayBuffer backing', () => {
      const handle = createSharedTypedArray(Uint8Array, 256)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Uint8Array)
      expect(handle.view.length).toBe(256)
      expect(handle.byteLength).toBe(256)
      expect(handle.viewType).toBe('Uint8Array')
    })
  })

  describe('createSharedBufferFrom', () => {
    it('should copy Int32Array data to SharedArrayBuffer', () => {
      const source = new Int32Array([1, 2, 3, 4, 5])
      const handle = createSharedBufferFrom(source)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Int32Array)
      expect(Array.from(handle.view)).toEqual([1, 2, 3, 4, 5])
    })

    it('should copy Float64Array data to SharedArrayBuffer', () => {
      const source = new Float64Array([1.5, 2.5, 3.5])
      const handle = createSharedBufferFrom(source)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Float64Array)
      expect(Array.from(handle.view)).toEqual([1.5, 2.5, 3.5])
    })

    it('should copy Uint8Array data to SharedArrayBuffer', () => {
      const source = new Uint8Array([255, 128, 64, 0])
      const handle = createSharedBufferFrom(source)

      expect(handle.buffer).toBeInstanceOf(SharedArrayBuffer)
      expect(handle.view).toBeInstanceOf(Uint8Array)
      expect(Array.from(handle.view)).toEqual([255, 128, 64, 0])
    })
  })

  describe('createViewOfSharedBuffer', () => {
    it('should create a view of existing SharedArrayBuffer', () => {
      const buffer = createSharedBuffer(16)
      const view = createViewOfSharedBuffer(buffer, Int32Array)

      expect(view).toBeInstanceOf(Int32Array)
      expect(view.buffer).toBe(buffer)
      expect(view.length).toBe(4) // 16 bytes / 4 bytes per int32
    })

    it('should create a view with byte offset', () => {
      const buffer = createSharedBuffer(16)
      const view = createViewOfSharedBuffer(buffer, Int32Array, 4)

      expect(view).toBeInstanceOf(Int32Array)
      expect(view.byteOffset).toBe(4)
      expect(view.length).toBe(3) // (16 - 4) / 4
    })

    it('should create a view with byte offset and length', () => {
      const buffer = createSharedBuffer(16)
      const view = createViewOfSharedBuffer(buffer, Int32Array, 4, 2)

      expect(view).toBeInstanceOf(Int32Array)
      expect(view.byteOffset).toBe(4)
      expect(view.length).toBe(2)
    })
  })

  describe('copyToSharedBuffer', () => {
    it('should copy ArrayBuffer to SharedArrayBuffer', () => {
      const source = new ArrayBuffer(16)
      const sourceView = new Uint8Array(source)
      sourceView.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

      const shared = copyToSharedBuffer(source)

      expect(shared).toBeInstanceOf(SharedArrayBuffer)
      expect(shared.byteLength).toBe(16)

      const sharedView = new Uint8Array(shared)
      expect(Array.from(sharedView)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    })

    it('should copy TypedArray view to SharedArrayBuffer', () => {
      const source = new Int32Array([100, 200, 300])
      const shared = copyToSharedBuffer(source)

      expect(shared).toBeInstanceOf(SharedArrayBuffer)
      expect(shared.byteLength).toBe(12) // 3 * 4 bytes

      const sharedView = new Int32Array(shared)
      expect(Array.from(sharedView)).toEqual([100, 200, 300])
    })

    it('should respect view boundaries (byteOffset and byteLength)', () => {
      // Create a buffer with more data than we'll use
      const fullBuffer = new ArrayBuffer(16)
      const fullView = new Uint8Array(fullBuffer)
      fullView.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

      // Create a view that only sees bytes 4-7 (4 bytes starting at offset 4)
      const partialView = new Uint8Array(fullBuffer, 4, 4)

      // Copy only the partial view
      const shared = copyToSharedBuffer(partialView)

      // Should only have 4 bytes, not 16
      expect(shared.byteLength).toBe(4)

      const sharedView = new Uint8Array(shared)
      expect(Array.from(sharedView)).toEqual([4, 5, 6, 7])
    })
  })

  describe('extractTransferables', () => {
    it('should extract ArrayBuffer from object', () => {
      const buffer = new ArrayBuffer(16)
      const message = { data: 'test', buffer }

      const transferables = extractTransferables(message)

      expect(transferables).toHaveLength(1)
      expect(transferables[0]).toBe(buffer)
    })

    it('should extract ArrayBuffer from TypedArray in message', () => {
      const array = new Uint8Array(16)
      const message = { data: array }

      const transferables = extractTransferables(message)

      expect(transferables).toHaveLength(1)
      expect(transferables[0]).toBe(array.buffer)
    })

    it('should not extract SharedArrayBuffer (they are shared, not transferred)', () => {
      const sab = new SharedArrayBuffer(16)
      const message = { sharedBuffer: sab }

      const transferables = extractTransferables(message)

      expect(transferables).toHaveLength(0)
    })

    it('should extract multiple ArrayBuffers', () => {
      const buffer1 = new ArrayBuffer(8)
      const buffer2 = new ArrayBuffer(16)
      const message = { buffer1, nested: { buffer2 } }

      const transferables = extractTransferables(message)

      expect(transferables).toHaveLength(2)
      expect(transferables).toContain(buffer1)
      expect(transferables).toContain(buffer2)
    })

    it('should deduplicate buffers when multiple views share the same underlying buffer', () => {
      // Create one buffer with multiple views
      const sharedBuffer = new ArrayBuffer(32)
      const view1 = new Uint8Array(sharedBuffer, 0, 16)
      const view2 = new Uint8Array(sharedBuffer, 16, 16)
      const view3 = new Int32Array(sharedBuffer, 0, 4)

      const message = { view1, view2, view3 }

      const transferables = extractTransferables(message)

      // Should only have 1 buffer (deduplicated), not 3
      expect(transferables).toHaveLength(1)
      expect(transferables[0]).toBe(sharedBuffer)
    })

    it('should handle arrays', () => {
      const buffer1 = new ArrayBuffer(8)
      const buffer2 = new ArrayBuffer(16)
      const message = [buffer1, buffer2]

      const transferables = extractTransferables(message)

      expect(transferables).toHaveLength(2)
    })

    it('should return empty array for primitive values', () => {
      expect(extractTransferables(null)).toHaveLength(0)
      expect(extractTransferables(undefined)).toHaveLength(0)
      expect(extractTransferables('string')).toHaveLength(0)
      expect(extractTransferables(123)).toHaveLength(0)
    })

    it('should handle circular references', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: any = { buffer: new ArrayBuffer(8) }
      obj.self = obj

      // Should not throw or infinite loop
      const transferables = extractTransferables(obj)
      expect(transferables).toHaveLength(1)
    })
  })

  describe('SharedAtomics', () => {
    it('should perform atomic add operation', () => {
      const handle = createSharedTypedArray(Int32Array, 4)
      handle.view[0] = 10

      const oldValue = SharedAtomics.add(handle.view, 0, 5)

      expect(oldValue).toBe(10)
      expect(handle.view[0]).toBe(15)
    })

    it('should perform atomic load operation', () => {
      const handle = createSharedTypedArray(Int32Array, 4)
      handle.view[0] = 42

      const value = SharedAtomics.load(handle.view, 0)

      expect(value).toBe(42)
    })

    it('should perform atomic store operation', () => {
      const handle = createSharedTypedArray(Int32Array, 4)

      SharedAtomics.store(handle.view, 0, 100)

      expect(handle.view[0]).toBe(100)
    })

    it('should perform atomic compareExchange operation', () => {
      const handle = createSharedTypedArray(Int32Array, 4)
      handle.view[0] = 10

      // Should exchange since expectedValue matches
      const oldValue1 = SharedAtomics.compareExchange(handle.view, 0, 10, 20)
      expect(oldValue1).toBe(10)
      expect(handle.view[0]).toBe(20)

      // Should not exchange since expectedValue doesn't match
      const oldValue2 = SharedAtomics.compareExchange(handle.view, 0, 10, 30)
      expect(oldValue2).toBe(20) // Returns current value
      expect(handle.view[0]).toBe(20) // Value unchanged
    })

    it('should work with BigInt64Array', () => {
      const handle = createSharedTypedArray(BigInt64Array, 4)
      handle.view[0] = 10n

      const oldValue = SharedAtomics.add(handle.view, 0, 5n)

      expect(oldValue).toBe(10n)
      expect(handle.view[0]).toBe(15n)
    })
  })

  describe('Integration scenarios', () => {
    it('should support a typical shared counter pattern', () => {
      // Create a shared counter
      const counterHandle = createSharedTypedArray(Int32Array, 1)
      counterHandle.view[0] = 0

      // Simulate multiple "processes" incrementing the counter
      // In real Electron, these would be different processes
      for (let i = 0; i < 100; i++) {
        SharedAtomics.add(counterHandle.view, 0, 1)
      }

      expect(counterHandle.view[0]).toBe(100)
    })

    it('should support shared data buffer with mixed types', () => {
      // Create a buffer for:
      // - 1 Int32 counter (4 bytes)
      // - 4 Float64 values (32 bytes)
      // Total: 36 bytes, but align to 8 = 40 bytes
      const buffer = createSharedBuffer(40)

      // Create views for different parts
      const counter = new Int32Array(buffer, 0, 1)
      const values = new Float64Array(buffer, 8, 4)

      // Set values
      counter[0] = 42
      values[0] = 1.5
      values[1] = 2.5
      values[2] = 3.5
      values[3] = 4.5

      // Verify values are accessible
      expect(counter[0]).toBe(42)
      expect(Array.from(values)).toEqual([1.5, 2.5, 3.5, 4.5])

      // Verify they share the same buffer
      expect(counter.buffer).toBe(buffer)
      expect(values.buffer).toBe(buffer)
    })
  })
})
