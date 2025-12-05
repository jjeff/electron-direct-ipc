/**
 * Shared type definitions for DirectIpc library
 */

import { DirectIpcTarget } from './DirectIpcCommunication.js'

/**
 * Type that can be either a synchronous value or a Promise
 */
export type Awaitable<T> = T | Promise<T>

/**
 * Utility type to expand/prettify complex types in IDE tooltips
 */
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

/**
 * Base constraint for event handler maps.
 * Maps event names to handler function signatures.
 *
 * IMPORTANT: The use of `any` here is intentional and necessary for proper type system behavior:
 *
 * 1. **Variance Requirements**: Function parameters are contravariant. Using `unknown[]` or
 *    `readonly unknown[]` causes type incompatibility with transformed types like `WithSender<T>`
 *    which prepends named parameters to the function signature.
 *
 * 2. **Type Inference**: `any[]` allows TypeScript's type inference to flow bidirectionally:
 *    - From concrete implementations (e.g., `{ 'user-updated': (userId: string) => void }`)
 *    - Through generic constraints (e.g., `TMessageMap extends EventMap`)
 *    - To call sites and type transformations
 *
 * 3. **Constraint Satisfaction**: Types with named parameters like
 *    `(sender: DirectIpcTarget, userId: string) => void` must satisfy this constraint.
 *    Only `any[]` allows this due to how TypeScript handles tuple vs array variance.
 *
 * This is a legitimate use case for `any` in generic constraints. The actual type safety
 * comes from the concrete generic type parameter, not from the constraint itself.
 *
 * See docs/EventMap-Any-Justification.md for detailed explanation.
 */
export interface EventMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => any
}

/**
 * Base constraint for invoke handler maps.
 * Maps channel names to handler function signatures that return Awaitable values.
 *
 * Uses the same constraint pattern as EventMap for consistent variance behavior.
 * See EventMap documentation for justification of `any` usage.
 */
export interface InvokeMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => Awaitable<any>
}

/**
 * Options for invoke calls
 */
export interface InvokeOptions {
  timeout?: number
}

/**
 * Target selector for send() and invoke() methods
 * Specifies which process(es) to communicate with
 *
 * @template TId - Union of allowed identifier strings
 */
export type TargetSelector<TId extends string = string> =
  | { identifier: TId | RegExp }
  | { webContentsId: number }
  | { url: string | RegExp }
  | { allIdentifiers: TId | RegExp }
  | { allUrls: string | RegExp }

/**
 * Message format for regular DirectIpc messages
 * args is the tuple of arguments expected by the event handler (Parameters<> of the handler function)
 */
export type DirectIpcMessage<
  TMessageMap extends EventMap = EventMap,
  K extends keyof TMessageMap = keyof TMessageMap,
> = {
  message: K
  args: Parameters<TMessageMap[K]>
}

/**
 * Message format for invoke/handle pattern
 */
export type InvokeMessage = {
  type: 'invoke'
  channel: string
  requestId: string
  args: unknown[]
}

/**
 * Response format for invoke/handle pattern
 */
export type InvokeResponse = {
  type: 'invoke-response'
  requestId: string
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Handler function type for invoke/handle pattern
 */
export type InvokeHandler<T extends InvokeMap = InvokeMap> = (
  ...args: Parameters<T[keyof T]>
) => Promise<ReturnType<T[keyof T]>> | ReturnType<T[keyof T]>

/**
 * Prepends 'sender: DirectIpcTarget' to every handler function in an EventMap.
 * Used to transform handler signatures when receiving messages from other processes.
 */
export type WithSender<T extends EventMap> = {
  [K in keyof T]: (
    sender: DirectIpcTarget,
    ...args: Parameters<T[K]>
  ) => ReturnType<T[K]>
}

/**
 * Type-safe event emitter interface
 * Provides strongly-typed event registration and emission
 */
export interface TypedEventEmitter<Events extends EventMap> {
  addListener<E extends keyof Events>(event: E, listener: Events[E]): this
  on<E extends keyof Events>(event: E, listener: Events[E]): this
  once<E extends keyof Events>(event: E, listener: Events[E]): this
  prependListener<E extends keyof Events>(event: E, listener: Events[E]): this
  prependOnceListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): this

  off<E extends keyof Events>(event: E, listener: Events[E]): this
  removeAllListeners<E extends keyof Events>(event?: E): this
  removeListener<E extends keyof Events>(event: E, listener: Events[E]): this
  emit<Event extends keyof Events>(
    event: Event | Event[],
    ...values: Parameters<Events[Event]>
  ): boolean
  // The sloppy `eventNames()` return type is to mitigate type incompatibilities - see #5
  eventNames(): (keyof Events | string | symbol)[]
  rawListeners<E extends keyof Events>(event: E): Events[E][]
  listeners<E extends keyof Events>(event: E): Events[E][]
  listenerCount<E extends keyof Events>(event: E): number

  getMaxListeners(): number
  setMaxListeners(maxListeners: number): this
}
