import { Console, Effect } from 'effect'
import {
  Entry,
  SlogError,
  validateFullUlid,
  validateOffsetTimestamp,
  validateText,
} from './domain.js'
import {
  FixedClock,
  formatLocalIso,
  IdGenerator,
  SlogConfig,
} from './environment.js'
import { renderHumanList, renderHumanShow } from './human.js'
import { EntryRepository } from './storage.js'

export interface AddEntryOptions {
  readonly text: string
  readonly needsTriage: boolean
  readonly occurredAt?: string | undefined
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

export const showEntryProgram = Effect.fn('slog.showEntry')(function* (
  id: string,
) {
  const repo = yield* EntryRepository
  const fullId = validateFullUlid(id)
  const entry = yield* repo.findById(fullId)
  if (!entry) {
    return yield* Effect.fail(
      new SlogError('entry_not_found', 'No entry exists with the supplied id.'),
    )
  }
  return renderHumanShow(entry)
})

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
