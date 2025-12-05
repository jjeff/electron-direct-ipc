/**
 * electron-direct-ipc/utility
 *
 * Public API for utility process support
 */

export { DirectIpcUtility } from './DirectIpcUtility.js'
export type {
  DirectIpcUtilityOptions,
  RegistrationState,
  QueuedMessage,
} from './DirectIpcUtility.js'

export type {
  EventMap,
  InvokeMap,
  InvokeOptions,
  TargetSelector,
  DirectIpcEventMap,
} from '../common/index.js'

export {
  IdentifierConflictError,
  UtilityProcessNotFoundError,
  UtilityProcessTerminatedError,
  RegistrationTimeoutError,
} from './errors.js'
