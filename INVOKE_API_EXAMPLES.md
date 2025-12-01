# Invoke API Examples

This document shows the improved invoke API with flexible timeout configuration.

## Basic Usage (No Timeout Override)

```typescript
// Uses the default timeout (5000ms)
const result = await directIpc.invokeIdentifier('worker', 'getData', arg1, arg2)
```

## Custom Timeout (Per-Call)

```typescript
// Override timeout for just this call
const result = await directIpc.invokeIdentifier(
  'worker',
  'getData',
  arg1,
  arg2,
  { timeout: 10000 }
)
```

## Global Default Timeout Configuration

### Option 1: Set at instance creation

```typescript
const directIpc = DirectIpcRenderer.instance<MyMessages>({
  identifier: 'my-window',
  defaultTimeout: 10000 // All invoke calls use 10s timeout by default
})

// This will use the 10s timeout
await directIpc.invokeIdentifier('worker', 'getData')
```

### Option 2: Update after instance creation

```typescript
const directIpc = DirectIpcRenderer.instance<MyMessages>({
  identifier: 'my-window'
})

// Change default timeout
directIpc.setDefaultTimeout(10000)

// This will use the 10s timeout
await directIpc.invokeIdentifier('worker', 'getData')
```

### Option 3: Set via instance() call (singleton pattern)

```typescript
// First call creates instance
const directIpc1 = DirectIpcRenderer.instance<MyMessages>({
  identifier: 'my-window'
})

// Later in the code, update timeout on the singleton
DirectIpcRenderer.instance<MyMessages>({
  defaultTimeout: 10000
})

// directIpc1 now uses 10s timeout
await directIpc1.invokeIdentifier('worker', 'getData')
```

## All Invoke Methods Support Options

```typescript
// invokeIdentifier
await directIpc.invokeIdentifier('worker', 'getData', arg1, { timeout: 10000 })

// invokeWebContentsId
await directIpc.invokeWebContentsId(12345, 'getData', arg1, { timeout: 10000 })

// invokeUrl
await directIpc.invokeUrl(/output/, 'getData', arg1, { timeout: 10000 })
```

## Works with Throttled API Too

```typescript
// The throttled wrapper automatically proxies invoke methods
await directIpc.throttled.invokeIdentifier(
  'worker',
  'getData',
  arg1,
  { timeout: 10000 }
)
```

## Type Safety

The options object is fully type-safe and optional:

```typescript
interface InvokeOptions {
  timeout?: number
}

// TypeScript knows the difference between args and options
await directIpc.invokeIdentifier(
  'worker',
  'getData',
  'arg1',          // ✓ String argument
  123,             // ✓ Number argument
  { timeout: 5000 } // ✓ Options object
)

await directIpc.invokeIdentifier(
  'worker',
  'getData',
  'arg1',
  { foo: 'bar' } // ✗ Type error: 'foo' not in InvokeOptions
)
```

## Checking Current Default

```typescript
const currentTimeout = directIpc.getDefaultTimeout() // Returns number (default: 5000)
```
