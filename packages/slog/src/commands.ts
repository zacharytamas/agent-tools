import { Console, Effect } from 'effect'
import type { AuthorityMode, ValidationDetail } from './domain.js'
import {
  Entry,
  SlogError,
  validateFullUlid,
  validateIdentity,
  validateOffsetTimestamp,
  validateText,
} from './domain.js'
import {
  FixedClock,
  formatLocalIso,
  IdGenerator,
  MachineInput,
  SlogConfig,
} from './environment.js'
import { renderHumanList, renderHumanShow } from './human.js'
import { type EntryPatch, EntryRepository } from './storage.js'

export interface AddEntryOptions {
  readonly text: string
  readonly needsTriage: boolean
  readonly occurredAt?: string | undefined
}

export interface MachineWarning {
  readonly code: string
  readonly message: string
}

export interface MachineEntryEnvelope {
  readonly entry: Entry
  readonly warnings: ReadonlyArray<MachineWarning>
}

export interface MachineListEnvelope {
  readonly entries: ReadonlyArray<Entry>
  readonly warnings: ReadonlyArray<MachineWarning>
}

export interface MachineErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: ReadonlyArray<ValidationDetail>
  }
}

interface MachineCreatePayload {
  readonly text: string
  readonly actor: string
  readonly authority: {
    readonly source: string
    readonly mode: AuthorityMode
  }
  readonly needs_triage?: boolean | undefined
  readonly occurred_at?: string | undefined
}

interface MachineUpdatePayload {
  readonly id: string
  readonly patch: EntryPatch
}

export const addEntryProgram = Effect.fn('slog.addEntry')(function* (
  options: AddEntryOptions,
) {
  const config = yield* SlogConfig
  const clock = yield* FixedClock
  const ids = yield* IdGenerator
  const repo = yield* EntryRepository
  const now = yield* clock.now

  const entry = new Entry({
    id: validateFullUlid(yield* ids.next(now)),
    created_at: formatLocalIso(now),
    ...(options.occurredAt !== undefined
      ? {
          occurred_at: validateOffsetTimestamp(
            options.occurredAt,
            'occurred_at',
          ),
        }
      : {}),
    text: validateText(options.text),
    actor: config.user,
    authority: { source: config.user, mode: 'direct' },
    needs_triage: options.needsTriage,
  })

  yield* repo.append(entry)
  return entry
})

export const machineCreateEntryProgram = Effect.fn('slog.machineCreateEntry')(
  function* (payloadText: string) {
    const payload = yield* Effect.try({
      try: () => parseMachineCreatePayload(payloadText),
      catch: normalizeSlogError,
    })
    const clock = yield* FixedClock
    const ids = yield* IdGenerator
    const repo = yield* EntryRepository
    const now = yield* clock.now
    const warnings: MachineWarning[] = []
    let needsTriage = payload.needs_triage ?? true

    if (
      needsTriage === false &&
      payload.authority.mode !== 'direct' &&
      payload.authority.mode !== 'delegated'
    ) {
      needsTriage = true
      warnings.push({
        code: 'needs_triage_forced',
        message: 'Only direct and delegated entries may be created as settled.',
      })
    }

    const entry = new Entry({
      id: validateFullUlid(yield* ids.next(now)),
      created_at: formatLocalIso(now),
      ...(payload.occurred_at !== undefined
        ? { occurred_at: payload.occurred_at }
        : {}),
      text: payload.text,
      actor: payload.actor,
      authority: payload.authority,
      needs_triage: needsTriage,
    })

    yield* repo.append(entry)
    return { entry, warnings }
  },
)

export const machineCreateCommandProgram = Effect.fn(
  'slog.machineCreateCommand',
)(function* (jsonPayload: string) {
  const payloadText =
    jsonPayload === '-' ? yield* (yield* MachineInput).readAll : jsonPayload
  return yield* machineCreateEntryProgram(payloadText)
})

export const machineUpdateEntryProgram = Effect.fn('slog.machineUpdateEntry')(
  function* (payloadText: string) {
    const payload = yield* Effect.try({
      try: () => parseMachineUpdatePayload(payloadText),
      catch: normalizeSlogError,
    })
    const repo = yield* EntryRepository
    const entry = yield* repo.updateExisting(payload.id, payload.patch)
    return { entry, warnings: [] }
  },
)

export const machineUpdateCommandProgram = Effect.fn(
  'slog.machineUpdateCommand',
)(function* (jsonPayload: string) {
  const payloadText =
    jsonPayload === '-' ? yield* (yield* MachineInput).readAll : jsonPayload
  return yield* machineUpdateEntryProgram(payloadText)
})

