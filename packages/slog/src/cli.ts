#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Console, Effect, Layer, Option } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import {
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
import { SlogError } from './domain.js'
import {
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveSlogConfigLayer,
} from './environment.js'
import { renderHumanError } from './human.js'
import { LivePartitionLockLayer } from './lock.js'
import { LiveEntryRepositoryLayer } from './storage.js'

const text = Argument.string('text')
const id = Argument.string('id')
const triage = Flag.boolean('triage')
const clearOccurredAt = Flag.boolean('clear-occurred-at')
const all = Flag.boolean('all')
const json = Flag.boolean('json')
const jsonPayload = Flag.string('json').pipe(Flag.optional)
const editText = Flag.string('text').pipe(Flag.optional)
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

const edit = Command.make(
  'edit',
  { id, text: editText, occurredAt, clearOccurredAt },
  ({ id, text, occurredAt, clearOccurredAt }) =>
    editCommandProgram({
      id,
      text: Option.getOrUndefined(text),
      occurredAt: Option.getOrUndefined(occurredAt),
      clearOccurredAt,
    }),
).pipe(Command.withDescription('Edit a slog entry'))

const triageResolve = Command.make('resolve', { id }, ({ id }) =>
  resolveTriageCommandProgram(id),
).pipe(Command.withDescription('Resolve a triage entry (needs_triage=false)'))

const triageReopen = Command.make('reopen', { id }, ({ id }) =>
  reopenTriageCommandProgram(id),
).pipe(Command.withDescription('Reopen a triage entry (needs_triage=true)'))

// `triage` is both a leaf (list today, or --all across partitions) and a
// parent for resolve/reopen. effect/unstable/cli runs this command's own
// handler when invoked with no subcommand, and dispatches to the subcommand
// otherwise; verified by CLI smoke.
const triageCommand = Command.make('triage', { all }, ({ all }) =>
  triageCommandProgram(all),
)
  .pipe(Command.withDescription('List triage entries (today by default)'))
  .pipe(Command.withSubcommands([triageResolve, triageReopen]))

const entryCreate = Command.make('create', { json: jsonPayload }, ({ json }) =>
  machineCreateCliProgram(Option.getOrUndefined(json)),
).pipe(Command.withDescription('Create a slog entry from machine JSON'))

const entryUpdate = Command.make('update', { json: jsonPayload }, ({ json }) =>
  machineUpdateCliProgram(Option.getOrUndefined(json)),
).pipe(Command.withDescription('Update a slog entry from machine JSON'))

const entryList = Command.make('list', { json }, ({ json }) =>
  machineListCliProgram(json),
).pipe(Command.withDescription('List slog entries as machine JSON'))

const entryShow = Command.make('show', { id, json }, ({ id, json }) =>
  machineShowCliProgram(id, json),
).pipe(Command.withDescription('Show a slog entry as machine JSON'))

const entry = Command.make('entry').pipe(
  Command.withSubcommands([entryCreate, entryUpdate, entryList, entryShow]),
)

const app = Command.make('slog').pipe(
  Command.withSubcommands([add, list, show, edit, triageCommand, entry]),
)
const cli = Command.run(app, { version: '0.1.0' })

const LiveRepositoryWithConfigLayer = LiveEntryRepositoryLayer.pipe(
  Layer.provideMerge(LivePartitionLockLayer),
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
  const duplicateJsonError = duplicateEntryJsonError(process.argv.slice(2))

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
    cli.pipe(
      Effect.provide(LiveLayer),
      Effect.catch((error) =>
        error instanceof SlogError
          ? Effect.gen(function* () {
              yield* Console.error(renderHumanError(error))
              yield* Effect.sync(() => {
                process.exitCode = 1
              })
            })
          : Effect.fail(error),
      ),
      BunRuntime.runMain,
    )
  }
}

export function duplicateEntryJsonError(
  args: ReadonlyArray<string>,
): SlogError | undefined {
  if (args[0] !== 'entry') return undefined
  const command = args[1]
  if (command !== 'create' && command !== 'update') return undefined

  const jsonFlagCount = args.filter(
    (arg) => arg === '--json' || arg.startsWith('--json='),
  ).length
  if (jsonFlagCount <= 1) return undefined

  return new SlogError(
    'validation_failed',
    `entry ${command} accepts exactly one --json payload source.`,
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

export const duplicateEntryCreateJsonError = duplicateEntryJsonError
