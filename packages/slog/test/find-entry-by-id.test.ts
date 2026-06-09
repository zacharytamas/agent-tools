import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { findEntryById } from '../src/core.js'
import { type Entry, SlogError } from '../src/domain.js'
import {
  FixedClock,
  formatLocalIso,
  generateUlid,
  IdGenerator,
  MachineInput,
  SlogConfig,
} from '../src/environment.js'
import { EntryRepository } from '../src/storage.js'

const fixedNow = new Date('2026-06-05T14:52:00-04:00')
const laterNow = new Date('2026-06-05T15:05:00-04:00')
const fixedId = `${generateUlid(fixedNow).slice(0, 10)}ABCDEFABCDEFABCD`
const missingId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF0`

function entryFixture(overrides: Partial<Entry> = {}): Entry {
  return {
    id: fixedId,
    created_at: formatLocalIso(fixedNow),
    text: 'Original text',
    actor: 'zachary',
    authority: { source: 'zachary', mode: 'direct' },
    needs_triage: false,
    ...overrides,
  }
}

function testLayer(writes: Entry[]) {
  return Layer.mergeAll(
    Layer.succeed(SlogConfig, { home: '/tmp/unused-slog', user: 'zachary' }),
    Layer.succeed(FixedClock, { now: Effect.succeed(fixedNow) }),
    Layer.succeed(IdGenerator, { next: () => Effect.succeed(fixedId) }),
    Layer.succeed(MachineInput, { readAll: Effect.succeed('') }),
    Layer.succeed(EntryRepository, {
      append: () => Effect.void,
      listByCreatedAtDateRange: () => Effect.succeed([]),
      listToday: () => Effect.succeed(writes),
      listTriageToday: () => Effect.succeed([]),
      listAllTriage: () => Effect.succeed([]),
      findById: (id) => Effect.succeed(writes.find((entry) => entry.id === id)),
      updateExisting: () =>
        Effect.fail(new SlogError('entry_not_found', 'Not found.')),
      deleteById: () => Effect.void,
    }),
  )
}

describe('findEntryById', () => {
  test('returns Some(entry) when the id matches an existing entry', async () => {
    const entry = entryFixture({ text: 'Found via findEntryById' })
    const writes: Entry[] = [entry]

    const result = await Effect.runPromise(
      findEntryById(fixedId).pipe(Effect.provide(testLayer(writes))),
    )

    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrThrow(result)).toEqual(entry)
  })

  test('returns None when the id is a valid ULID but no entry exists', async () => {
    const result = await Effect.runPromise(
      findEntryById(missingId).pipe(Effect.provide(testLayer([]))),
    )

    expect(Option.isNone(result)).toBe(true)
  })

  test('fails with validation_failed SlogError when given an invalid ULID', async () => {
    await expect(
      Effect.runPromise(
        findEntryById('not-a-ulid').pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'id must be a full ULID.',
    })
  })

  test('does not fail when entry is missing — None is success not error', async () => {
    const resultEffect = findEntryById(missingId).pipe(
      Effect.provide(testLayer([])),
    )

    await expect(Effect.runPromise(resultEffect)).resolves.toBeDefined()
    const result = await Effect.runPromise(resultEffect)
    expect(Option.isNone(result)).toBe(true)
  })
})