export const listEntriesProgram = Effect.fn('slog.listEntries')(function* () {
  const clock = yield* FixedClock
  const repo = yield* EntryRepository
  const now = yield* clock.now
  const entries = yield* repo.listToday(now)
  return renderHumanList(
    now,
    [...entries].sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at),
    ),
  )
})

export const machineListEntriesProgram = Effect.fn('slog.machineListEntries')(
  function* () {
    const clock = yield* FixedClock
    const repo = yield* EntryRepository
    const now = yield* clock.now
    const entries = yield* repo.listToday(now)
    return {
      entries: [...entries].sort(
        (left, right) =>
          Date.parse(right.created_at) - Date.parse(left.created_at),
      ),
      warnings: [],
    }
  },
)

export const showEntryProgram = Effect.fn('slog.showEntry')(function* (
  id: string,
) {
  const entry = yield* findEntryByFullId(id)
  return renderHumanShow(entry)
})

export const machineShowEntryProgram = Effect.fn('slog.machineShowEntry')(
  function* (id: string) {
    const entry = yield* findEntryByFullId(id)
    return { entry, warnings: [] }
  },
)

export function machineCreateCliProgram(
  jsonPayload: string | undefined,
): Effect.Effect<
  void,
  never,
  FixedClock | IdGenerator | EntryRepository | MachineInput
> {
  return jsonPayload === undefined
    ? writeMachineJson(
        Effect.fail(
          new SlogError('validation_failed', 'entry create requires --json.'),
        ),
      )
    : writeMachineJson(machineCreateCommandProgram(jsonPayload))
}

export function machineUpdateCliProgram(
  jsonPayload: string | undefined,
): Effect.Effect<void, never, EntryRepository | MachineInput> {
  return jsonPayload === undefined
    ? writeMachineJson(
        Effect.fail(
          new SlogError('validation_failed', 'entry update requires --json.'),
        ),
      )
    : writeMachineJson(machineUpdateCommandProgram(jsonPayload))
}

export function machineListCliProgram(
  json: boolean,
): Effect.Effect<void, never, FixedClock | EntryRepository> {
  return json
    ? writeMachineJson(machineListEntriesProgram())
    : writeMachineJson(
        Effect.fail(
          new SlogError('validation_failed', 'entry list requires --json.'),
        ),
      )
}

export function machineShowCliProgram(
  id: string,
  json: boolean,
): Effect.Effect<void, never, EntryRepository> {
  return json
    ? writeMachineJson(machineShowEntryProgram(id))
    : writeMachineJson(
        Effect.fail(
          new SlogError('validation_failed', 'entry show requires --json.'),
        ),
      )
}

export function machineErrorEnvelope(error: SlogError): MachineErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }
}

function writeMachineJson<A, R>(
  effect: Effect.Effect<A, SlogError, R>,
): Effect.Effect<void, never, R> {
  return effect.pipe(
    Effect.flatMap((value) => Console.log(JSON.stringify(value))),
    Effect.catch((error: SlogError) =>
      Effect.gen(function* () {
        yield* Console.error(JSON.stringify(machineErrorEnvelope(error)))
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }),
    ),
  )
}

const findEntryByFullId = Effect.fn('slog.findEntryByFullId')(function* (
  id: string,
) {
  const repo = yield* EntryRepository
  const fullId = yield* Effect.try({
    try: () => validateFullUlid(id),
    catch: normalizeSlogError,
  })
  const entry = yield* repo.findById(fullId)
  if (!entry) {
    return yield* Effect.fail(
      new SlogError('entry_not_found', 'No entry exists with the supplied id.'),
    )
  }
  return entry
})

