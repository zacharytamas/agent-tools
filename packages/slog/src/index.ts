// --- Public adapter surface (frozen) ---

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
export type {
  AddEntryOptions,
  CreateEntryAuthorityMode,
  CreateEntryInput,
  EditEntryOptions,
  EntryFilter,
  MachineEntryEnvelope,
  MachineErrorEnvelope,
  MachineListEnvelope,
  MachineWarning,
  UpdateEntryInput,
  Warning,
} from './core.js'
export {
  addEntryProgram,
  createEntry,
  deleteEntry,
  editEntryProgram,
  findEntryById,
  listEntries,
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
  updateEntry,
} from './core.js'
export type { ValidationDetail } from './domain.js'
export {
  Authority,
  AuthorityMode,
  Entry,
  SlogError,
  validateFullUlid,
  validateIdentity,
  validateOffsetTimestamp,
  validateText,
} from './domain.js'
export type {
  FixedClockShape,
  IdGeneratorShape,
  MachineInputShape,
  SlogConfigShape,
} from './environment.js'
export {
  decodeUlidTimestamp,
  FixedClock,
  formatLocalIso,
  generateUlid,
  IdGenerator,
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveSlogConfigLayer,
  localDateStamp,
  localTimeStamp,
  MachineInput,
  resolveSlogHome,
  SlogConfig,
} from './environment.js'
export {
  renderHumanError,
  renderHumanList,
  renderHumanMutation,
  renderHumanShow,
  renderHumanTriageList,
} from './human.js'
export { SlogLive } from './live.js'
export type { PartitionLockOptions, PartitionLockShape } from './lock.js'
export {
  LivePartitionLockLayer,
  makeLivePartitionLockLayer,
  PartitionLock,
  partitionLockPath,
} from './lock.js'
export type { EntryPatch, EntryRepositoryShape } from './storage.js'
export {
  dailyEntryPath,
  EntryRepository,
  LiveEntryRepositoryLayer,
} from './storage.js'
