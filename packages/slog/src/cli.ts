#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Console, Effect, Layer, Option } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import {
  addCommandProgram,
  listCommandProgram,
  machineErrorEnvelope,
  machineCreateCliProgram,
  machineListCliProgram,
  machineShowCliProgram,
  showCommandProgram,
} from './commands.js'
import { SlogError } from './domain.js'
import {
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveSlogConfigLayer,
} from './environment.js'
import { LiveEntryRepositoryLayer } from './storage.js'

const text = Argument.string('text')
const id = Argument.string('id')
const triage = Flag.boolean('triage')
const json = Flag.boolean('json')
const jsonPayload = Flag.string('json').pipe(Flag.optional)
const occurredAt = Flag.string('occurred-at').pipe(Flag.optional)

const add = Command.make(
  'add',
  { triage, occurredAt, text },
  ({ triage, occurredAt, text }) =>
    addCommandProgram({
      text,
      needsTriage: triage,
      occurredAt: Option.getOrUndefined(occurredAt),
    }),
).pipe(Command.withDescription('Add a slog entry'))

const list = Command.make('list', {}, () => listCommandProgram()).pipe(
  Command.withDescription("List today's slog entries"),
)

const show = Command.make('show', { id }, ({ id }) =>
  showCommandProgram(id),
).pipe(Command.withDescription('Show a slog entry'))

const entryCreate = Command.make('create', { json: jsonPayload }, ({ json }) =>
  machineCreateCliProgram(Option.getOrUndefined(json)),
).pipe(Command.withDescription('Create a slog entry from machine JSON'))

const entryList = Command.make('list', { json }, ({ json }) =>
  machineListCliProgram(json),
).pipe(Command.withDescription('List slog entries as machine JSON'))

const entryShow = Command.make('show', { id, json }, ({ id, json }) =>
  machineShowCliProgram(id, json),
).pipe(Command.withDescription('Show a slog entry as machine JSON'))

const entry = Command.make('entry').pipe(
  Command.withSubcommands([entryCreate, entryList, entryShow]),
)

const app = Command.make('slog').pipe(
  Command.withSubcommands([add, list, show, entry]),
)
const cli = Command.run(app, { version: '0.1.0' })

const LiveRepositoryWithConfigLayer = LiveEntryRepositoryLayer.pipe(
  Layer.provideMerge(LiveSlogConfigLayer),
)

const LiveLayer = Layer.mergeAll(
  LiveSlogConfigLayer,
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveRepositoryWithConfigLayer,
).pipe(Layer.provideMerge(BunServices.layer))

if (import.meta.main) {
  const duplicateJsonError = duplicateEntryCreateJsonError(
    process.argv.slice(2),
  )

  if (duplicateJsonError) {
    Console.error(
      JSON.stringify(machineErrorEnvelope(duplicateJsonError)),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
      Effect.provide(BunServices.layer),
      BunRuntime.runMain,
    )
  } else {
    cli.pipe(Effect.provide(LiveLayer), BunRuntime.runMain)
  }
}

export function duplicateEntryCreateJsonError(
  args: ReadonlyArray<string>,
): SlogError | undefined {
  if (args[0] !== 'entry' || args[1] !== 'create') return undefined

  const jsonFlagCount = args.filter(
    (arg) => arg === '--json' || arg.startsWith('--json='),
  ).length
  if (jsonFlagCount <= 1) return undefined

  return new SlogError(
    'validation_failed',
    'entry create accepts exactly one --json payload source.',
    [
      {
        path: 'json',
        code: 'multiple_payload_sources',
        message:
          'Callers must not provide multiple JSON payload sources for the same command.',
      },
    ],
  )
}
