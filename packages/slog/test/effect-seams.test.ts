import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import {
  addEntryProgram,
  listEntriesProgram,
  showEntryProgram,
} from '../src/commands.js'
import type { Entry } from '../src/domain.js'
import {
  FixedClock,
  formatLocalIso,
  generateUlid,
  IdGenerator,
  SlogConfig,
} from '../src/environment.js'
import { EntryRepository } from '../src/storage.js'

const fixedNow = new Date('2026-06-05T14:52:00-04:00')
const laterNow = new Date('2026-06-05T15:05:00-04:00')
const fixedId = `${generateUlid(fixedNow).slice(0, 10)}ABCDEFABCDEFABCD`
const laterId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF`

function testLayer(writes: Entry[], now = fixedNow, id = fixedId) {
  return Layer.mergeAll(
    Layer.succeed(SlogConfig, { home: '/tmp/unused-slog', user: 'zachary' }),
    Layer.succeed(FixedClock, {
      now: Effect.succeed(now),
    }),
    Layer.succeed(IdGenerator, {
      next: () => Effect.succeed(id),
    }),
    Layer.succeed(EntryRepository, {
      append: (entry) => Effect.sync(() => writes.push(entry)),
      listToday: () => Effect.succeed(writes),
      findById: (entryId) =>
        Effect.succeed(writes.find((entry) => entry.id === entryId)),
    }),
  )
}

describe('slog Effect-native command programs', () => {
  test('add uses provided config, clock, id, and repository services', async () => {
    const writes: Entry[] = []

    const entry = await Effect.runPromise(
      addEntryProgram({ text: 'Reviewed Spencer PR', needsTriage: false }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(entry).toMatchObject({
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Reviewed Spencer PR',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    })
    expect(entry).not.toHaveProperty('occurred_at')
    expect(writes).toEqual([entry])
  })

  test('add supports triage and occurred_at', async () => {
    const writes: Entry[] = []

    const entry = await Effect.runPromise(
      addEntryProgram({
        text: 'Merged PR #123 this morning',
        needsTriage: true,
        occurredAt: '2026-06-05T10:42:00-04:00',
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(entry.needs_triage).toBe(true)
    expect(entry.occurred_at).toBe('2026-06-05T10:42:00-04:00')
    expect(writes[0]).toBe(entry)
  })

  test('add rejects impossible occurred_at calendar dates', async () => {
    await expect(
      Effect.runPromise(
        addEntryProgram({
          text: 'Should fail',
          needsTriage: false,
          occurredAt: '2026-02-30T10:00:00-04:00',
        }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toThrow('occurred_at must be a valid timestamp')
  })

  test('list renders today entries newest first with TRIAGE marker only when needed', async () => {
    const entries: Entry[] = [
      {
        id: fixedId,
        created_at: formatLocalIso(fixedNow),
        text: 'Reviewed Spencer PR',
        actor: 'zachary',
        authority: { source: 'zachary', mode: 'direct' },
        needs_triage: false,
      },
      {
        id: laterId,
        created_at: formatLocalIso(laterNow),
        text: 'Ask Laila about tenant fallback',
        actor: 'zachary',
        authority: { source: 'zachary', mode: 'direct' },
        needs_triage: true,
      },
    ]

    const output = await Effect.runPromise(
      listEntriesProgram().pipe(Effect.provide(testLayer(entries))),
    )

    expect(output).toContain(
      `TRIAGE  ${laterId}  Ask Laila about tenant fallback`,
    )
    expect(output).toContain(`${fixedId}  Reviewed Spencer PR`)
    expect(output).not.toContain(`TRIAGE  ${fixedId}`)
    expect(output.indexOf(laterId)).toBeLessThan(output.indexOf(fixedId))
  })

  test('show renders metadata, blank line, text, and omits Occurred when absent', async () => {
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Reviewed Spencer PR',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }

    const output = await Effect.runPromise(
      showEntryProgram(fixedId).pipe(Effect.provide(testLayer([entry]))),
    )

    expect(output).toContain(`ID:        ${fixedId}\n`)
    expect(output).toContain('Actor:     zachary\n')
    expect(output).toContain('Triage:    no\n\nReviewed Spencer PR\n')
    expect(output).not.toContain('Occurred:')
  })
})
