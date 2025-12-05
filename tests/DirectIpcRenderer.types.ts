/**
 * Type-level tests for DirectIpcRenderer strongly-typed event system
 *
 * These tests verify that the type system correctly enforces:
 * 1. DirectIpcEventMap events use their original signatures
 * 2. TMessageMap events automatically prepend sender: DirectIpcTarget
 * 3. TInvokeMap events automatically prepend sender: DirectIpcTarget
 * 4. CombinedEventMap correctly merges all event sources
 *
 * Note: These tests are compile-time only. If TypeScript compiles without
 * errors, the tests pass. Runtime execution is not necessary.
 */

import {
  DirectIpcRenderer,
  InvokeMap,
  EventMap,
} from '../src/renderer/DirectIpcRenderer'
import { DirectIpcTarget, ProcessType } from '../src/common/DirectIpcCommunication'

// Define test message and invoke maps
type TestMessageMap = {
  'user-updated': (userId: string, name: string) => void
  'data-received': (data: { count: number }) => void
  'simple-message': () => void
}

type TestInvokeMap = {
  'get-user': (userId: string) => Promise<{ id: string; name: string }>
  calculate: (a: number, b: number) => Promise<number>
}

// Create typed instance
type TestDirectIpc = DirectIpcRenderer<
  TestMessageMap,
  TestInvokeMap,
  'controller' | 'output'
>

// ============================================================================
// Test DirectIpcEventMap events (no sender transformation)
// ============================================================================

function testDirectIpcEventMapEvents(directIpc: TestDirectIpc) {
  // ✓ Should infer correct listener signature for 'target-added'
  directIpc.localEvents.on('target-added', (target) => {
    console.log(target.webContentsId)
    // Verify target is DirectIpcTarget
    const _verifyTarget: DirectIpcTarget = target
    void _verifyTarget
  })

  // ✓ Should infer correct listener signature for 'target-removed'
  directIpc.localEvents.on('target-removed', (target) => {
    console.log(target.webContentsId)
    // Verify target is DirectIpcTarget
    const _verifyTarget: DirectIpcTarget = target
    void _verifyTarget
  })

  // ✓ Should infer correct listener signature for 'map-updated'
  directIpc.localEvents.on('map-updated', (map) => {
    console.log(map.length)
    // Verify map is array of DirectIpcTarget
    const _verifyMap: DirectIpcTarget[] = map
    void _verifyMap
  })

  // ✓ Should infer correct listener signature for 'message'
  directIpc.localEvents.on('message', (sender, message) => {
    console.log(sender.webContentsId, message)
    // Verify sender is DirectIpcTarget
    const _verifySender: DirectIpcTarget = sender
    // Verify message is unknown
    const _verifyMessage: unknown = message
    void _verifySender
    void _verifyMessage
  })

  // ✓ Should emit with correct arguments
  const target: DirectIpcTarget = {
    id: 1,
    webContentsId: 1,
    url: 'test',
    identifier: 'test',
    processType: ProcessType.RENDERER,
  }
  directIpc.localEvents.emit('target-added', target)
  directIpc.localEvents.emit('target-removed', target)
  directIpc.localEvents.emit('map-updated', [target])
  directIpc.localEvents.emit('message', target, { test: true })

  // Note: Negative test cases (wrong signatures) are not possible with method overloads
  // because TypeScript will fall back to the `any` signature for compatibility.
  // The strong typing only provides IntelliSense and type checking for correct usage.
}

// ============================================================================
// Test TMessageMap events (sender IS prepended)
// ============================================================================

function testMessageMapEvents(directIpc: TestDirectIpc) {
  // ✓ Should require sender as first argument for 'user-updated'
  directIpc.on('user-updated', (sender, userId, name) => {
    console.log(sender.webContentsId, userId, name)
    // test userId is string
    const _testString: string = userId
    // test name is string
    const _testName: string = name
  })

  // ✓ Should require sender as first argument for 'data-received'
  directIpc.on('data-received', (sender, data) => {
    console.log(sender.webContentsId, data.count)
    // test data.count is number
    const _testCount: number = data.count
    // test data is of correct shape
    const _testData: { count: number } = data
  })

  // ✓ Should require sender for 'simple-message' with no other args
  directIpc.on('simple-message', (sender) => {
    console.log(sender.webContentsId)
  })

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  directIpc.on('fake-event', (sender, arg1) => {
    // This is to illustrate that incorrect event names are not caught due to overloads

    console.log(sender, arg1)
  })

  // ✓ Should emit with sender as first argument
  const sender: DirectIpcTarget = {
    id: 1,
    webContentsId: 1,
    url: 'test',
    identifier: 'test',
    processType: ProcessType.RENDERER,
  }
  directIpc.emit('user-updated', sender, 'user-123', 'John Doe')
  directIpc.emit('data-received', sender, { count: 42 })
  directIpc.emit('simple-message', sender)

  // expect bad signature error
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  directIpc.emit('user-updated', 'user-123', 'John Doe') // Missing sender

  // expect bad argument type error
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  directIpc.emit('data-received', sender, { count: 'not-a-number' }) // count should be number

  // expect bad message name error
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  directIpc.emit('non-existent-event', sender) // Invalid event name
}

// ============================================================================
// Test TInvokeMap events (sender IS prepended)
// ============================================================================