function parseMachineCreatePayload(payloadText: string): MachineCreatePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadText)
  } catch {
    throw validationFailed([
      {
        path: '',
        code: 'invalid_json',
        message: 'Payload must be valid JSON.',
      },
    ])
  }

  if (!isPlainRecord(parsed)) {
    throw validationFailed([
      {
        path: '',
        code: 'invalid_type',
        message: 'Payload must be a single JSON object.',
      },
    ])
  }

  const details: ValidationDetail[] = []

  if ('id' in parsed) {
    details.push({
      path: 'id',
      code: 'forbidden_field',
      message: 'id is generated by the CLI and must not be supplied.',
    })
  }
  if ('created_at' in parsed) {
    details.push({
      path: 'created_at',
      code: 'forbidden_field',
      message: 'created_at is generated by the CLI and must not be supplied.',
    })
  }

  const text = readString(parsed, 'text', details)
  const actor = readIdentity(parsed, 'actor', details)
  const authorityValue = parsed.authority
  let authoritySource: string | undefined
  let authorityMode: AuthorityMode | undefined
  if (!isPlainRecord(authorityValue)) {
    details.push({
      path: 'authority',
      code: 'invalid_type',
      message: 'authority must be an object.',
    })
  } else {
    authoritySource = readIdentityAt(
      authorityValue,
      'source',
      'authority.source',
      details,
    )
    const mode = authorityValue.mode
    if (typeof mode !== 'string' || !isAuthorityMode(mode)) {
      details.push({
        path: 'authority.mode',
        code: 'invalid_value',
        message:
          'authority.mode must be one of direct, delegated, discretionary, observed, imported, derived.',
      })
    } else {
      authorityMode = mode
    }
  }

  const needsTriageValue = parsed.needs_triage
  if (needsTriageValue !== undefined && typeof needsTriageValue !== 'boolean') {
    details.push({
      path: 'needs_triage',
      code: 'invalid_type',
      message: 'needs_triage must be a boolean when supplied.',
    })
  }

  const occurredAtValue = parsed.occurred_at
  let occurredAt: string | undefined
  if (occurredAtValue !== undefined) {
    if (typeof occurredAtValue !== 'string') {
      details.push({
        path: 'occurred_at',
        code: 'invalid_type',
        message: 'occurred_at must be a string when supplied.',
      })
    } else {
      try {
        occurredAt = validateOffsetTimestamp(occurredAtValue, 'occurred_at')
      } catch (cause) {
        details.push({
          path: 'occurred_at',
          code: 'invalid_timestamp',
          message:
            cause instanceof Error
              ? cause.message
              : 'occurred_at must be a valid timestamp.',
        })
      }
    }
  }

  if (details.length > 0) throw validationFailed(details)

  return {
    text: text!,
    actor: actor!,
    authority: { source: authoritySource!, mode: authorityMode! },
    ...(typeof needsTriageValue === 'boolean'
      ? { needs_triage: needsTriageValue }
      : {}),
    ...(occurredAt !== undefined ? { occurred_at: occurredAt } : {}),
  }
}

function parseMachineUpdatePayload(payloadText: string): MachineUpdatePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadText)
  } catch {
    throw updateValidationFailed([
      {
        path: '',
        code: 'invalid_json',
        message: 'Payload must be valid JSON.',
      },
    ])
  }

  if (!isPlainRecord(parsed)) {
    throw updateValidationFailed([
      {
        path: '',
        code: 'invalid_type',
        message: 'Payload must be a single JSON object.',
      },
    ])
  }

  const details: ValidationDetail[] = []

  for (const key of Object.keys(parsed)) {
    if (key !== 'id' && key !== 'changes') {
      details.push({
        path: key,
        code: 'unknown_field',
        message: 'Only id and changes may be supplied.',
      })
    }
  }

  const id = readFullUlid(parsed, 'id', details)
  const changesValue = parsed.changes
  let patch: EntryPatch = {}

  if (!isPlainRecord(changesValue)) {
    details.push({
      path: 'changes',
      code: 'invalid_type',
      message: 'changes must be an object.',
    })
  } else {
    patch = readMachineUpdateChanges(changesValue, details)
  }

  if (details.length > 0) throw updateValidationFailed(details)
  if (id === undefined) {
    throw updateValidationFailed([
      {
        path: 'id',
        code: 'invalid_id',
        message: 'id must be a full ULID.',
      },
    ])
  }

  return { id, patch }
}

function readMachineUpdateChanges(
  changes: Record<string, unknown>,
  details: ValidationDetail[],
): EntryPatch {
  let patch: EntryPatch = {}
  let allowedChangeCount = 0

  for (const key of Object.keys(changes)) {
    if (isMachineUpdateChangeKey(key)) {
      allowedChangeCount += 1
      continue
    }

    details.push({
      path: `changes.${key}`,
      code: isMachineUpdateForbiddenKey(key)
        ? 'forbidden_field'
        : 'unknown_field',
      message: 'Only text, occurred_at, and needs_triage may be changed.',
    })
  }

  if (allowedChangeCount === 0) {
    details.push({
      path: 'changes',
      code: 'missing_change',
      message:
        'changes must include at least one of text, occurred_at, or needs_triage.',
    })
  }

  if ('text' in changes) {
    const text = readTextAt(changes, 'text', 'changes.text', details)
    if (text !== undefined) patch = { ...patch, text }
  }

  if ('occurred_at' in changes) {
    const occurredAtValue = changes.occurred_at
    if (occurredAtValue === null) {
      patch = { ...patch, occurred_at: null }
    } else if (typeof occurredAtValue !== 'string') {
      details.push({
        path: 'changes.occurred_at',
        code: 'invalid_type',
        message: 'changes.occurred_at must be a string or null.',
      })
    } else {
      try {
        patch = {
          ...patch,
          occurred_at: validateOffsetTimestamp(
            occurredAtValue,
            'changes.occurred_at',
          ),
        }
      } catch (cause) {
        details.push({
          path: 'changes.occurred_at',
          code: 'invalid_timestamp',
          message:
            cause instanceof Error
              ? cause.message
              : 'changes.occurred_at must be a valid timestamp.',
        })
      }
    }
  }

  if ('needs_triage' in changes) {
    const needsTriageValue = changes.needs_triage
    if (typeof needsTriageValue !== 'boolean') {
      details.push({
        path: 'changes.needs_triage',
        code: 'invalid_type',
        message: 'changes.needs_triage must be a boolean.',
      })
    } else {
      patch = { ...patch, needs_triage: needsTriageValue }
    }
  }

  return patch
}

