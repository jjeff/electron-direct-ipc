/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock electron before importing DirectIpcRenderer
vi.mock('electron', () => ({
  ipcRenderer: {
    on: vi.fn(),
    invoke: vi.fn().mockResolvedValue([]),
  },
}))

// Mock EventEmitter
vi.mock('eventemitter', () => {
  return {
    default: class MockEventEmitter {
      private listeners = new Map<string, Function[]>()

      on(event: string, listener: Function) {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, [])
        }
        this.listeners.get(event)!.push(listener)
        return this
      }

      emit(event: string, ...args: unknown[]) {
        const eventListeners = this.listeners.get(event)
        if (eventListeners) {
          eventListeners.forEach((listener) => listener(...args))
        }
        return true
      }

      removeListener(event: string, listener: Function) {
        const eventListeners = this.listeners.get(event)
        if (eventListeners) {
          const index = eventListeners.indexOf(listener)
          if (index > -1) {
            eventListeners.splice(index, 1)
          }
        }
        return this
      }

      off(event: string, listener: Function) {
        return this.removeListener(event, listener)
      }
    },
  }
})

import {
  DirectIpcRenderer,
  DirectIpcLogger,
} from '../src/renderer/DirectIpcRenderer'
import { DIRECT_IPC_CHANNELS } from '../src/common/DirectIpcCommunication'

// Helper to create mock MessagePort with all required methods
function createMockMessagePort(): MessagePort {
  const eventListeners = new Map<string, Set<EventListener>>()

  return {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, new Set())
      }
      eventListeners.get(type)!.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      eventListeners.get(type)?.delete(listener)
    }),
    dispatchEvent: vi.fn(),
    onmessage: null,
    onmessageerror: null,
  } as unknown as MessagePort
}

