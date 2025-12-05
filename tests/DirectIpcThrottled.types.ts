/**
 * Type-level tests for DirectIpcThrottled
 *
 * These tests verify that the type system correctly handles:
 * 1. Generic type preservation from wrapped DirectIpcRenderer
 * 2. Type-safe send methods with correct argument inference
 * 3. Type-safe listener registration with sender prepending
 * 4. Proxy method type preservation
 *
 * Note: These tests are compile-time only. If TypeScript compiles without
 * errors, the tests pass. Runtime execution is not necessary.
 */

import { DirectIpcRenderer } from '../src/renderer/DirectIpcRenderer'
import { DirectIpcTarget } from '../src/common/DirectIpcCommunication'

// Define test message and invoke maps
type TestMessageMap = {
  'position-update': (x: number, y: number) => void
  'volume-change': (level: number) => void
  'data-received': (data: { count: number; name: string }) => void
  'simple-message': () => void
}

type TestInvokeMap = {
  'get-user': (userId: string) => Promise<{ id: string; name: string }>
  calculate: (a: number, b: number) => Promise<number>
}

type TestIdentifiers = 'controller' | 'output' | 'thumbnails'

// ============================================================================
// Test generic type preservation
// ============================================================================

function testTypePreservation() {
  const directIpc = DirectIpcRenderer._createInstance<
    TestMessageMap,
    TestInvokeMap,
    TestIdentifiers
  >()
  const throttled = directIpc.throttled

  // ✓ Should preserve TMessageMap type
  throttled.sendToIdentifier('output', 'position-update', 10, 20)

  // ✓ Should preserve TInvokeMap type
  throttled.invokeIdentifier('output', 'get-user', undefined, 'user-123')

  // ✓ Should preserve TIdentifierStrings type
  throttled.setIdentifier('controller')

  // @ts-expect-error - Should reject invalid identifier
  throttled.setIdentifier('invalid-identifier')
}

// ============================================================================
// Test send method type safety
// ============================================================================

function testSendMethods() {
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled = directIpc.throttled

  // ✓ Should infer correct argument types for position-update
  throttled.sendToIdentifier('output', 'position-update', 10, 20)

  // ✓ Should infer correct argument types for volume-change
  throttled.sendToWebContentsId(1, 'volume-change', 75)

  // ✓ Should infer correct argument types for data-received
  throttled.sendToUrl('test://url', 'data-received', {
    count: 42,
    name: 'test',
  })

  // ✓ Should accept no args for simple-message
  throttled.sendToIdentifier('output', 'simple-message')

  // @ts-expect-error - Wrong number of arguments
  throttled.sendToIdentifier('output', 'position-update', 10)

  // @ts-expect-error - Wrong argument type
  throttled.sendToWebContentsId(1, 'volume-change', 'not-a-number')

  // @ts-expect-error - Wrong object shape
  throttled.sendToUrl('test://url', 'data-received', { count: 42 })

  // @ts-expect-error - Invalid channel name
  throttled.sendToIdentifier('output', 'non-existent-channel', 123)
}

// ============================================================================
// Test sendToAll* methods
// ============================================================================

function testSendToAllMethods() {
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled = directIpc.throttled

  // ✓ Should accept string pattern
  throttled.sendToAllIdentifiers('output', 'position-update', 10, 20)

  // ✓ Should accept regex pattern
  throttled.sendToAllIdentifiers(/output.*/, 'volume-change', 50)

  // ✓ Should work with sendToAllUrls
  throttled.sendToAllUrls(/test:\/\/.*/, 'simple-message')

  // ✗ Wrong argument types (should cause error)
  throttled.sendToAllIdentifiers(
    /output.*/,
    'position-update',
    // @ts-expect-error - Testing that wrong argument type is caught
    'not-a-number',
    20
  )
}

// ============================================================================
// Test listener type safety (on/off methods)
// ============================================================================

function testListenerMethods() {
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled = directIpc.throttled

  // ✓ Should infer correct listener signature with sender prepended
  throttled.on('position-update', (sender, x, y) => {
    // Verify sender type
    const _sender: DirectIpcTarget = sender
    // Verify x is number
    const _x: number = x
    // Verify y is number
    const _y: number = y
    void _sender
    void _x
    void _y
  })

  // ✓ Should infer correct listener signature for volume-change
  throttled.on('volume-change', (sender, level) => {
    const _sender: DirectIpcTarget = sender
    const _level: number = level
    void _sender
    void _level
  })

  // ✓ Should infer correct listener signature for data-received
  throttled.on('data-received', (sender, data) => {
    const _sender: DirectIpcTarget = sender
    const _count: number = data.count
    const _name: string = data.name
    void _sender
    void _count
    void _name
  })

  // ✓ Should handle simple-message with only sender
  throttled.on('simple-message', (sender) => {
    const _sender: DirectIpcTarget = sender
    void _sender
  })

  // ✓ Should support off() with same signature
  const positionListener = (sender: DirectIpcTarget, x: number, y: number) => {
    console.log(sender, x, y)
  }
  throttled.on('position-update', positionListener)
  throttled.off('position-update', positionListener)

  // @ts-expect-error - Missing sender parameter
  throttled.on('position-update', (x: number, y: number) => {
    console.log(x, y)
  })

  // @ts-expect-error - Wrong argument types
  throttled.on('volume-change', (sender: DirectIpcTarget, level: string) => {
    console.log(sender, level)
  })
}

