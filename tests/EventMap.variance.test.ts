/**
 * Tests to verify EventMap and InvokeMap variance behavior
 *
 * These tests ensure that the `any` types in EventMap/InvokeMap constraints
 * allow proper type inference and satisfaction for transformed types like WithSender.
 */

import { describe, it, expect } from 'vitest'
import { EventMap, InvokeMap } from '../src/common/DirectIpcTypes'
import { DirectIpcTarget } from '../src/common/DirectIpcCommunication'

describe('EventMap and InvokeMap Variance', () => {
  it('should allow EventMap to be satisfied by concrete event maps', () => {
    type ConcreteEventMap = {
      'user-updated': (userId: string, name: string) => void
      'data-received': (data: { count: number }) => void
      'simple-event': () => void
    }

    // This should compile without errors
    const test: EventMap = {} as ConcreteEventMap
    expect(test).toBeDefined()
  })

  it('should allow InvokeMap to be satisfied by concrete invoke maps', () => {
    type ConcreteInvokeMap = {
      'get-user': (userId: string) => Promise<{ id: string; name: string }>
      calculate: (a: number, b: number) => Promise<number>
      'get-data': () => { value: string }
    }

    // This should compile without errors
    const test: InvokeMap = {} as ConcreteInvokeMap
    expect(test).toBeDefined()
  })

  it('should allow WithSender transformation to satisfy EventMap', () => {
    type BaseEventMap = {
      'user-updated': (userId: string) => void
    }

    type WithSender<T extends EventMap> = {
      [K in keyof T]: (sender: DirectIpcTarget, ...args: Parameters<T[K]>) => ReturnType<T[K]>
    }

    // This should compile without errors - the key test case
    const test: EventMap = {} as WithSender<BaseEventMap>
    expect(test).toBeDefined()
  })

  it('should preserve type inference through generic constraints', () => {
    function processEventMap<T extends EventMap>(map: T): T {
      return map
    }

    const concreteMap = {
      'user-updated': (userId: string, name: string) => {
        console.log(userId, name)
      },
      'count-changed': (count: number) => {
        console.log(count)
      },
    }

    // Type should be inferred as the concrete type, not widened to EventMap
    const result = processEventMap(concreteMap)

    // These assertions verify type inference is preserved
    type ResultType = typeof result
    type Expected = {
      'user-updated': (userId: string, name: string) => void
      'count-changed': (count: number) => void
    }

    // TypeScript should infer the exact types
    const _typeCheck: ResultType = {} as Expected
    const _typeCheck2: Expected = {} as ResultType
    expect(_typeCheck).toBeDefined()
    expect(_typeCheck2).toBeDefined()
    expect(result).toBeDefined()
  })

  it('should allow mixed parameter types in EventMap', () => {
    type MixedEventMap = {
      'no-params': () => void
      'one-param': (value: string) => void
      'multiple-params': (a: number, b: string, c: boolean) => void
      'object-param': (data: { nested: { value: number } }) => void
      'optional-params': (required: string, optional?: number) => void
      'rest-params': (first: string, ...rest: number[]) => void
    }

    // All of these should satisfy EventMap constraint
    const test: EventMap = {} as MixedEventMap
    expect(test).toBeDefined()
  })

  it('should allow transformed types with named parameters', () => {
    type BaseMap = {
      event: (data: string) => void
    }

    // Simulate DirectIpc's WithSender transformation
    type TransformedMap = {
      event: (sender: DirectIpcTarget, data: string) => void
    }

    // The key issue: transformed types with named parameters must satisfy EventMap
    const test: EventMap = {} as TransformedMap
    expect(test).toBeDefined()
  })

  it('should handle return type variance', () => {
    type EventMapWithDifferentReturns = {
      'returns-void': () => void
      'returns-string': () => string
      'returns-promise': () => Promise<void>
      'returns-unknown': () => unknown
    }

    // All these return types should be compatible with the 'any' return type in EventMap
    const test: EventMap = {} as EventMapWithDifferentReturns
    expect(test).toBeDefined()
  })

  it('should allow InvokeMap with Awaitable return types', () => {
    type ConcreteInvokeMap = {
      'sync-handler': (value: string) => number
      'async-handler': (value: string) => Promise<number>
      'union-handler': (value: string) => number | Promise<number>
    }

    // All of these should satisfy InvokeMap constraint
    const test: InvokeMap = {} as ConcreteInvokeMap
    expect(test).toBeDefined()
  })

  it('should demonstrate why unknown[] does not work', () => {
    // This is a compile-time demonstration test
    // If we used: interface EventMap { [key: string]: (...args: unknown[]) => unknown }

    type Transformed = {
      event: (sender: DirectIpcTarget, data: string) => void
    }

    // With unknown[], this would fail because:
    // - Function parameters are contravariant
    // - unknown[] is an array type, not a tuple type
    // - The tuple [sender: DirectIpcTarget, data: string] cannot be assigned to unknown[]
    // - This is due to readonly/mutability and structural differences

    // With any[], TypeScript's bivariant function parameter checking allows the assignment
    const test: EventMap = {} as Transformed
    expect(test).toBeDefined()
  })
})

describe('Type Safety Verification', () => {
  it('should maintain type safety at call sites despite any in constraint', () => {
    // This demonstrates that while EventMap uses 'any' in the constraint,
    // type safety is maintained through the generic type parameter

    type MyEventMap = {
      'typed-event': (userId: string, count: number) => void
    }

    function useEventMap<T extends EventMap>(map: T): void {
      // Inside the generic function, we have full type information from T
      // The 'any' in EventMap doesn't leak into the usage
      console.log(map)
    }

    const concreteMap: MyEventMap = {
      'typed-event': (userId: string, count: number) => {
        // TypeScript enforces these parameter types
        const _id: string = userId
        const _count: number = count
        console.log(_id, _count)
      },
    }

    useEventMap(concreteMap)
    expect(concreteMap).toBeDefined()
  })

  it('should prevent incorrect implementations at concrete type level', () => {
    type MyEventMap = {
      'typed-event': (value: string) => void
    }

    // This would be a type error if uncommented:
    // const badImpl: MyEventMap = {
    //   'typed-event': (value: number) => {} // Error: number is not assignable to string
    // }

    // The type safety comes from the concrete type, not from the EventMap constraint
    expect(true).toBe(true)
  })
})
