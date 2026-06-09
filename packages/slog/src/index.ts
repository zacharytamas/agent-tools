// --- Public adapter surface (frozen) ---
export {
  createEntry,
  deleteEntry,
  findEntryById,
  listEntries,
  updateEntry,
} from './core.js'
export type {
  CreateEntryAuthorityMode,
  CreateEntryInput,
  EntryFilter,
  MachineEntryEnvelope,
  MachineErrorEnvelope,
  MachineListEnvelope,
  MachineWarning,
  UpdateEntryInput,
  Warning,
} from './core.js'
export { SlogLive } from './live.js'
export { AuthorityMode, Authority, Entry, SlogError } from './domain.js'
export type { ValidationDetail } from './domain.js'

// --- Internal re-exports (CLI/tests) ---
export {
  addEntryProgram,
  editEntryProgram,
  listEntriesProgram,
  machineCreateCommandProgram,
  machineCreateEntryProgram,
  machineListEntriesProgram,
  machineShowEntryProgram,
  machineUpdateCommandProgram,
  machineUpdateEntryProgram,
  reopenTriageEntryProgram,
  resolveTriageEntryProgram,
  showEntryProgram,
  triageEntriesProgram,
} from './core.js'
export type { AddEntryOptions, EditEntryOptions } from './core.js'
export {
  addCommandProgram,
  editCommandProgram,
  listCommandProgram,
  machineCreateCliProgram,
  machineErrorEnvelope,
  machineListCliProgram,
  machineShowCliProgram,
  machineUpdateCliProgram,
  reopenTriageCommandProgram,
  resolveTriageCommandProgram,
  showCommandProgram,
  triageCommandProgram,
} from './cli-commands.js'
export {
  FixedClock,
  IdGenerator,
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveSlogConfigLayer,
  MachineInput,
  SlogConfig,
  decodeUlidTimestamp,
  formatLocalIso,
  generateUlid,
  localDateStamp,
  localTimeStamp,
  resolveSlogHome,
} from './environment.js'
export type {
  FixedClockShape,
  IdGeneratorShape,
  MachineInputShape,
  SlogConfigShape,
} from './environment.js'
export {
  renderHumanError,
  renderHumanList,
  renderHumanMutation,
  renderHumanShow,
  renderHumanTriageList,
} from './human.js'
export {
  EntryRepository,
  LiveEntryRepositoryLayer,
  dailyEntryPath,
} from './storage.js'
export type { EntryPatch, EntryRepositoryShape } from './storage.js'
export {
  LivePartitionLockLayer,
  PartitionLock,
  makeLivePartitionLockLayer,
  partitionLockPath,
} from './lock.js'
export type { PartitionLockOptions, PartitionLockShape } from './lock.js'
export {
  validateFullUlid,
  validateIdentity,
  validateOffsetTimestamp,
  validateText,
} from './domain.js'