// ============================================================================
// Test proxy method type safety
// ============================================================================

function testProxyMethods() {
  const directIpc = DirectIpcRenderer._createInstance<
    TestMessageMap,
    TestInvokeMap,
    TestIdentifiers
  >()
  const throttled = directIpc.throttled

  // ✓ Should preserve handle() signature
  throttled.handle('get-user', async (sender, userId) => {
    const _sender: DirectIpcTarget = sender
    const _userId: string = userId
    void _sender
    void _userId
    return { id: userId, name: 'test' }
  })

  // ✓ Should preserve invokeIdentifier() signature and return type
  throttled.invokeIdentifier('output', 'calculate', undefined, 5, 10).then((result) => {
    const _result: number = result
    void _result
  })

  // ✓ Should preserve getMap() return type
  const map = throttled.getMap()
  const _map: DirectIpcTarget[] = map
  void _map

  // ✓ Should preserve getMyIdentifier() return type
  const id = throttled.getMyIdentifier()
  const _id: TestIdentifiers | undefined = id
  void _id

  // ✓ Should preserve setIdentifier() parameter type
  throttled.setIdentifier('controller')

  // ✗ Wrong return type from handle (should cause error)
  throttled.handle(
    'get-user',
    // @ts-expect-error - Testing that wrong return type is caught
    async (sender: DirectIpcTarget, userId: string) => {
      void sender
      void userId
      return { id: userId, wrongProp: 'test' }
    }
  )

  // ✗ Wrong argument types for invoke (should cause error)
  throttled.invokeIdentifier(
    'output',
    'calculate',
    undefined,
    // @ts-expect-error - Testing that wrong argument type is caught
    'not-a-number',
    10
  )
}

// ============================================================================
// Test directIpc property access
// ============================================================================

function testDirectIpcAccess() {
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled = directIpc.throttled

  // ✓ Should expose directIpc property
  const _directIpc: DirectIpcRenderer<TestMessageMap> = throttled.directIpc
  void _directIpc

  // ✓ Should allow calling non-throttled methods on directIpc
  throttled.directIpc.sendToIdentifier('output', 'simple-message')

  // ✓ Should expose localEvents property
  throttled.localEvents.on('target-added', (target) => {
    const _target: DirectIpcTarget = target
    void _target
  })
}

// ============================================================================
// Test with empty type maps
// ============================================================================

function testEmptyTypeMaps() {
  const directIpc = DirectIpcRenderer._createInstance()
  const throttled = directIpc.throttled

  // ✓ Should still work with any channel name
  throttled.sendToIdentifier('output', 'any-channel', 123, 'test')

  // ✓ Should still work with any listener
  throttled.on('any-channel', (sender, arg1, arg2) => {
    const _sender: DirectIpcTarget = sender
    const _arg1: unknown = arg1
    const _arg2: unknown = arg2
    void _sender
    void _arg1
    void _arg2
  })
}

// ============================================================================
// Test method chaining
// ============================================================================

function testMethodChaining() {
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled = directIpc.throttled

  // ✓ Should support chaining on() calls
  throttled
    .on('position-update', (sender, x, y) => {
      console.log(sender, x, y)
    })
    .on('volume-change', (sender, level) => {
      console.log(sender, level)
    })

  // ✓ Should support chaining off() calls
  const listener1 = (sender: DirectIpcTarget, x: number, y: number) => {
    console.log(sender, x, y)
  }
  const listener2 = (sender: DirectIpcTarget, level: number) => {
    console.log(sender, level)
  }

  throttled.on('position-update', listener1).on('volume-change', listener2)

  throttled.off('position-update', listener1).off('volume-change', listener2)
}

// ============================================================================
// Test automatic initialization
// ============================================================================

function testAutomaticInitialization() {
  // ✓ Should create throttled instance automatically
  const directIpc = DirectIpcRenderer._createInstance<TestMessageMap>({
    log: {
      silly: () => {},
      debug: () => {},
      info: console.log,
      warn: console.warn,
      error: console.error,
    },
  })

  // ✓ throttled property should be automatically available
  const throttled = directIpc.throttled

  // ✓ Should work without log option
  const directIpc2 = DirectIpcRenderer._createInstance<TestMessageMap>()
  const throttled2 = directIpc2.throttled

  void throttled
  void throttled2
}

// Export to prevent "unused" errors
export {
  testTypePreservation,
  testSendMethods,
  testSendToAllMethods,
  testListenerMethods,
  testProxyMethods,
  testDirectIpcAccess,
  testEmptyTypeMaps,
  testMethodChaining,
  testAutomaticInitialization,
}
