/**
 * Integration tests for DirectIpc Renderer-to-Renderer communication
 *
 * Tests the communication flow between two DirectIpcRenderer instances
 * connected via MessageChannel. This simulates how renderers communicate
 * in a real Electron app after DirectIpcMain has established the connection.
 *
 * Tests:
 * - Basic messaging between renderers
 * - Throttled vs non-throttled messaging
 * - Invoke/handle pattern
 * - Bidirectional communication
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DirectIpcRenderer } from '../src/renderer/DirectIpcRenderer'
import {
  DirectIpcTarget,
  DIRECT_IPC_CHANNELS,
} from '../src/common/DirectIpcCommunication'
import { EventEmitter } from 'events'

// Test message maps
type TestMessageMap = {
  'position-update': (x: number, y: number) => void
  'volume-change': (level: number) => void
  'user-action': (action: string, data?: unknown) => void
  'high-frequency': (value: number) => void
}

type TestInvokeMap = {
  'get-data': (id: string) => Promise<{ id: string; name: string }>
  calculate: (a: number, b: number) => Promise<number>
  echo: (message: string) => Promise<string>
}

type TestIdentifiers = 'controller' | 'output' | 'thumbnails'

/**
 * Mock IpcRenderer that supports MessagePort transfers
 */
class MockIpcRenderer extends EventEmitter {
  private handlers = new Map<string, (event: any, ...args: any[]) => void>()
  private invokeHandlers = new Map<string, (...args: any[]) => Promise<any>>()

  on(channel: string, listener: (event: any, ...args: any[]) => void): this {
    this.handlers.set(channel, listener)
    return super.on(channel, listener)
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.invokeHandlers.get(channel)
    if (!handler) {
      throw new Error(`No invoke handler for channel: ${channel}`)
    }
    return handler(...args)
  }

  // Simulate main process sending a message with ports
  simulateMessage(channel: string, message: any, ports?: MessagePort[]) {
    const handler = this.handlers.get(channel)
    if (handler) {
      handler({ ports: ports || [] }, message)
    }
  }

  // Register a handler for invoke calls (simulates main process)
  registerInvokeHandler(
    channel: string,
    handler: (...args: any[]) => Promise<any>
  ) {
    this.invokeHandlers.set(channel, handler)
  }
}

