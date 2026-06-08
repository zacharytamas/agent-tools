import { Console, Effect } from 'effect'
import {
  type AddEntryOptions,
  addEntryProgram,
  type EditEntryOptions,
  editEntryProgram,
  listEntriesProgram,
  type MachineErrorEnvelope,
  machineCreateCommandProgram,
  machineListEntriesProgram,
  machineShowEntryProgram,
  machineUpdateCommandProgram,
  reopenTriageEntryProgram,
  resolveTriageEntryProgram,
  showEntryProgram,
  triageEntriesProgram,
} from './core.js'
import { SlogError } from './domain.js'
import type {
  FixedClock,
  IdGenerator,
  MachineInput,
  SlogConfig,
} from './environment.js'
import type { EntryRepository } from './storage.js'

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

export function editCommandProgram(
  options: EditEntryOptions,
): Effect.Effect<void, SlogError, EntryRepository> {
  return Effect.gen(function* () {
    yield* Console.log(yield* editEntryProgram(options))
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

export function triageCommandProgram(
  all: boolean,
): Effect.Effect<void, SlogError, FixedClock | EntryRepository> {
  return Effect.gen(function* () {
    yield* Console.log(yield* triageEntriesProgram({ all }))
  })
}

export function resolveTriageCommandProgram(
  id: string,
): Effect.Effect<void, SlogError, EntryRepository> {
  return Effect.gen(function* () {
    yield* Console.log(yield* resolveTriageEntryProgram(id))
  })
}

export function reopenTriageCommandProgram(
  id: string,
): Effect.Effect<void, SlogError, EntryRepository> {
  return Effect.gen(function* () {
    yield* Console.log(yield* reopenTriageEntryProgram(id))
  })
}