function testInvokeMapEvents(directIpc: TestDirectIpc) {
  // ✓ Should infer sender as first argument for 'get-user'
  directIpc.handle('get-user', (sender, userId) => {
    console.log(sender.webContentsId, userId)
    // Verify sender is DirectIpcTarget
    const _verifySender: DirectIpcTarget = sender
    // Verify userId is string
    const _verifyUserId: string = userId
    void _verifySender
    void _verifyUserId
    return Promise.resolve({ id: userId, name: 'John' })
  })

  // ✓ Should infer sender as first argument for 'calculate'
  directIpc.handle('calculate', (sender, a, b) => {
    console.log(sender.webContentsId, a, b)
    // Verify sender is DirectIpcTarget
    const _verifySender: DirectIpcTarget = sender
    // Verify a and b are numbers
    const _testA: number = a
    const _testB: number = b
    void _verifySender
    void _testA
    void _testB
    return Promise.resolve(a + b)
  })

  // Note: Negative test cases omitted - method overloads allow fallback to `any` signature
}

// ============================================================================
// Test off() method
// ============================================================================

function testOffMethod(directIpc: TestDirectIpc) {
  // ✓ Should infer correct listener signature for removal
  const targetListener = (target: DirectIpcTarget) => {
    console.log(target)
  }
  directIpc.localEvents.on('target-added', targetListener)
  directIpc.localEvents.off('target-added', targetListener)

  // ✓ Should infer correct listener signature for TMessageMap
  const messageListener = (
    sender: DirectIpcTarget,
    userId: string,
    name: string
  ) => {
    console.log(sender, userId, name)
  }
  directIpc.on('user-updated', messageListener)
  directIpc.off('user-updated', messageListener)

  // Note: Negative test cases omitted - method overloads allow fallback to `any` signature
}

// ============================================================================
// Test event name constraints
// ============================================================================

function testEventNameConstraints(directIpc: TestDirectIpc) {
  // ✓ Should accept valid DirectIpcEventMap event names
  directIpc.localEvents.on('target-added', (target) => {
    console.log(target)
    // Verify target is inferred as DirectIpcTarget
    const _verifyTarget: DirectIpcTarget = target
    void _verifyTarget
  })

  // ✓ Should accept valid TMessageMap event names
  directIpc.on('user-updated', (sender, userId, name) => {
    console.log(sender, userId, name)
    // Verify types are inferred correctly
    const _verifySender: DirectIpcTarget = sender
    const _verifyUserId: string = userId
    const _verifyName: string = name
    void _verifySender
    void _verifyUserId
    void _verifyName
  })

  // ✓ Should accept valid TInvokeMap event names
  directIpc.handle('get-user', (sender, userId) => {
    console.log(sender, userId)
    // Verify types are inferred correctly
    const _verifySender: DirectIpcTarget = sender
    const _verifyUserId: string = userId
    void _verifySender
    void _verifyUserId
    return Promise.resolve({ id: userId, name: 'test' })
  })

  // Note: Negative test cases omitted - method overloads allow fallback to `any` signature
}

// ============================================================================
// Test with empty event maps
// ============================================================================

function testEmptyEventMaps() {
  const directIpc = DirectIpcRenderer._createInstance()

  // ✓ Should still have DirectIpcEventMap events available
  directIpc.localEvents.on('target-added', (target) => {
    console.log(target)
    // Verify target is inferred as DirectIpcTarget
    const _verifyTarget: DirectIpcTarget = target
    void _verifyTarget
  })

  directIpc.localEvents.emit('map-updated', [])

  directIpc.on('foo', (sender, arg1) => {
    console.log(sender, arg1)
    // test that sendere is DirectIpcTarget
    const _verifySender: DirectIpcTarget = sender
    void _verifySender

    // test that arg1 is unknown
    const _verifyArg1: unknown = arg1
    void _verifyArg1
  })
}

// ============================================================================
// Test identifier string constraints
// ============================================================================

function testIdentifierConstraints() {
  type MyIdentifiers = 'controller' | 'output' | 'thumbnails'
  const directIpc = DirectIpcRenderer._createInstance<
    EventMap,
    InvokeMap,
    MyIdentifiers
  >({
    identifier: 'controller',
  })

  // ✓ Should accept valid identifier
  directIpc.setIdentifier('output')
  directIpc.setIdentifier('thumbnails')

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  directIpc.setIdentifier('foo')

  // Note: setIdentifier uses string parameter in implementation, so type checking
  // for invalid identifiers isn't enforced. The TIdentifierStrings generic is
  // primarily for documentation and IntelliSense purposes.
}

// ============================================================================
// Test private constructor enforcement
// ============================================================================

function testPrivateConstructor() {
  // ✗ Should not allow direct instantiation with new
  // @ts-expect-error - Constructor is private and only accessible within the class
  const directIpc = new DirectIpcRenderer()
  void directIpc

  // ✓ Should allow instantiation via instance() method
  const singleton = DirectIpcRenderer.instance()
  console.log(singleton.getMap())

  // ✓ Should allow instantiation via _createInstance() for tests
  const testInstance = DirectIpcRenderer._createInstance()
  console.log(testInstance.getMap())
}

// Export to prevent "unused" errors
export {
  testDirectIpcEventMapEvents,
  testMessageMapEvents,
  testInvokeMapEvents,
  testOffMethod,
  testEventNameConstraints,
  testEmptyEventMaps,
  testIdentifierConstraints,
  testPrivateConstructor,
}