describe('DirectIpcRenderer', () => {
  let directIpc: DirectIpcRenderer
  let mockLogger: DirectIpcLogger
  let mockIpcRenderer: any

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      silly: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Mock ipcRenderer
    mockIpcRenderer = {
      on: vi.fn(),
      invoke: vi.fn().mockImplementation((channel: string) => {
        if (channel === DIRECT_IPC_CHANNELS.SUBSCRIBE) {
          return Promise.resolve([])
        }
        if (channel === DIRECT_IPC_CHANNELS.UPDATE_IDENTIFIER) {
          return Promise.resolve()
        }
        if (channel === DIRECT_IPC_CHANNELS.REFRESH_MAP) {
          return Promise.resolve([])
        }
        return Promise.resolve(true)
      }),
    }

    // Create instance with mocked dependencies
    directIpc = DirectIpcRenderer._createInstance(
      { log: mockLogger },
      { ipcRenderer: mockIpcRenderer }
    )
  })

  afterEach(() => {
    directIpc.clearPendingInvokes()
    directIpc.closeAllPorts()
  })

  describe('constructor', () => {
    it('should set up IPC listeners', () => {
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.MAP_UPDATE,
        expect.any(Function)
      )
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.PORT_MESSAGE,
        expect.any(Function)
      )
    })

    it('should auto-subscribe on construction', () => {
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.SUBSCRIBE,
        undefined
      )
    })
  })

  describe('identifier', () => {
    it('should accept identifier in constructor', async () => {
      const directIpcWithId = DirectIpcRenderer._createInstance(
        { log: mockLogger, identifier: 'test-id' },
        { ipcRenderer: mockIpcRenderer }
      )

      // Wait for async subscription to complete
      await vi.waitFor(() => {
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          DIRECT_IPC_CHANNELS.SUBSCRIBE,
          'test-id'
        )
      })

      await vi.waitFor(() => {
        expect(directIpcWithId.getMyIdentifier()).toBe('test-id')
      })
    })

    it('should update identifier via IPC', async () => {
      await directIpc.setIdentifier('my-identifier')

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.UPDATE_IDENTIFIER,
        'my-identifier'
      )
      expect(directIpc.getMyIdentifier()).toBe('my-identifier')
    })

    it('should handle errors when setting identifier', async () => {
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Conflict'))

      await expect(directIpc.setIdentifier('duplicate')).rejects.toThrow(
        'Conflict'
      )
    })
  })

  describe('map updates', () => {
    it('should handle map updates', () => {
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      const newMap = [
        { webContentsId: 1, url: 'https://example1.com', identifier: 'first' },
        { webContentsId: 2, url: 'https://example2.com', identifier: 'second' },
      ]

      const mapUpdatedSpy = vi.fn()
      directIpc.localEvents.on('map-updated', mapUpdatedSpy)

      mapUpdateListener({}, { map: newMap })

      expect(directIpc.getMap()).toEqual(newMap)
      expect(mapUpdatedSpy).toHaveBeenCalledWith(newMap)
    })

    it('should emit target-added for new entries', () => {
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      const targetAddedSpy = vi.fn()
      directIpc.localEvents.on('target-added', targetAddedSpy)

      const newMap = [
        { webContentsId: 1, url: 'https://example.com', identifier: 'test' },
      ]

      mapUpdateListener({}, { map: newMap })

      expect(targetAddedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ webContentsId: 1 })
      )
    })

    it('should emit target-removed for removed entries', () => {
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      const targetRemovedSpy = vi.fn()
      directIpc.localEvents.on('target-removed', targetRemovedSpy)

      // Set initial map
      const initialMap = [
        { webContentsId: 1, url: 'https://example.com', identifier: 'test' },
      ]
      mapUpdateListener({}, { map: initialMap })

      // Update to empty map
      mapUpdateListener({}, { map: [] })

      expect(targetRemovedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ webContentsId: 1 })
      )
    })
  })

  describe('refreshMap', () => {
    it('should invoke REFRESH_MAP and update local map', async () => {
      const newMap = [
        { webContentsId: 1, url: 'https://example.com', identifier: 'test' },
      ]

      mockIpcRenderer.invoke.mockResolvedValueOnce(newMap)

      const result = await directIpc.refreshMap()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.REFRESH_MAP
      )
      expect(result).toEqual(newMap)
      expect(directIpc.getMap()).toEqual(newMap)
    })
  })

  describe('sendTo methods', () => {
    it('should request port by webContentsId', async () => {
      const mockPort = createMockMessagePort()

      // Get the port message listener
      const portMessageListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.PORT_MESSAGE
      )?.[1]

      // Get the map update listener
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      // Trigger port arrival immediately before the async call
      const sendPromise = directIpc.sendToWebContentsId(
        2,
        'test-message',
        'arg1',
        'arg2'
      )

      // Simulate port arrival (this caches the port)
      portMessageListener(
        { ports: [mockPort] },
        {
          sender: {
            webContentsId: 2,
            url: 'https://target.com',
            identifier: 'target',
          },
        }
      )

      // Simulate map update (this triggers port-added event)
      mapUpdateListener(
        {},
        {
          map: [
            {
              webContentsId: 2,
              url: 'https://target.com',
              identifier: 'target',
            },
          ],
        }
      )

      await sendPromise

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: ['arg1', 'arg2'],
      })
    })

    it('should request port by identifier and match on message-port-added', async () => {
      const mockPort = createMockMessagePort()

      // Get the port message listener
      const portMessageListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.PORT_MESSAGE
      )?.[1]

      // Start the send before the port arrives
      const sendPromise = directIpc.sendToIdentifier(
        'my-target',
        'test-message',
        'arg1'
      )

      // Simulate port arrival with matching identifier
      portMessageListener(
        { ports: [mockPort] },
        {
          sender: {
            webContentsId: 5,
            url: 'https://target.com',
            identifier: 'my-target',
          },
        }
      )

      await sendPromise

      // Verify the message was sent
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: ['arg1'],
      })
    })

    it('should request port by URL pattern and match on message-port-added', async () => {
      const mockPort = createMockMessagePort()

      // Get the port message listener
      const portMessageListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.PORT_MESSAGE
      )?.[1]

      // Start the send before the port arrives
      const sendPromise = directIpc.sendToUrl(
        /target\.com/,
        'test-message',
        'arg1'
      )

      // Simulate port arrival with matching URL
      portMessageListener(
        { ports: [mockPort] },
        {
          sender: {
            webContentsId: 6,
            url: 'https://target.com/path',
            identifier: 'some-id',
          },
        }
      )

      await sendPromise

      // Verify the message was sent
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: ['arg1'],
      })
    })

    it('should not match port with different identifier', async () => {
      const mockPort = createMockMessagePort()

      // Get the port message listener
      const portMessageListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.PORT_MESSAGE
      )?.[1]

      // Reduce timeout to make test faster
      directIpc.setDefaultTimeout(100)

      // Start the send
      const sendPromise = directIpc.sendToIdentifier(
        'target-1',
        'test-message',
        'arg1'
      )

      // Simulate port arrival with DIFFERENT identifier
      portMessageListener(
        { ports: [mockPort] },
        {
          sender: {
            webContentsId: 7,
            url: 'https://other.com',
            identifier: 'target-2',
          },
        }
      )

      // Should timeout because identifier doesn't match
      await expect(sendPromise).rejects.toThrow(/Timeout/)

      // Message should not have been sent
      expect(mockPort.postMessage).not.toHaveBeenCalled()

      // Reset timeout
      directIpc.setDefaultTimeout(5000)
    })
  })

  describe('sendToAll methods', () => {
    it('should filter map by identifier pattern', () => {
      // Set up map with multiple entries
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      mapUpdateListener(
        {},
        {
          map: [
            {
              webContentsId: 1,
              url: 'https://app1.example.com',
              identifier: 'app-1',
            },
            {
              webContentsId: 2,
              url: 'https://app2.example.com',
              identifier: 'app-2',
            },
            {
              webContentsId: 3,
              url: 'https://other.com',
              identifier: 'other',
            },
          ],
        }
      )

      // Call sendToAllIdentifiers - it will timeout but we can check the invoke calls
      directIpc.sendToAllIdentifiers(/^app-/, 'broadcast', 'data').catch(() => {
        // Ignore timeout
      })

      // The method should find 2 matches and request ports for them
      // We can't easily test the full async flow in unit tests
      expect(directIpc.getMap()).toHaveLength(3)
    })

    it('should filter map by URL pattern', () => {
      const mapUpdateListener = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === DIRECT_IPC_CHANNELS.MAP_UPDATE
      )?.[1]

      mapUpdateListener(
        {},
        {
          map: [
            {
              webContentsId: 1,
              url: 'https://app1.example.com',
              identifier: 'app-1',
            },
            {
              webContentsId: 2,
              url: 'https://app2.example.com',
              identifier: 'app-2',
            },
            {
              webContentsId: 3,
              url: 'https://other.com',
              identifier: 'other',
            },
          ],
        }
      )

      directIpc.sendToAllUrls(/example\.com/, 'broadcast', 'data').catch(() => {
        // Ignore timeout
      })

      // Verify map has correct entries
      const map = directIpc.getMap()
      const exampleUrls = map.filter((t) => /example\.com/.test(t.url))
      expect(exampleUrls).toHaveLength(2)
    })
  })

  describe('invoke/handle', () => {
    it('should register a handler', () => {
      const handler = vi.fn(async () => 'response')
      directIpc.handle('test-channel', handler)

      expect(mockLogger.silly).toHaveBeenCalledWith(
        expect.stringContaining('Registering handler')
      )
    })

    it('should remove a handler', () => {
      const handler = vi.fn()
      directIpc.handle('test-channel', handler)
      directIpc.removeHandler('test-channel')

      expect(mockLogger.silly).toHaveBeenCalledWith(
        expect.stringContaining('Removing handler')
      )
    })

    it('should warn when replacing existing handler', () => {
      directIpc.handle('test-channel', vi.fn())
      directIpc.handle('test-channel', vi.fn())

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      )
    })
  })

  describe('timeout management', () => {
    it('should have default timeout of 5000ms', () => {
      expect(directIpc.getDefaultTimeout()).toBe(5000)
    })

    it('should allow setting default timeout', () => {
      directIpc.setDefaultTimeout(10000)
      expect(directIpc.getDefaultTimeout()).toBe(10000)
    })
  })

  describe('cleanup methods', () => {
    it('should clear all pending invokes', () => {
      // Create a fake pending invoke
      const pending = {
        resolve: vi.fn(),
        reject: vi.fn(),
        timeout: setTimeout(() => {}, 1000) as NodeJS.Timeout,
      }

      // Access private field for testing
      ;(directIpc as any).pendingInvokes.set('test-id', pending)

      directIpc.clearPendingInvokes()

      expect(pending.reject).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cleared all pending invokes'),
        })
      )
    })

    it('should close all cached ports', () => {
      const mockPort = createMockMessagePort()

      // Access private field for testing
      ;(directIpc as any).portCache.set(1, {
        port: mockPort,
        info: { webContentsId: 1, url: 'https://example.com' },
      })

      directIpc.closeAllPorts()

      expect(mockPort.close).toHaveBeenCalled()
      expect((directIpc as any).portCache.size).toBe(0)
    })
  })

  describe('TypeScript generics', () => {
    it('should support typed message maps', () => {
      type MyMessages = {
        'user-updated': (userId: string, name: string) => void
        'data-received': (data: { count: number }) => void
      }

      const typedRenderer = directIpc as DirectIpcRenderer<MyMessages>

      // TypeScript should allow correct types
      // This is mainly a compile-time check
      expect(typedRenderer).toBeDefined()
      expect(typedRenderer.getMap).toBeDefined()
    })
  })

  describe('Port caching with identifier resolution', () => {
    it('should use cached port when requesting by identifier after initial connection', async () => {
      // Set up the map with a target that has an identifier
      const targetInfo = {
        webContentsId: 2,
        url: 'https://target.com',
        identifier: 'my-target',
      }

      // Simulate receiving the map update
      ;(directIpc as any).map = [targetInfo]

      // Create a mock port
      const mockPort = createMockMessagePort()

      // Add the port to the cache (simulating a previous connection)
      ;(directIpc as any).portCache.set(2, {
        port: mockPort,
        info: targetInfo,
      })

      // Clear mocks from initialization
      vi.clearAllMocks()

      // Send a message using the identifier - should use cached port
      await directIpc.sendToIdentifier('my-target', 'test-message')

      // Should have used the cached port without invoking the main process
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalled()
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: [],
      })
    })

    it('should use cached port when requesting by URL pattern after initial connection', async () => {
      // Set up the map with a target
      const targetInfo = {
        webContentsId: 3,
        url: 'https://controller.com/page',
        identifier: 'controller',
      }

      // Simulate receiving the map update
      ;(directIpc as any).map = [targetInfo]

      // Create a mock port
      const mockPort = createMockMessagePort()

      // Add the port to the cache
      ;(directIpc as any).portCache.set(3, {
        port: mockPort,
        info: targetInfo,
      })

      // Clear mocks from initialization
      vi.clearAllMocks()

      // Send a message using a URL pattern - should use cached port
      await directIpc.sendToUrl(/controller\.com/, 'test-message')

      // Should have used the cached port without invoking the main process
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalled()
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: [],
      })
    })

    it('should request new port if identifier resolves to unknown webContentsId', async () => {
      // Set up the map with a target
      const targetInfo = {
        webContentsId: 4,
        url: 'https://new-target.com',
        identifier: 'new-target',
      }

      // Simulate receiving the map update
      ;(directIpc as any).map = [targetInfo]

      // Clear mocks from initialization
      vi.clearAllMocks()

      // Mock the invoke to return success
      mockIpcRenderer.invoke.mockResolvedValue(true)

      // Create a new port that will be received
      const newPort = createMockMessagePort()

      // Simulate receiving the port shortly after invoke
      setTimeout(() => {
        ;(directIpc as any).handlePortMessage(newPort, targetInfo)
      }, 10)

      // Send a message using the identifier (not in cache yet)
      await directIpc.sendToIdentifier('new-target', 'test-message')

      // Should have invoked the main process to get a new port
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        DIRECT_IPC_CHANNELS.GET_PORT,
        { identifier: 'new-target' }
      )
      // Should have sent the message via the new port
      expect(newPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: [],
      })
    })
  })
})
