/**
 * Integration tests for DirectIpc Utility Process lifecycle
 *
 * Tests the communication flow between renderer processes and utility processes
 * connected via MessageChannel. This simulates how renderers communicate with
 * utility processes in a real Electron app after DirectIpcMain has established
 * the connection.
 *
 * Tests:
 * - Utility process registration
 * - Renderer-to-utility messaging
 * - Utility-to-renderer messaging
 * - Invoke/handle pattern with utility processes
 * - Lifecycle events (spawn, exit)
 *
 * NOTE: These tests verify the DirectIpcUtility implementation in isolation.
 * Full end-to-end tests with real Electron processes are in tests/e2e/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { DirectIpcUtility, RegistrationState } from '../src/utility/DirectIpcUtility.js'
import { DIRECT_IPC_CHANNELS, DirectIpcTarget, ProcessType } from '../src/common/DirectIpcCommunication.js'

// Test message maps
type TestMessageMap = {
  'compute-request': (data: number) => void
  'compute-result': (result: number) => void
  'status': (message: string) => void
}

type TestInvokeMap = {
  'heavy-computation': (data: number[]) => Promise<number>
  'get-stats': () => Promise<{ uptime: number; processed: number }>
}

type TestIdentifiers = 'main-window' | 'compute-worker' | 'worker-2'

// Mock process.parentPort for utility process
const createMockParentPort = () => {
  const mockPort = new EventEmitter()
  const postMessage = vi.fn()
  return Object.assign(mockPort, { postMessage })
}

// Mock MessagePort for testing
const createMockMessagePort = () => {
  const port = new EventEmitter()
  return Object.assign(port, {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null as any,
  })
}

describe('Utility Process Lifecycle Integration', () => {
  let mockParentPort: ReturnType<typeof createMockParentPort>
  let utilityInstance: DirectIpcUtility<TestMessageMap, TestInvokeMap, TestIdentifiers>

  beforeEach(() => {
    // Reset singleton
    ;(DirectIpcUtility as any)._instance = null

    // Mock process type check to return true (simulate utility process)
    vi.spyOn(DirectIpcUtility as any, 'isUtilityProcess').mockReturnValue(true)

    // Mock parent port for utility process
    mockParentPort = createMockParentPort()
    process.parentPort = mockParentPort as any
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (process as any).parentPort
  })

  describe('renderer to utility messaging', () => {
    it('should send message from renderer to utility process', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Set up utility message handler
      const utilityHandler = vi.fn()
      utilityInstance.on('compute-request', utilityHandler)

      // Complete utility registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.UTILITY,
                identifier: 'compute-worker',
                webContentsId: 0,
              },
            ],
          },
        })
      })

      // Create a mock port simulating a connection from renderer
      const mockPort = createMockMessagePort()
      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      // Inject the port directly (simulating what main process would do)
      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: rendererInfo,
      })

      // Simulate incoming message from renderer via MessagePort
      const messageData = {
        message: 'compute-request',
        args: [42],
      }

      // Trigger the port message handler directly
      ;(utilityInstance as any).handlePortMessage(messageData, rendererInfo)

      // Verify handler was called with correct arguments
      expect(utilityHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
        }),
        42
      )
    })

    it('should handle MessageChannel transfer to utility process', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.UTILITY,
                identifier: 'compute-worker',
                webContentsId: 0,
              },
            ],
          },
        })
      })

      // Simulate receiving a new port from main process
      const mockPort = createMockMessagePort()
      const portAddedHandler = vi.fn()

      utilityInstance.localEvents.once('message-port-added', portAddedHandler)

      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.PORT_MESSAGE,
          sender: {
            processType: ProcessType.RENDERER,
            identifier: 'main-window',
            webContentsId: 1,
          },
        },
        ports: [mockPort],
      })

      // Wait for port handling
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(portAddedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
        })
      )
    })
  })

  describe('utility to renderer messaging', () => {
    it('should send message from utility to renderer process', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Complete utility registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.RENDERER,
                identifier: 'main-window',
                webContentsId: 1,
              },
            ],
          },
        })
      })

      // Create a mock port for the renderer
      const mockPort = createMockMessagePort()
      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: {
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
          webContentsId: 1,
        },
      })

      // Send message from utility to renderer
      await utilityInstance.send({ identifier: 'main-window' }, 'compute-result', 123)

      // Verify message was posted to the port
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'compute-result',
        args: [123],
      })
    })

    it('should handle bidirectional communication', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const utilityHandler = vi.fn()
      utilityInstance.on('compute-request', utilityHandler)

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.RENDERER,
                identifier: 'main-window',
                webContentsId: 1,
              },
            ],
          },
        })
      })

      // Set up mock port
      const mockPort = createMockMessagePort()
      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: rendererInfo,
      })

      // Receive message from renderer
      ;(utilityInstance as any).handlePortMessage(
        { message: 'compute-request', args: [42] },
        rendererInfo
      )

      // Send message to renderer
      await utilityInstance.send({ identifier: 'main-window' }, 'compute-result', 84)

      expect(utilityHandler).toHaveBeenCalledWith(expect.any(Object), 42)
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'compute-result',
        args: [84],
      })
    })
  })

  describe('registration lifecycle', () => {
    it('should complete registration handshake', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
        registrationTimeout: 1000,
      })

      expect(utilityInstance.getRegistrationState()).toBe(RegistrationState.SUBSCRIBING)

      const registrationPromise = new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())
      })

      // Verify registration request was sent
      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        channel: DIRECT_IPC_CHANNELS.UTILITY_REGISTER,
        identifier: 'compute-worker',
      })

      // Simulate MAP_UPDATE from main
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [
            {
              processType: ProcessType.UTILITY,
              identifier: 'compute-worker',
              webContentsId: 0,
            },
          ],
        },
      })

      await registrationPromise

      expect(utilityInstance.getRegistrationState()).toBe(RegistrationState.REGISTERED)
    })

    it('should update process map on registration', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const mapUpdatedHandler = vi.fn()
      utilityInstance.localEvents.on('map-updated', mapUpdatedHandler)

      const testMap: DirectIpcTarget[] = [
        {
          processType: ProcessType.UTILITY,
          identifier: 'compute-worker',
          webContentsId: 0,
        },
        {
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
          webContentsId: 1,
          url: 'http://localhost',
        },
      ]

      // Complete registration with multiple processes
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: testMap,
          },
        })
      })

      expect(mapUpdatedHandler).toHaveBeenCalledWith(testMap)
      expect(utilityInstance.getMap()).toEqual(testMap)
    })
  })

  describe('invoke/handle pattern', () => {
    it('should invoke utility process handler from renderer', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Set up handler in utility process
      const handlerResult = 15
      utilityInstance.handle('heavy-computation', async (sender, data: number[]) => {
        return data.reduce((sum, n) => sum + n, 0)
      })

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [],
          },
        })
      })

      // Set up mock port
      const mockPort = createMockMessagePort()
      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: rendererInfo,
      })

      // Simulate invoke request from renderer
      const invokeRequest = {
        type: 'invoke',
        channel: 'heavy-computation',
        requestId: 'test-req-1',
        args: [[1, 2, 3, 4, 5]],
      }

      ;(utilityInstance as any).handlePortMessage(invokeRequest, rendererInfo)

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify response was sent
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'invoke-response',
        requestId: 'test-req-1',
        success: true,
        data: 15,
      })
    })

    it('should handle timeout for slow handlers', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Set up slow handler
      utilityInstance.handle('heavy-computation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return 42
      })

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.RENDERER,
                identifier: 'main-window',
                webContentsId: 1,
              },
            ],
          },
        })
      })

      // Set up mock port
      const mockPort = createMockMessagePort()
      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: {
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
          webContentsId: 1,
        },
      })

      // Invoke with short timeout
      const invokePromise = utilityInstance.invoke(
        { identifier: 'main-window' },
        'heavy-computation',
        [1, 2, 3],
        { timeout: 100 }
      )

      await expect(invokePromise).rejects.toThrow('invoke timeout')
    })
  })

  describe('throttled messaging', () => {
    it('should expose throttled property on utility instance', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      expect(utilityInstance.throttled).toBeDefined()
      expect(utilityInstance.throttled.directIpc).toBe(utilityInstance)
    })

    it('should coalesce high-frequency throttled sends from utility', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [
              {
                processType: ProcessType.RENDERER,
                identifier: 'main-window',
                webContentsId: 1,
              },
            ],
          },
        })
      })

      // Set up mock port
      const mockPort = createMockMessagePort()
      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: {
          processType: ProcessType.RENDERER,
          identifier: 'main-window',
          webContentsId: 1,
        },
      })

      // Send many messages rapidly via throttled
      for (let i = 0; i < 100; i++) {
        utilityInstance.throttled.send({ identifier: 'main-window' }, 'compute-result', i)
      }

      // Should not have sent yet (queued in microtask)
      expect(mockPort.postMessage).not.toHaveBeenCalled()

      // Wait for microtask to flush
      await vi.waitFor(() => {
        expect(mockPort.postMessage).toHaveBeenCalled()
      })

      // Should only send the last value (99)
      expect(mockPort.postMessage).toHaveBeenCalledTimes(1)
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'compute-result',
        args: [99],
      })
    })

    it('should coalesce high-frequency throttled receives in utility', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const throttledListener = vi.fn()
      utilityInstance.throttled.on('compute-request', throttledListener)

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [],
          },
        })
      })

      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      // Simulate many rapid incoming messages
      for (let i = 0; i < 100; i++) {
        ;(utilityInstance as any).handlePortMessage(
          { message: 'compute-request', args: [i] },
          rendererInfo
        )
      }

      // Wait for microtask to flush
      await vi.waitFor(() => {
        expect(throttledListener).toHaveBeenCalled()
      })

      // Should only receive the last value (99)
      expect(throttledListener).toHaveBeenCalledTimes(1)
      expect(throttledListener).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'main-window' }),
        99
      )
    })

    it('should not coalesce non-throttled utility messages', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const normalListener = vi.fn()
      utilityInstance.on('compute-request', normalListener)

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [],
          },
        })
      })

      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      // Send 10 messages (non-throttled)
      for (let i = 0; i < 10; i++) {
        ;(utilityInstance as any).handlePortMessage(
          { message: 'compute-request', args: [i] },
          rendererInfo
        )
      }

      // Should receive all 10 messages immediately
      expect(normalListener).toHaveBeenCalledTimes(10)
      for (let i = 0; i < 10; i++) {
        expect(normalListener).toHaveBeenNthCalledWith(i + 1, expect.anything(), i)
      }
    })

    it('should allow mixing throttled and non-throttled on same channel', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const throttledListener = vi.fn()
      const normalListener = vi.fn()

      utilityInstance.throttled.on('compute-request', throttledListener)
      utilityInstance.on('compute-request', normalListener)

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [],
          },
        })
      })

      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      // Send 5 messages
      for (let i = 0; i < 5; i++) {
        ;(utilityInstance as any).handlePortMessage(
          { message: 'compute-request', args: [i] },
          rendererInfo
        )
      }

      // Normal listener gets all immediately
      expect(normalListener).toHaveBeenCalledTimes(5)

      // Wait for throttled microtask
      await vi.waitFor(() => {
        expect(throttledListener).toHaveBeenCalled()
      })

      // Throttled listener only gets last value
      expect(throttledListener).toHaveBeenCalledTimes(1)
      expect(throttledListener).toHaveBeenCalledWith(expect.anything(), 4)
    })

    it('should proxy invoke/handle through throttled', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      // Register handler via throttled (should work same as direct)
      utilityInstance.throttled.handle('heavy-computation', async (sender, data: number[]) => {
        return data.reduce((sum, n) => sum + n, 0)
      })

      // Complete registration
      await new Promise<void>((resolve) => {
        utilityInstance.localEvents.once('registration-complete', () => resolve())

        mockParentPort.emit('message', {
          data: {
            channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
            map: [],
          },
        })
      })

      // Set up mock port
      const mockPort = createMockMessagePort()
      const rendererInfo: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'main-window',
        webContentsId: 1,
      }

      ;(utilityInstance as any).portCache.set('main-window', {
        port: mockPort,
        info: rendererInfo,
      })

      // Simulate invoke request
      ;(utilityInstance as any).handlePortMessage(
        {
          type: 'invoke',
          channel: 'heavy-computation',
          requestId: 'throttled-test-1',
          args: [[1, 2, 3, 4, 5]],
        },
        rendererInfo
      )

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify response
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'invoke-response',
        requestId: 'throttled-test-1',
        success: true,
        data: 15,
      })
    })

    it('should expose localEvents through throttled', async () => {
      utilityInstance = DirectIpcUtility.instance<TestMessageMap, TestInvokeMap, TestIdentifiers>({
        identifier: 'compute-worker',
      })

      const registrationHandler = vi.fn()
      utilityInstance.throttled.localEvents.on('registration-complete', registrationHandler)

      // Complete registration
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [],
        },
      })

      await vi.waitFor(() => {
        expect(registrationHandler).toHaveBeenCalled()
      })
    })
  })
})
