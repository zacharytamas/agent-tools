#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Effect, Layer, Option } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import {
  addCommandProgram,
  listCommandProgram,
  showCommandProgram,
} from './commands.js'
import {
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveSlogConfigLayer,
} from './environment.js'
import { LiveEntryRepositoryLayer } from './storage.js'

const text = Argument.string('text')
const id = Argument.string('id')
const triage = Flag.boolean('triage')
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

const app = Command.make('slog').pipe(
  Command.withSubcommands([add, list, show]),
)
const cli = Command.run(app, { version: '0.1.0' })

const LiveRepositoryWithConfigLayer = LiveEntryRepositoryLayer.pipe(
  Layer.provideMerge(LiveSlogConfigLayer),
)

const LiveLayer = Layer.mergeAll(
  LiveSlogConfigLayer,
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveRepositoryWithConfigLayer,
).pipe(Layer.provideMerge(BunServices.layer))

if (import.meta.main) {
  cli.pipe(Effect.provide(LiveLayer), BunRuntime.runMain)
}
