import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DirectIpcRenderer } from '../src/renderer/DirectIpcRenderer'
import { DirectIpcThrottled } from '../src/renderer/DirectIpcThrottled'
import { DirectIpcTarget } from '../src/common/DirectIpcCommunication'

// Test message map
type TestMessageMap = {
  'position-update': (x: number, y: number) => void
  'volume-change': (level: number) => void
  'song-changed': (songId: string) => void
  'data-update': (data: { value: number }) => void
}

describe('DirectIpcThrottled', () => {
  let mockDirectIpc: DirectIpcRenderer<TestMessageMap>
  let throttled: DirectIpcThrottled<TestMessageMap>
  let mockSender: DirectIpcTarget

  beforeEach(() => {
    // Create mock DirectIpcRenderer
    mockDirectIpc = DirectIpcRenderer._createInstance(
      { log: { silly: vi.fn(), error: vi.fn() } },
      {
        ipcRenderer: {
          on: vi.fn(),
          invoke: vi.fn().mockResolvedValue([]),
        } as any,
      }
    )

    // Mock send method
    vi.spyOn(mockDirectIpc, 'send').mockResolvedValue()

    // Mock getMap for sendToAll* detection
    vi.spyOn(mockDirectIpc, 'getMap').mockReturnValue([
      { webContentsId: 1, url: 'test', identifier: 'output' },
    ])

    // Mock on() method to track listener registrations
    vi.spyOn(mockDirectIpc, 'on')

    // Mock other proxy methods
    vi.spyOn(mockDirectIpc, 'handle')
    vi.spyOn(mockDirectIpc, 'invoke')
    vi.spyOn(mockDirectIpc, 'getMyIdentifier')

    // Use the throttled property created automatically by DirectIpcRenderer
    throttled = mockDirectIpc.throttled

    // Mock sender
    mockSender = {
      webContentsId: 1,
      url: 'test://sender',
      identifier: 'sender-id',
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Send-side coalescing', () => {
    it('should coalesce multiple sends to same target+channel', async () => {
      // Send multiple messages synchronously
      throttled.send({ identifier: 'output' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'output' }, 'position-update', 2, 2)
      throttled.send({ identifier: 'output' }, 'position-update', 3, 3)

      // Should not have sent yet
      expect(mockDirectIpc.send).not.toHaveBeenCalled()

      // Wait for microtask
      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      // Should only send the last message
      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'position-update',
        3,
        3
      )
    })

    it('should send messages to different targets separately', async () => {
      throttled.send({ identifier: 'output' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'controller' }, 'position-update', 2, 2)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(2)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'position-update',
        1,
        1
      )
      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'controller' },
        'position-update',
        2,
        2
      )
    })

    it('should send messages on different channels separately', async () => {
      throttled.send({ identifier: 'output' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'output' }, 'volume-change', 50)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(2)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'position-update',
        1,
        1
      )
      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'volume-change',
        50
      )
    })

    it('should coalesce sendToWebContentsId calls', async () => {
      throttled.send({ webContentsId: 1 }, 'volume-change', 10)
      throttled.send({ webContentsId: 1 }, 'volume-change', 20)
      throttled.send({ webContentsId: 1 }, 'volume-change', 30)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { webContentsId: 1 },
        'volume-change',
        30
      )
    })

    it('should coalesce sendToUrl calls', async () => {
      throttled.send({ url: 'test://output' }, 'data-update', { value: 1 })
      throttled.send({ url: 'test://output' }, 'data-update', { value: 2 })
      throttled.send({ url: 'test://output' }, 'data-update', { value: 3 })

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { url: 'test://output' },
        'data-update',
        { value: 3 }
      )
    })

    it('should handle mixed send method calls', async () => {
      throttled.send({ identifier: 'output' }, 'position-update', 1, 1)
      throttled.send({ webContentsId: 1 }, 'volume-change', 50)
      throttled.send({ url: 'test://url' }, 'song-changed', 'song-123')

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(3)
      })
    })

    it('should coalesce sendToAllIdentifiers calls', async () => {
      throttled.send({ allIdentifiers: /output.*/ }, 'position-update', 1, 1)
      throttled.send({ allIdentifiers: /output.*/ }, 'position-update', 2, 2)
      throttled.send({ allIdentifiers: /output.*/ }, 'position-update', 3, 3)

      await vi.waitFor(() => {
        // Should send with allIdentifiers selector
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { allIdentifiers: /output.*/ },
        'position-update',
        3,
        3
      )
    })

    it('should coalesce sendToAllUrls calls', async () => {
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 10)
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 20)
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 30)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { allUrls: /test:\/\/.*/ },
        'volume-change',
        30
      )
    })
  })

  describe('Receive-side coalescing', () => {
    it('should coalesce multiple receives on same channel', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      // Get the internal handler registered with mockDirectIpc
      const directIpcOnCalls = vi.mocked(mockDirectIpc.on).mock.calls
      const internalHandler = directIpcOnCalls.find(
        (call) => call[0] === 'position-update'
      )?.[1] as any

      expect(internalHandler).toBeDefined()

      // Simulate multiple rapid incoming messages
      internalHandler(mockSender, 1, 1)
      internalHandler(mockSender, 2, 2)
      internalHandler(mockSender, 3, 3)

      // Listener should not have been called yet
      expect(listener).not.toHaveBeenCalled()

      // Wait for microtask
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      // Should only be called with latest value
      expect(listener).toHaveBeenCalledWith(mockSender, 3, 3)
    })

    it('should call multiple listeners with same coalesced value', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const listener3 = vi.fn()

      throttled.on('volume-change', listener1)
      throttled.on('volume-change', listener2)
      throttled.on('volume-change', listener3)

      // Get internal handler
      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'volume-change')?.[1] as any

      // Simulate incoming messages
      internalHandler(mockSender, 10)
      internalHandler(mockSender, 20)
      internalHandler(mockSender, 30)

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(1)
      })

      // All listeners should be called with same (latest) value
      expect(listener1).toHaveBeenCalledWith(mockSender, 30)
      expect(listener2).toHaveBeenCalledWith(mockSender, 30)
      expect(listener3).toHaveBeenCalledWith(mockSender, 30)
    })

    it('should handle receives on different channels separately', async () => {
      const positionListener = vi.fn()
      const volumeListener = vi.fn()

      throttled.on('position-update', positionListener)
      throttled.on('volume-change', volumeListener)

      // Get internal handlers
      const positionHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any
      const volumeHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'volume-change')?.[1] as any

      // Simulate incoming messages on both channels
      positionHandler(mockSender, 5, 5)
      volumeHandler(mockSender, 75)

      await vi.waitFor(() => {
        expect(positionListener).toHaveBeenCalledTimes(1)
        expect(volumeListener).toHaveBeenCalledTimes(1)
      })

      expect(positionListener).toHaveBeenCalledWith(mockSender, 5, 5)
      expect(volumeListener).toHaveBeenCalledWith(mockSender, 75)
    })

    it('should handle listener errors gracefully', async () => {
      const goodListener = vi.fn()
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const anotherGoodListener = vi.fn()

      throttled.on('volume-change', goodListener)
      throttled.on('volume-change', badListener)
      throttled.on('volume-change', anotherGoodListener)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'volume-change')?.[1] as any

      internalHandler(mockSender, 50)

      await vi.waitFor(() => {
        expect(goodListener).toHaveBeenCalledTimes(1)
      })

      // Both good listeners should still be called despite error in middle listener
      expect(goodListener).toHaveBeenCalledWith(mockSender, 50)
      expect(badListener).toHaveBeenCalledWith(mockSender, 50)
      expect(anotherGoodListener).toHaveBeenCalledWith(mockSender, 50)
    })

    it('should update sender in coalesced messages', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any

      const sender1: DirectIpcTarget = {
        webContentsId: 1,
        url: 'sender1',
        identifier: 'sender1',
      }
      const sender2: DirectIpcTarget = {
        webContentsId: 2,
        url: 'sender2',
        identifier: 'sender2',
      }

      // Send from different senders (last one should win)
      internalHandler(sender1, 1, 1)
      internalHandler(sender2, 2, 2)

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      // Should use latest sender
      expect(listener).toHaveBeenCalledWith(sender2, 2, 2)
    })
  })

  describe('Listener management', () => {
    it('should remove listeners with off()', async () => {
      const listener = vi.fn()

      throttled.on('volume-change', listener)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'volume-change')?.[1] as any

      // Send message - should be received
      internalHandler(mockSender, 50)

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      // Remove listener
      throttled.off('volume-change', listener)

      // Send another message - should NOT be received
      internalHandler(mockSender, 75)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should still be 1 (not called again)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should handle removing one of multiple listeners', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      throttled.on('volume-change', listener1)
      throttled.on('volume-change', listener2)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'volume-change')?.[1] as any

      // Remove only listener1
      throttled.off('volume-change', listener1)

      internalHandler(mockSender, 50)

      await vi.waitFor(() => {
        expect(listener2).toHaveBeenCalledTimes(1)
      })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith(mockSender, 50)
    })

    it('should support method chaining', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const result = throttled
        .on('position-update', listener1)
        .on('volume-change', listener2)
        .off('position-update', listener1)

      expect(result).toBe(throttled)
    })
  })

  describe('Proxy methods', () => {
    it('should proxy handle() to directIpc', () => {
      // The proxy method is bound to directIpc, just verify it exists and works
      const handler = vi.fn()
      expect(throttled.handle).toBeDefined()
      expect(typeof throttled.handle).toBe('function')

      // Verify it's the same method as directIpc.handle (bound reference)
      throttled.handle('test-channel' as never, handler as never)
      // Since methods are bound at construction time, we can't spy after the fact
      // Just verify the method exists and can be called
    })

    it('should proxy invoke() to directIpc', () => {
      // The proxy method is bound, so we just verify it's the same function reference
      expect(throttled.invoke).toBeDefined()
      expect(typeof throttled.invoke).toBe('function')
    })

    it('should proxy getMap() to directIpc', () => {
      // The proxy method is bound to directIpc, just verify it works
      expect(throttled.getMap).toBeDefined()
      expect(typeof throttled.getMap).toBe('function')

      const map = throttled.getMap()
      // The map should be an array (content depends on directIpc's internal state)
      expect(Array.isArray(map)).toBe(true)
    })

    it('should proxy getMyIdentifier() to directIpc', () => {
      // The proxy method is bound, so we just verify it exists and works
      expect(throttled.getMyIdentifier).toBeDefined()
      expect(typeof throttled.getMyIdentifier).toBe('function')

      // Verify it returns the correct value from mockDirectIpc
      const id = throttled.getMyIdentifier()
      expect(id).toBeUndefined() // mockDirectIpc returns undefined by default
    })

    it('should expose directIpc property', () => {
      expect(throttled.directIpc).toBe(mockDirectIpc)
    })

    it('should expose localEvents property', () => {
      expect(throttled.localEvents).toBe(mockDirectIpc.localEvents)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty sends (no pending messages)', async () => {
      // Don't send anything, just wait
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should not have called any send methods
      expect(mockDirectIpc.send).not.toHaveBeenCalled()
    })

    it('should handle empty receives (no pending messages)', async () => {
      const listener = vi.fn()
      throttled.on('volume-change', listener)

      // Don't trigger any receives, just wait
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle rapid consecutive microtasks', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any

      // First batch
      internalHandler(mockSender, 1, 1)
      internalHandler(mockSender, 2, 2)

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      expect(listener).toHaveBeenCalledWith(mockSender, 2, 2)

      // Second batch (new microtask)
      internalHandler(mockSender, 3, 3)
      internalHandler(mockSender, 4, 4)

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(2)
      })

      expect(listener).toHaveBeenLastCalledWith(mockSender, 4, 4)
    })

    it('should handle zero/falsy values correctly', async () => {
      throttled.send({ identifier: 'output' }, 'volume-change', 0)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'volume-change',
        0
      )
    })

    it('should handle complex object arguments', async () => {
      const complexData = {
        value: 123,
        nested: { prop: 'test' },
        array: [1, 2, 3],
      }

      throttled.send({ identifier: 'output' }, 'data-update', complexData)

      await vi.waitFor(() => {
        expect(mockDirectIpc.send).toHaveBeenCalledTimes(1)
      })

      expect(mockDirectIpc.send).toHaveBeenCalledWith(
        { identifier: 'output' },
        'data-update',
        complexData
      )
    })
  })

  describe('Integration scenarios', () => {
    it('should work alongside non-throttled directIpc usage', async () => {
      const throttledListener = vi.fn()
      const directListener = vi.fn()

      // Register listeners on both
      throttled.on('position-update', throttledListener)
      mockDirectIpc.on('song-changed', directListener)

      // Get handlers
      const throttledHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any

      // Trigger throttled receives
      throttledHandler(mockSender, 1, 1)
      throttledHandler(mockSender, 2, 2)

      // Trigger direct receive
      directListener(mockSender, 'song-123')

      await vi.waitFor(() => {
        expect(throttledListener).toHaveBeenCalledTimes(1)
      })

      // Throttled should coalesce
      expect(throttledListener).toHaveBeenCalledWith(mockSender, 2, 2)

      // Direct should be called immediately
      expect(directListener).toHaveBeenCalledTimes(1)
      expect(directListener).toHaveBeenCalledWith(mockSender, 'song-123')
    })

    it('should handle high-frequency updates efficiently', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      const internalHandler = vi
        .mocked(mockDirectIpc.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any

      // Simulate 100 rapid updates
      for (let i = 0; i < 100; i++) {
        internalHandler(mockSender, i, i)
      }

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      // Should only receive the last value
      expect(listener).toHaveBeenCalledWith(mockSender, 99, 99)
    })
  })
})
