import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { DirectIpcUtility, RegistrationState } from '../src/utility/DirectIpcUtility'
import { DirectIpcUtilityThrottled } from '../src/utility/DirectIpcUtilityThrottled'
import {
  DirectIpcTarget,
  ProcessType,
  DIRECT_IPC_CHANNELS,
} from '../src/common/DirectIpcCommunication'

// Test message map
type TestMessageMap = {
  'position-update': (x: number, y: number) => void
  'volume-change': (level: number) => void
  'song-changed': (songId: string) => void
  'data-update': (data: { value: number }) => void
}

// Mock process.parentPort
const createMockParentPort = () => {
  const mockPort = new EventEmitter()
  const postMessage = vi.fn()
  return Object.assign(mockPort, { postMessage })
}

describe('DirectIpcUtilityThrottled', () => {
  let mockParentPort: ReturnType<typeof createMockParentPort>
  let utility: DirectIpcUtility<TestMessageMap>
  let throttled: DirectIpcUtilityThrottled<TestMessageMap>
  let mockSender: DirectIpcTarget

  beforeEach(() => {
    // Reset singleton
    ;(DirectIpcUtility as any)._instance = null

    // Mock process type check to return true (simulate utility process)
    vi.spyOn(DirectIpcUtility as any, 'isUtilityProcess').mockReturnValue(true)

    // Create and set mock parent port
    mockParentPort = createMockParentPort()
    process.parentPort = mockParentPort as any

    // Create utility instance
    utility = DirectIpcUtility.instance<TestMessageMap>({
      identifier: 'test-worker',
      log: { silly: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })

    // Mock send method
    vi.spyOn(utility, 'send').mockResolvedValue()

    // Mock getMap for sendToAll* detection
    vi.spyOn(utility, 'getMap').mockReturnValue([
      {
        id: 1,
        webContentsId: 1,
        url: 'test',
        identifier: 'renderer',
        processType: ProcessType.RENDERER,
      },
    ])

    // Mock on() method to track listener registrations
    vi.spyOn(utility, 'on')

    // Mock other proxy methods
    vi.spyOn(utility, 'handle')
    vi.spyOn(utility, 'invoke')
    vi.spyOn(utility, 'getMyIdentifier')

    // Get the throttled property created automatically by DirectIpcUtility
    throttled = utility.throttled

    // Mock sender
    mockSender = {
      id: 1,
      webContentsId: 1,
      url: 'test://sender',
      identifier: 'sender-id',
      processType: ProcessType.RENDERER,
    }

    // Complete registration so tests don't need to worry about it
    mockParentPort.emit('message', {
      data: {
        channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
        map: [
          { id: 1, processType: ProcessType.RENDERER, identifier: 'renderer', webContentsId: 1 },
        ],
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (process as any).parentPort
  })

  describe('Send-side coalescing', () => {
    it('should coalesce multiple sends to same target+channel', async () => {
      // Send multiple messages synchronously
      throttled.send({ identifier: 'renderer' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'renderer' }, 'position-update', 2, 2)
      throttled.send({ identifier: 'renderer' }, 'position-update', 3, 3)

      // Should not have sent yet
      expect(utility.send).not.toHaveBeenCalled()

      // Wait for microtask
      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      // Should only send the last message
      expect(utility.send).toHaveBeenCalledWith({ identifier: 'renderer' }, 'position-update', 3, 3)
    })

    it('should send messages to different targets separately', async () => {
      throttled.send({ identifier: 'renderer' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'controller' }, 'position-update', 2, 2)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(2)
      })

      expect(utility.send).toHaveBeenCalledWith({ identifier: 'renderer' }, 'position-update', 1, 1)
      expect(utility.send).toHaveBeenCalledWith(
        { identifier: 'controller' },
        'position-update',
        2,
        2
      )
    })

    it('should send messages on different channels separately', async () => {
      throttled.send({ identifier: 'renderer' }, 'position-update', 1, 1)
      throttled.send({ identifier: 'renderer' }, 'volume-change', 50)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(2)
      })

      expect(utility.send).toHaveBeenCalledWith({ identifier: 'renderer' }, 'position-update', 1, 1)
      expect(utility.send).toHaveBeenCalledWith({ identifier: 'renderer' }, 'volume-change', 50)
    })

    it('should coalesce send calls with webContentsId', async () => {
      throttled.send({ webContentsId: 1 }, 'volume-change', 10)
      throttled.send({ webContentsId: 1 }, 'volume-change', 20)
      throttled.send({ webContentsId: 1 }, 'volume-change', 30)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith({ webContentsId: 1 }, 'volume-change', 30)
    })

    it('should coalesce send calls with url', async () => {
      throttled.send({ url: 'test://renderer' }, 'data-update', { value: 1 })
      throttled.send({ url: 'test://renderer' }, 'data-update', { value: 2 })
      throttled.send({ url: 'test://renderer' }, 'data-update', { value: 3 })

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith({ url: 'test://renderer' }, 'data-update', {
        value: 3,
      })
    })

    it('should handle mixed send method calls', async () => {
      throttled.send({ identifier: 'renderer' }, 'position-update', 1, 1)
      throttled.send({ webContentsId: 1 }, 'volume-change', 50)
      throttled.send({ url: 'test://url' }, 'song-changed', 'song-123')

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(3)
      })
    })

    it('should coalesce allIdentifiers calls', async () => {
      throttled.send({ allIdentifiers: /renderer.*/ }, 'position-update', 1, 1)
      throttled.send({ allIdentifiers: /renderer.*/ }, 'position-update', 2, 2)
      throttled.send({ allIdentifiers: /renderer.*/ }, 'position-update', 3, 3)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith(
        { allIdentifiers: /renderer.*/ },
        'position-update',
        3,
        3
      )
    })

    it('should coalesce allUrls calls', async () => {
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 10)
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 20)
      throttled.send({ allUrls: /test:\/\/.*/ }, 'volume-change', 30)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith({ allUrls: /test:\/\/.*/ }, 'volume-change', 30)
    })
  })

  describe('Receive-side coalescing', () => {
    it('should coalesce multiple receives on same channel', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      // Get the internal handler registered with utility
      const utilityOnCalls = vi.mocked(utility.on).mock.calls
      const internalHandler = utilityOnCalls.find(
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
        .mocked(utility.on)
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
        .mocked(utility.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any
      const volumeHandler = vi
        .mocked(utility.on)
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
        .mocked(utility.on)
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
        .mocked(utility.on)
        .mock.calls.find((call) => call[0] === 'position-update')?.[1] as any

      const sender1: DirectIpcTarget = {
        id: 1,
        webContentsId: 1,
        url: 'sender1',
        identifier: 'sender1',
        processType: ProcessType.RENDERER,
      }
      const sender2: DirectIpcTarget = {
        id: 2,
        webContentsId: 2,
        url: 'sender2',
        identifier: 'sender2',
        processType: ProcessType.RENDERER,
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
        .mocked(utility.on)
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
        .mocked(utility.on)
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
      const handler = vi.fn()
      expect(throttled.handle).toBeDefined()
      expect(typeof throttled.handle).toBe('function')

      throttled.handle('test-channel' as never, handler as never)
    })

    it('should proxy invoke() to directIpc', () => {
      expect(throttled.invoke).toBeDefined()
      expect(typeof throttled.invoke).toBe('function')
    })

    it('should proxy getMap() to directIpc', () => {
      expect(throttled.getMap).toBeDefined()
      expect(typeof throttled.getMap).toBe('function')

      const map = throttled.getMap()
      expect(Array.isArray(map)).toBe(true)
    })

    it('should proxy getMyIdentifier() to directIpc', () => {
      expect(throttled.getMyIdentifier).toBeDefined()
      expect(typeof throttled.getMyIdentifier).toBe('function')

      const id = throttled.getMyIdentifier()
      expect(id).toBe('test-worker')
    })

    it('should proxy getRegistrationState() to directIpc', () => {
      expect(throttled.getRegistrationState).toBeDefined()
      expect(typeof throttled.getRegistrationState).toBe('function')

      const state = throttled.getRegistrationState()
      expect(state).toBe(RegistrationState.REGISTERED)
    })

    it('should expose directIpc property', () => {
      expect(throttled.directIpc).toBe(utility)
    })

    it('should expose localEvents property', () => {
      expect(throttled.localEvents).toBe(utility.localEvents)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty sends (no pending messages)', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(utility.send).not.toHaveBeenCalled()
    })

    it('should handle empty receives (no pending messages)', async () => {
      const listener = vi.fn()
      throttled.on('volume-change', listener)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle rapid consecutive microtasks', async () => {
      const listener = vi.fn()
      throttled.on('position-update', listener)

      const internalHandler = vi
        .mocked(utility.on)
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
      throttled.send({ identifier: 'renderer' }, 'volume-change', 0)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith({ identifier: 'renderer' }, 'volume-change', 0)
    })

    it('should handle complex object arguments', async () => {
      const complexData = {
        value: 123,
        nested: { prop: 'test' },
        array: [1, 2, 3],
      }

      throttled.send({ identifier: 'renderer' }, 'data-update', complexData)

      await vi.waitFor(() => {
        expect(utility.send).toHaveBeenCalledTimes(1)
      })

      expect(utility.send).toHaveBeenCalledWith(
        { identifier: 'renderer' },
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
      utility.on('song-changed', directListener)

      // Get handlers
      const throttledHandler = vi
        .mocked(utility.on)
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
        .mocked(utility.on)
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