describe('DirectIpc Renderer Integration Tests', () => {
  let renderer1: DirectIpcRenderer<
    TestMessageMap,
    TestInvokeMap,
    TestIdentifiers
  >
  let renderer2: DirectIpcRenderer<
    TestMessageMap,
    TestInvokeMap,
    TestIdentifiers
  >

  let mockIpcRenderer1: MockIpcRenderer
  let mockIpcRenderer2: MockIpcRenderer

  const webContentsId1 = 1
  const webContentsId2 = 2

  beforeEach(async () => {
    // Create mock IPC renderers
    mockIpcRenderer1 = new MockIpcRenderer()
    mockIpcRenderer2 = new MockIpcRenderer()

    // Register mock handlers for subscribe - return the other renderer in the map
    mockIpcRenderer1.registerInvokeHandler(
      DIRECT_IPC_CHANNELS.SUBSCRIBE,
      async () => {
        return [
          {
            webContentsId: webContentsId2,
            url: 'output-url',
            identifier: 'output',
          },
        ]
      }
    )

    mockIpcRenderer2.registerInvokeHandler(
      DIRECT_IPC_CHANNELS.SUBSCRIBE,
      async () => {
        return [
          {
            webContentsId: webContentsId1,
            url: 'controller-url',
            identifier: 'controller',
          },
        ]
      }
    )

    // Keep track of MessageChannels created for each pair
    const messageChannels = new Map<string, MessageChannel>()

    // Mock GET_PORT - simulates main process creating and distributing MessageChannel
    const getPortHandler = async (
      requestingRenderer: MockIpcRenderer,
      requestingId: number,
      otherRenderer: MockIpcRenderer,
      otherId: number,
      otherInfo: DirectIpcTarget
    ) => {
      const key = [requestingId, otherId].sort().join('-')
      let channel = messageChannels.get(key)

      if (!channel) {
        // Create new MessageChannel
        channel = new MessageChannel()
        messageChannels.set(key, channel)

        // Send both ports immediately
        setTimeout(() => {
          // Send port1 to the requesting renderer
          requestingRenderer.simulateMessage(
            DIRECT_IPC_CHANNELS.PORT_MESSAGE,
            {
              sender: otherInfo,
            },
            [channel.port1]
          )

          // Send port2 to the other renderer
          otherRenderer.simulateMessage(
            DIRECT_IPC_CHANNELS.PORT_MESSAGE,
            {
              sender: {
                webContentsId: requestingId,
                url:
                  requestingId === webContentsId1
                    ? 'controller-url'
                    : 'output-url',
                identifier:
                  requestingId === webContentsId1 ? 'controller' : 'output',
              },
            },
            [channel.port2]
          )
        }, 0)
      }

      return true
    }

    mockIpcRenderer1.registerInvokeHandler(
      DIRECT_IPC_CHANNELS.GET_PORT,
      async (_target) => {
        return getPortHandler(
          mockIpcRenderer1,
          webContentsId1,
          mockIpcRenderer2,
          webContentsId2,
          {
            webContentsId: webContentsId2,
            url: 'output-url',
            identifier: 'output',
          }
        )
      }
    )

    mockIpcRenderer2.registerInvokeHandler(
      DIRECT_IPC_CHANNELS.GET_PORT,
      async (_target) => {
        return getPortHandler(
          mockIpcRenderer2,
          webContentsId2,
          mockIpcRenderer1,
          webContentsId1,
          {
            webContentsId: webContentsId1,
            url: 'controller-url',
            identifier: 'controller',
          }
        )
      }
    )

    // Create DirectIpcRenderer instances
    renderer1 = DirectIpcRenderer._createInstance<
      TestMessageMap,
      TestInvokeMap,
      TestIdentifiers
    >(
      {
        identifier: 'controller',
        log: { silly: vi.fn(), error: vi.fn() },
      },
      { ipcRenderer: mockIpcRenderer1 as any }
    )

    renderer2 = DirectIpcRenderer._createInstance<
      TestMessageMap,
      TestInvokeMap,
      TestIdentifiers
    >(
      {
        identifier: 'output',
        log: { silly: vi.fn(), error: vi.fn() },
      },
      { ipcRenderer: mockIpcRenderer2 as any }
    )

    // Wait for subscriptions to complete
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  afterEach(() => {
    renderer1.closeAllPorts()
    renderer2.closeAllPorts()
    renderer1.clearPendingInvokes()
    renderer2.clearPendingInvokes()
    vi.clearAllMocks()
  })

  /**
   * Helper: Establish MessageChannel connection between two renderers
   * This triggers the GET_PORT invoke which sends the ports
   */
  async function connectRenderers() {
    // Just make a call that will trigger getPort()
    // The GET_PORT mock handlers will send the ports automatically
    // We don't need to do anything here - the ports are sent when needed
  }

  describe('Basic messaging', () => {
    it('should send and receive messages between renderers', async () => {
      const listener = vi.fn()
      renderer2.on('user-action', listener)

      await connectRenderers()

      // Send message from renderer1 to renderer2
      await renderer1.sendToIdentifier('output', 'user-action', 'click', {
        button: 'play',
      })

      // Wait for message to be received
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          webContentsId: webContentsId1,
          identifier: 'controller',
        }),
        'click',
        { button: 'play' }
      )
    })

    it('should send and receive multiple messages', async () => {
      const positionListener = vi.fn()
      const volumeListener = vi.fn()

      renderer2.on('position-update', positionListener)
      renderer2.on('volume-change', volumeListener)

      await connectRenderers()

      // Send multiple messages
      await renderer1.sendToIdentifier('output', 'position-update', 100, 200)
      await renderer1.sendToIdentifier('output', 'volume-change', 75)
      await renderer1.sendToIdentifier('output', 'position-update', 150, 250)

      await vi.waitFor(() => {
        expect(positionListener).toHaveBeenCalledTimes(2)
        expect(volumeListener).toHaveBeenCalledTimes(1)
      })

      expect(positionListener).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        100,
        200
      )
      expect(positionListener).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        150,
        250
      )
      expect(volumeListener).toHaveBeenCalledWith(expect.anything(), 75)
    })
  })

  describe('Throttled messaging', () => {
    it('should coalesce high-frequency throttled messages', async () => {
      const listener = vi.fn()
      renderer2.throttled.on('high-frequency', listener)

      await connectRenderers()

      // Send many messages rapidly (throttled)
      for (let i = 0; i < 100; i++) {
        renderer1.throttled.sendToIdentifier('output', 'high-frequency', i)
      }

      // Wait for coalescing
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalled()
      })

      // Should only receive the last value (99)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.anything(), 99)
    })

    it('should not coalesce non-throttled messages', async () => {
      const listener = vi.fn()
      renderer2.on('high-frequency', listener)

      await connectRenderers()

      // Send 10 messages (non-throttled)
      for (let i = 0; i < 10; i++) {
        await renderer1.sendToIdentifier('output', 'high-frequency', i)
      }

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(10)
      })

      // Should receive all values
      for (let i = 0; i < 10; i++) {
        expect(listener).toHaveBeenNthCalledWith(i + 1, expect.anything(), i)
      }
    })

    it('should allow mixing throttled and non-throttled on same channel', async () => {
      const throttledListener = vi.fn()
      const normalListener = vi.fn()

      renderer2.throttled.on('position-update', throttledListener)
      renderer2.on('position-update', normalListener)

      await connectRenderers()

      // Send messages via throttled (only last should arrive for throttled listener)
      for (let i = 0; i < 5; i++) {
        renderer1.throttled.sendToIdentifier('output', 'position-update', i, i)
      }

      await vi.waitFor(() => {
        expect(throttledListener).toHaveBeenCalled()
      })

      // Throttled listener should only get last value
      expect(throttledListener).toHaveBeenCalledTimes(1)
      expect(throttledListener).toHaveBeenCalledWith(expect.anything(), 4, 4)

      // Normal listener should also receive it (once the throttled send completes)
      expect(normalListener).toHaveBeenCalledWith(expect.anything(), 4, 4)
    })
  })

  describe('Invoke/handle pattern', () => {
    it('should invoke handlers and receive responses', async () => {
      await connectRenderers()

      // Register handler on renderer2
      renderer2.handle('get-data', async (sender, id) => {
        return { id, name: `User ${id}` }
      })

      // Invoke from renderer1
      const result = await renderer1.invokeIdentifier(
        'output',
        'get-data',
        undefined,
        'user-123'
      )

      expect(result).toEqual({ id: 'user-123', name: 'User user-123' })
    })

    it('should handle invoke errors gracefully', async () => {
      await connectRenderers()

      // Register handler that throws
      renderer2.handle('get-data', async (sender, id) => {
        throw new Error(`User ${id} not found`)
      })

      // Invoke should reject
      await expect(
        renderer1.invokeIdentifier(
          'output',
          'get-data',
          undefined,
          'invalid-id'
        )
      ).rejects.toThrow('User invalid-id not found')
    })

    it('should support multiple concurrent invokes', async () => {
      await connectRenderers()

      // Register handlers
      renderer2.handle('calculate', async (sender, a, b) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return a + b
      })

      renderer2.handle('echo', async (sender, message) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return message
      })

      // Invoke multiple handlers concurrently
      const [result1, result2, result3] = await Promise.all([
        renderer1.invokeIdentifier('output', 'calculate', undefined, 5, 3),
        renderer1.invokeIdentifier('output', 'echo', undefined, 'hello'),
        renderer1.invokeIdentifier('output', 'calculate', undefined, 10, 20),
      ])

      expect(result1).toBe(8)
      expect(result2).toBe('hello')
      expect(result3).toBe(30)
    })

    it('should work with throttled proxy methods', async () => {
      await connectRenderers()

      // Register handler via throttled
      renderer2.throttled.handle('calculate', async (sender, a, b) => {
        return a * b
      })

      // Invoke via throttled
      const result = await renderer1.throttled.invokeIdentifier(
        'output',
        'calculate',
        undefined,
        5,
        7
      )

      expect(result).toBe(35)
    })
  })

  describe('Bidirectional communication', () => {
    it('should support communication in both directions', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      renderer1.on('user-action', listener1)
      renderer2.on('user-action', listener2)

      await connectRenderers()

      // Send from renderer1 to renderer2
      await renderer1.sendToIdentifier('output', 'user-action', 'action1')

      // Send from renderer2 to renderer1
      await renderer2.sendToIdentifier('controller', 'user-action', 'action2')

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(1)
        expect(listener2).toHaveBeenCalledTimes(1)
      })

      expect(listener1).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'output' }),
        'action2'
      )
      expect(listener2).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'controller' }),
        'action1'
      )
    })

    it('should support bidirectional invoke/handle', async () => {
      await connectRenderers()

      // Both renderers handle requests
      renderer1.handle('echo', async (sender, msg) => `R1: ${msg}`)
      renderer2.handle('echo', async (sender, msg) => `R2: ${msg}`)

      // Invoke in both directions
      const [result1, result2] = await Promise.all([
        renderer1.invokeIdentifier('output', 'echo', undefined, 'hello'),
        renderer2.invokeIdentifier('controller', 'echo', undefined, 'world'),
      ])

      expect(result1).toBe('R2: hello')
      expect(result2).toBe('R1: world')
    })
  })

  describe('Edge cases', () => {
    it('should handle removing listeners correctly', async () => {
      const listener = vi.fn()

      renderer2.on('user-action', listener)

      await connectRenderers()

      // Send first message
      await renderer1.sendToIdentifier('output', 'user-action', 'action1')

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })

      // Remove listener
      renderer2.off('user-action', listener)

      // Send second message
      await renderer1.sendToIdentifier('output', 'user-action', 'action2')

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Should still be 1 (not called again)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should handle throttled listener removal', async () => {
      const listener = vi.fn()

      renderer2.throttled.on('high-frequency', listener)

      await connectRenderers()

      // Send messages
      for (let i = 0; i < 10; i++) {
        renderer1.throttled.sendToIdentifier('output', 'high-frequency', i)
      }

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalled()
      })

      expect(listener).toHaveBeenCalledTimes(1)

      // Remove throttled listener
      renderer2.throttled.off('high-frequency', listener)

      // Send more messages
      for (let i = 10; i < 20; i++) {
        renderer1.throttled.sendToIdentifier('output', 'high-frequency', i)
      }

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Should still be 1 (not called again)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('Throttled property access', () => {
    it('should expose throttled property on renderer instances', () => {
      expect(renderer1.throttled).toBeDefined()
      expect(renderer2.throttled).toBeDefined()
      expect(renderer1.throttled.directIpc).toBe(renderer1)
      expect(renderer2.throttled.directIpc).toBe(renderer2)
    })

    it('should allow accessing directIpc through throttled', async () => {
      const listener = vi.fn()
      renderer2.throttled.directIpc.on('user-action', listener)

      await connectRenderers()

      await renderer1.sendToIdentifier('output', 'user-action', 'test')

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(1)
      })
    })

    it('should expose localEvents through throttled', async () => {
      const listener = vi.fn()
      renderer1.throttled.localEvents.on('message-port-added', listener)

      await connectRenderers()

      // Send a message which will trigger port creation
      await renderer1.sendToIdentifier('output', 'user-action', 'test')

      // Wait for the listener to be called
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ identifier: 'output' })
        )
      })
    })
  })
})
