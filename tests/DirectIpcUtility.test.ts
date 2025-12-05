/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { DirectIpcUtility, RegistrationState } from '../src/utility/DirectIpcUtility.js'
import {
  DIRECT_IPC_CHANNELS,
  DirectIpcTarget,
  ProcessType,
} from '../src/common/DirectIpcCommunication.js'

// Mock process.parentPort
const createMockParentPort = () => {
  const mockPort = new EventEmitter()
  const postMessage = vi.fn()
  return Object.assign(mockPort, { postMessage })
}

describe('DirectIpcUtility', () => {
  let mockParentPort: ReturnType<typeof createMockParentPort>

  beforeEach(() => {
    // Reset singleton
    ;(DirectIpcUtility as any)._instance = null

    // Mock process type check to return true (simulate utility process)
    vi.spyOn(DirectIpcUtility as any, 'isUtilityProcess').mockReturnValue(true)

    // Create and set mock parent port
    mockParentPort = createMockParentPort()
    process.parentPort = mockParentPort as any
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (process as any).parentPort
  })

  describe('instance creation', () => {
    it('should create singleton instance', () => {
      const instance1 = DirectIpcUtility.instance({ identifier: 'test-worker' })
      const instance2 = DirectIpcUtility.instance()

      expect(instance1).toBe(instance2)
      expect(instance1.getMyIdentifier()).toBe('test-worker')
    })
  })

  describe('registration', () => {
    it('should handle registration handshake', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })

      // Verify registration request sent
      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        channel: DIRECT_IPC_CHANNELS.UTILITY_REGISTER,
        identifier: 'test-worker',
      })

      expect(utility.getRegistrationState()).toBe(RegistrationState.SUBSCRIBING)

      // Wait for registration complete
      const registrationPromise = new Promise<void>((resolve) => {
        utility.localEvents.once('registration-complete', () => resolve())
      })

      // Simulate MAP_UPDATE from main process
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [
            {
              id: 1,
              processType: ProcessType.UTILITY,
              identifier: 'test-worker',
            },
          ],
        },
      })

      await registrationPromise

      expect(utility.getRegistrationState()).toBe(RegistrationState.REGISTERED)
    })
  })

  describe('message queuing', () => {
    it('should queue messages during initialization', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })

      // Send message before registration completes
      await utility.send({ identifier: 'renderer-1' }, 'test-message', 'arg1')

      // Message should be queued (not sent yet)
      expect(utility.getRegistrationState()).toBe(RegistrationState.SUBSCRIBING)
    })

    it('should flush queued messages on registration', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })
      const sendToTargetSpy = vi.spyOn(utility as any, 'sendToTarget')

      // Mock a port for the target so sendToTarget doesn't hang
      const mockPort = {
        postMessage: vi.fn(),
        onmessage: null,
        on: vi.fn(),
        start: vi.fn(),
        close: vi.fn(),
      }

      // Queue messages before registration
      void utility.send({ identifier: 'renderer-1' }, 'message1', 'data1')
      void utility.send({ identifier: 'renderer-1' }, 'message2', 'data2')

      const flushPromise = new Promise<void>((resolve) => {
        utility.localEvents.once('registration-complete', () => {
          // Give more time for async flush to complete
          setTimeout(() => resolve(), 100)
        })
      })

      // Pre-populate port cache with mock port for the target
      ;(utility as any).portCache.set('renderer-1', {
        port: mockPort,
        info: {
          id: 1,
          processType: ProcessType.RENDERER,
          identifier: 'renderer-1',
          webContentsId: 1,
          url: 'http://test.com',
        },
      })

      // Complete registration with MAP_UPDATE
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [
            {
              id: 1,
              processType: ProcessType.RENDERER,
              identifier: 'renderer-1',
              webContentsId: 1,
              url: 'http://test.com',
            },
          ],
        },
      })

      await flushPromise

      expect(sendToTargetSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('send', () => {
    it('should send message to target process', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })

      const registrationPromise = new Promise<void>((resolve) => {
        utility.localEvents.once('registration-complete', () => resolve())
      })

      // Complete registration
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [
            {
              id: 2,
              processType: ProcessType.RENDERER,
              identifier: 'renderer-1',
              webContentsId: 1,
            },
          ],
        },
      })

      await registrationPromise

      // Set up a mock port
      const mockPort = {
        postMessage: vi.fn(),
        onmessage: null as any,
        start: vi.fn(),
        close: vi.fn(),
      }

      ;(utility as any).portCache.set('renderer-1', {
        port: mockPort,
        info: { identifier: 'renderer-1', webContentsId: 1, processType: ProcessType.RENDERER },
      })

      await utility.send({ identifier: 'renderer-1' }, 'test-message', 'arg1', 'arg2')

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        message: 'test-message',
        args: ['arg1', 'arg2'],
      })
    })
  })

  describe('on/off', () => {
    it('should register message listener', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })

      const handler = vi.fn()
      utility.on('test-event', handler)

      const registrationPromise = new Promise<void>((resolve) => {
        utility.localEvents.once('registration-complete', () => resolve())
      })

      // Complete registration
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [],
        },
      })

      await registrationPromise

      // Simulate incoming message
      const sender: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'renderer-1',
        webContentsId: 1,
      }

      utility.emit('test-event', sender, 'data1', 'data2')

      expect(handler).toHaveBeenCalledWith(sender, 'data1', 'data2')
    })

    it('should remove message listener', async () => {
      const utility = DirectIpcUtility.instance({ identifier: 'test-worker' })

      const handler = vi.fn()
      utility.on('test-event', handler)
      utility.off('test-event', handler)

      const registrationPromise = new Promise<void>((resolve) => {
        utility.localEvents.once('registration-complete', () => resolve())
      })

      // Complete registration
      mockParentPort.emit('message', {
        data: {
          channel: DIRECT_IPC_CHANNELS.MAP_UPDATE,
          map: [],
        },
      })

      await registrationPromise

      const sender: DirectIpcTarget = {
        processType: ProcessType.RENDERER,
        identifier: 'renderer-1',
        webContentsId: 1,
      }

      utility.emit('test-event', sender, 'data')

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