function readFullUlid(
  record: Record<string, unknown>,
  path: string,
  details: ValidationDetail[],
): string | undefined {
  const value = record[path]
  if (typeof value !== 'string') {
    details.push({
      path,
      code: 'invalid_type',
      message: `${path} must be a string.`,
    })
    return undefined
  }
  try {
    return validateFullUlid(value)
  } catch (cause) {
    details.push({
      path,
      code: 'invalid_id',
      message: cause instanceof Error ? cause.message : `${path} is invalid.`,
    })
    return undefined
  }
}

function readTextAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  details: ValidationDetail[],
): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    details.push({
      path,
      code: 'invalid_type',
      message: `${path} must be a string.`,
    })
    return undefined
  }
  try {
    return validateText(value)
  } catch (cause) {
    details.push({
      path,
      code: 'empty',
      message: cause instanceof Error ? cause.message : `${path} is invalid.`,
    })
    return undefined
  }
}

function isMachineUpdateChangeKey(
  value: string,
): value is 'text' | 'occurred_at' | 'needs_triage' {
  return value === 'text' || value === 'occurred_at' || value === 'needs_triage'
}

function isMachineUpdateForbiddenKey(value: string): boolean {
  return (
    value === 'id' ||
    value === 'created_at' ||
    value === 'actor' ||
    value === 'authority' ||
    value === 'authority.source' ||
    value === 'authority.mode'
  )
}

function readString(
  record: Record<string, unknown>,
  path: string,
  details: ValidationDetail[],
): string | undefined {
  const value = record[path]
  if (typeof value !== 'string') {
    details.push({
      path,
      code: 'invalid_type',
      message: `${path} must be a string.`,
    })
    return undefined
  }
  try {
    return validateText(value)
  } catch (cause) {
    details.push({
      path,
      code: 'empty',
      message: cause instanceof Error ? cause.message : `${path} is invalid.`,
    })
    return undefined
  }
}

function readIdentity(
  record: Record<string, unknown>,
  path: string,
  details: ValidationDetail[],
): string | undefined {
  return readIdentityAt(record, path, path, details)
}

function readIdentityAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  details: ValidationDetail[],
): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    details.push({
      path,
      code: 'invalid_type',
      message: `${path} must be a string.`,
    })
    return undefined
  }
  try {
    return validateIdentity(value, path)
  } catch (cause) {
    details.push({
      path,
      code: 'invalid_identity',
      message: cause instanceof Error ? cause.message : `${path} is invalid.`,
    })
    return undefined
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthorityMode(value: string): value is AuthorityMode {
  return (
    value === 'direct' ||
    value === 'delegated' ||
    value === 'discretionary' ||
    value === 'observed' ||
    value === 'imported' ||
    value === 'derived'
  )
}

function normalizeSlogError(cause: unknown): SlogError {
  return cause instanceof SlogError
    ? cause
    : new SlogError(
        'validation_failed',
        cause instanceof Error ? cause.message : String(cause),
      )
}

function validationFailed(details: ReadonlyArray<ValidationDetail>): SlogError {
  return new SlogError(
    'validation_failed',
    'Entry create payload failed validation.',
    details,
  )
}

function updateValidationFailed(
  details: ReadonlyArray<ValidationDetail>,
): SlogError {
  return new SlogError(
    'validation_failed',
    'Entry update payload failed validation.',
    details,
  )
}

export function addCommandProgram(
  options: AddEntryOptions,
): Effect.Effect<
  void,
  SlogError,
  SlogConfig | FixedClock | IdGenerator | EntryRepository
> {
  return Effect.gen(function* () {
    const entry = yield* addEntryProgram(options)
    yield* Console.log(entry.id)
  })
}

export function listCommandProgram(): Effect.Effect<
  void,
  SlogError,
  FixedClock | EntryRepository
> {
  return Effect.gen(function* () {
    yield* Console.log(yield* listEntriesProgram())
  })
}

export function showCommandProgram(
  id: string,
): Effect.Effect<void, SlogError, EntryRepository> {
  return Effect.gen(function* () {
    yield* Console.log(yield* showEntryProgram(id))
  })
}
