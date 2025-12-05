/**
 * Error classes for electron-direct-ipc utility process support
 */

import { ProcessType } from '../common/DirectIpcCommunication'

/**
 * Thrown when attempting to register a utility process with a duplicate identifier.
 */
export class IdentifierConflictError extends Error {
  public readonly existingType: ProcessType

  constructor(identifier: string, existingType: ProcessType) {
    super(`Identifier "${identifier}" already in use by ${existingType}`)
    this.name = 'IdentifierConflictError'
    this.existingType = existingType
  }
}

/**
 * Thrown when attempting to send/invoke a utility process that doesn't exist.
 */
export class UtilityProcessNotFoundError extends Error {
  public readonly identifier: string

  constructor(identifier: string) {
    super(`Utility process not found: ${identifier}`)
    this.name = 'UtilityProcessNotFoundError'
    this.identifier = identifier
  }
}

/**
 * Thrown when a utility process terminates unexpectedly during an invoke.
 */
export class UtilityProcessTerminatedError extends Error {
  public readonly identifier: string

  constructor(identifier: string) {
    super(`Process terminated unexpectedly: ${identifier}`)
    this.name = 'UtilityProcessTerminatedError'
    this.identifier = identifier
  }
}

/**
 * Thrown when utility process registration times out.
 */
export class RegistrationTimeoutError extends Error {
  public readonly identifier: string
  public readonly timeoutMs: number

  constructor(identifier: string, timeoutMs: number) {
    super(`Utility process registration timed out after ${timeoutMs}ms: ${identifier}`)
    this.name = 'RegistrationTimeoutError'
    this.identifier = identifier
    this.timeoutMs = timeoutMs
  }
}
