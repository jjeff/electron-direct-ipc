/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProcessType } from '../src/common/DirectIpcCommunication'
import { IdentifierConflictError } from '../src/utility/errors'

// Mock electron before importing DirectIpcMain
const mockUtilityProcess = {
  pid: 12345,
  postMessage: vi.fn(),
  on: vi.fn(),
  kill: vi.fn(),
}

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  webContents: {
    getAllWebContents: vi.fn().mockReturnValue([]),
  },
  MessageChannelMain: vi.fn(() => ({
    port1: { start: vi.fn(), postMessage: vi.fn() },
    port2: { start: vi.fn(), postMessage: vi.fn() },
  })),
  utilityProcess: {
    fork: vi.fn(() => mockUtilityProcess),
  },
}))

// Import DirectIpcMain after mocking electron
import { DirectIpcMain } from '../src/main/DirectIpcMain'

describe('DirectIpcMain - Utility Process Support', () => {
  let directIpcMain: DirectIpcMain

  beforeEach(() => {
    // Reset singleton and create fresh instance for each test
    ;(DirectIpcMain as any)._instance = null

    // Mock process type check to return true (simulate main process)
    vi.spyOn(DirectIpcMain as any, 'isMainProcess').mockReturnValue(true)

    directIpcMain = DirectIpcMain.instance()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up singleton
    ;(DirectIpcMain as any)._instance = null
  })

  describe('registerUtilityProcess()', () => {
    it('should validate identifier is provided', () => {
      // T014: Test that registerUtilityProcess throws when identifier is missing or empty
      expect(() => {
        directIpcMain.registerUtilityProcess('', mockUtilityProcess as any)
      }).toThrow('DirectIpc: Utility process identifier is required')

      expect(() => {
        directIpcMain.registerUtilityProcess(null as any, mockUtilityProcess as any)
      }).toThrow('DirectIpc: Utility process identifier is required')
    })

    it('should validate utility process is provided', () => {
      // T014: Test that registerUtilityProcess throws when process is null/undefined
      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', null as any)
      }).toThrow('DirectIpc: Utility process instance is required')

      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', undefined as any)
      }).toThrow('DirectIpc: Utility process instance is required')
    })

    it('should accept valid identifier and process', () => {
      // T014: Test that registerUtilityProcess succeeds with valid inputs
      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)
      }).not.toThrow()

      // Verify process was registered
      const utilityProcesses = directIpcMain.getUtilityProcesses()
      expect(utilityProcesses).toContain('worker-1')

      // Verify lifecycle listener was set up
      expect(mockUtilityProcess.on).toHaveBeenCalledWith('exit', expect.any(Function))
    })
  })

  describe('registerUtilityProcess() conflict detection', () => {
    it('should detect identifier conflict with existing renderer', () => {
      // T015: Register a renderer, then try to register utility with same identifier
      // We need to access the private identifierMap to simulate a renderer registration
      // This is acceptable in tests to verify internal behavior
      ;(directIpcMain as any).identifierMap.set('worker-1', 999)

      // Now attempt to register utility process with same identifier
      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)
      }).toThrow(IdentifierConflictError)

      try {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)
      } catch (error) {
        expect(error).toBeInstanceOf(IdentifierConflictError)
        expect((error as IdentifierConflictError).existingType).toBe(ProcessType.RENDERER)
      }
    })

    it('should detect identifier conflict with existing utility process', () => {
      // T015: Register utility process, then try to register another with same identifier
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Create a second mock utility process
      const mockUtilityProcess2 = {
        pid: 67890,
        postMessage: vi.fn(),
        on: vi.fn(),
        kill: vi.fn(),
      }

      // Attempt to register another utility process with same identifier
      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess2 as any)
      }).toThrow(IdentifierConflictError)

      try {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess2 as any)
      } catch (error) {
        expect(error).toBeInstanceOf(IdentifierConflictError)
        expect((error as IdentifierConflictError).existingType).toBe(ProcessType.UTILITY)
      }
    })

    it('should allow same identifier for different utility process instances after unregister', () => {
      // T015: Register, unregister, then register again with same identifier
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Verify it's registered
      expect(directIpcMain.getUtilityProcesses()).toContain('worker-1')

      // Unregister
      const result = directIpcMain.unregisterUtilityProcess('worker-1')
      expect(result).toBe(true)

      // Verify it's no longer registered
      expect(directIpcMain.getUtilityProcesses()).not.toContain('worker-1')

      // Create a new mock utility process
      const mockUtilityProcess2 = {
        pid: 67890,
        postMessage: vi.fn(),
        on: vi.fn(),
        kill: vi.fn(),
      }

      // Should succeed without error
      expect(() => {
        directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess2 as any)
      }).not.toThrow()

      // Verify new process is registered
      expect(directIpcMain.getUtilityProcesses()).toContain('worker-1')
    })
  })

  describe('unregisterUtilityProcess()', () => {
    it('should return true when utility process exists', () => {
      // Register utility process
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Unregister it
      const result = directIpcMain.unregisterUtilityProcess('worker-1')

      // Expect return value true
      expect(result).toBe(true)
    })

    it('should return false when utility process does not exist', () => {
      // Attempt to unregister non-existent identifier
      const result = directIpcMain.unregisterUtilityProcess('non-existent')

      // Expect return value false
      expect(result).toBe(false)
    })

    it('should remove utility process from map', () => {
      // Register utility process
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Verify it appears in getUtilityProcesses()
      expect(directIpcMain.getUtilityProcesses()).toContain('worker-1')

      // Unregister it
      directIpcMain.unregisterUtilityProcess('worker-1')

      // Verify it no longer appears in getUtilityProcesses()
      expect(directIpcMain.getUtilityProcesses()).not.toContain('worker-1')
    })
  })

  describe('getUtilityProcesses()', () => {
    it('should return empty array when no utility processes registered', () => {
      const result = directIpcMain.getUtilityProcesses()
      expect(result).toEqual([])
    })

    it('should return all registered utility process identifiers', () => {
      // Register multiple utility processes
      const mockProcess1 = {
        pid: 11111,
        postMessage: vi.fn(),
        on: vi.fn(),
        kill: vi.fn(),
      }
      const mockProcess2 = {
        pid: 22222,
        postMessage: vi.fn(),
        on: vi.fn(),
        kill: vi.fn(),
      }
      const mockProcess3 = {
        pid: 33333,
        postMessage: vi.fn(),
        on: vi.fn(),
        kill: vi.fn(),
      }

      directIpcMain.registerUtilityProcess('worker-1', mockProcess1 as any)
      directIpcMain.registerUtilityProcess('worker-2', mockProcess2 as any)
      directIpcMain.registerUtilityProcess('worker-3', mockProcess3 as any)

      // Verify getUtilityProcesses() returns all identifiers
      const result = directIpcMain.getUtilityProcesses()
      expect(result).toHaveLength(3)
      expect(result).toContain('worker-1')
      expect(result).toContain('worker-2')
      expect(result).toContain('worker-3')
    })
  })

  describe('utility process lifecycle', () => {
    it('should listen for utility process exit event', () => {
      // T031: Register utility process
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Verify process.on('exit') was called
      expect(mockUtilityProcess.on).toHaveBeenCalledWith('exit', expect.any(Function))
    })

    it('should auto-unregister utility process on exit', () => {
      // T031: Register utility process
      directIpcMain.registerUtilityProcess('worker-1', mockUtilityProcess as any)

      // Verify it's registered
      expect(directIpcMain.getUtilityProcesses()).toContain('worker-1')

      // Get the exit handler that was registered
      const exitHandler = mockUtilityProcess.on.mock.calls.find(
        (call: any[]) => call[0] === 'exit'
      )?.[1]

      expect(exitHandler).toBeDefined()

      // Trigger exit event
      exitHandler(0)

      // Verify process was automatically unregistered
      expect(directIpcMain.getUtilityProcesses()).not.toContain('worker-1')
    })
  })
})
