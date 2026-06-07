import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { duplicateEntryCreateJsonError } from '../src/cli.js'
import {
  addEntryProgram,
  listEntriesProgram,
  machineCreateCommandProgram,
  machineCreateEntryProgram,
  machineListEntriesProgram,
  machineShowEntryProgram,
  showEntryProgram,
} from '../src/commands.js'
import type { Entry } from '../src/domain.js'
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
const laterId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF`
const missingId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF0`

function testLayer(writes: Entry[], now = fixedNow, id = fixedId) {
  return Layer.mergeAll(
    Layer.succeed(SlogConfig, { home: '/tmp/unused-slog', user: 'zachary' }),
    Layer.succeed(FixedClock, {
      now: Effect.succeed(now),
    }),
    Layer.succeed(IdGenerator, {
      next: () => Effect.succeed(id),
    }),
    Layer.succeed(MachineInput, {
      readAll: Effect.succeed(
        JSON.stringify({
          text: 'Read JSON from stdin service',
          actor: 'stdin-agent',
          authority: { source: 'stdin-source', mode: 'delegated' },
          needs_triage: false,
        }),
      ),
    }),
    Layer.succeed(EntryRepository, {
      append: (entry) => Effect.sync(() => writes.push(entry)),
      listToday: () => Effect.succeed(writes),
      findById: (entryId) =>
        Effect.succeed(writes.find((entry) => entry.id === entryId)),
      updateExisting: (entryId, patch) =>
        Effect.sync(() => {
          const index = writes.findIndex((entry) => entry.id === entryId)
          if (index < 0) throw new Error('not implemented in command seam')
          const current = writes[index]
          const updated = {
            ...current,
            ...('text' in patch ? { text: patch.text } : {}),
            ...('needs_triage' in patch
              ? { needs_triage: patch.needs_triage }
              : {}),
            ...('occurred_at' in patch && patch.occurred_at !== null
              ? { occurred_at: patch.occurred_at }
              : {}),
          }
          if (patch.occurred_at === null) delete updated.occurred_at
          writes[index] = updated
          return updated
        }),
    }),
  )
}

describe('slog Effect-native command programs', () => {
  test('machine create JSON uses payload plus provided clock, id, and repository services', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      machineCreateEntryProgram(
        JSON.stringify({
          text: 'Reviewed Spencer PR',
          actor: 'assistant-agent',
          authority: { source: 'zachary', mode: 'delegated' },
          needs_triage: false,
          occurred_at: '2026-06-05T10:42:00-04:00',
        }),
      ).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result).toEqual({
      entry: {
        id: fixedId,
        created_at: formatLocalIso(fixedNow),
        occurred_at: '2026-06-05T10:42:00-04:00',
        text: 'Reviewed Spencer PR',
        actor: 'assistant-agent',
        authority: { source: 'zachary', mode: 'delegated' },
        needs_triage: false,
      },
      warnings: [],
    })
    expect(writes).toEqual([result.entry])
  })

  test('machine create command reads --json - from provided input service', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      machineCreateCommandProgram('-').pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry).toMatchObject({
      text: 'Read JSON from stdin service',
      actor: 'stdin-agent',
      authority: { source: 'stdin-source', mode: 'delegated' },
      needs_triage: false,
    })
    expect(result.warnings).toEqual([])
    expect(writes).toEqual([result.entry])
  })

  test('machine create JSON forces triage with warning for non-settleable modes', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      machineCreateEntryProgram(
        JSON.stringify({
          text: 'Observed flaky check',
          actor: 'ci-bot',
          authority: { source: 'ci', mode: 'observed' },
          needs_triage: false,
        }),
      ).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry.needs_triage).toBe(true)
    expect(result.warnings).toEqual([
      {
        code: 'needs_triage_forced',
        message: 'Only direct and delegated entries may be created as settled.',
      },
    ])
    expect(writes[0]).toBe(result.entry)
  })

  test('machine list JSON returns today entries newest first without rendering human text', async () => {
    const entries: Entry[] = [
      {
        id: fixedId,
        created_at: formatLocalIso(fixedNow),
        text: 'Older machine row',
        actor: 'zachary',
        authority: { source: 'zachary', mode: 'direct' },
        needs_triage: false,
      },
      {
        id: laterId,
        created_at: formatLocalIso(laterNow),
        text: 'Newer machine row',
        actor: 'zachary',
        authority: { source: 'zachary', mode: 'direct' },
        needs_triage: true,
      },
    ]

    const result = await Effect.runPromise(
      machineListEntriesProgram().pipe(Effect.provide(testLayer(entries))),
    )

    expect(result).toEqual({ entries: [entries[1], entries[0]], warnings: [] })
  })

  test('machine show JSON returns full-ULID entry envelope and structured not found errors', async () => {
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Machine show target',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }

    await expect(
      Effect.runPromise(
        machineShowEntryProgram('not-a-ulid').pipe(
          Effect.provide(testLayer([entry])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'id must be a full ULID.',
      details: [],
    })

    await expect(
      Effect.runPromise(
        machineShowEntryProgram(missingId).pipe(
          Effect.provide(testLayer([entry])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [],
    })

    await expect(
      Effect.runPromise(
        machineShowEntryProgram(fixedId).pipe(
          Effect.provide(testLayer([entry])),
        ),
      ),
    ).resolves.toEqual({ entry, warnings: [] })
  })

  test('machine create JSON rejects forbidden generated fields with validation details', async () => {
    await expect(
      Effect.runPromise(
        machineCreateEntryProgram(
          JSON.stringify({
            id: fixedId,
            created_at: '2026-06-05T14:52:00-04:00',
            text: 'Should fail',
            actor: 'assistant-agent',
            authority: { source: 'zachary', mode: 'delegated' },
          }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'Entry create payload failed validation.',
      details: [
        { path: 'id', code: 'forbidden_field' },
        { path: 'created_at', code: 'forbidden_field' },
      ],
    })
  })

  test('entry create preflight rejects duplicate --json payload sources', () => {
    const error = duplicateEntryCreateJsonError([
      'entry',
      'create',
      '--json',
      '{"text":"one"}',
      '--json',
      '{"text":"two"}',
    ])

    expect(error).toMatchObject({
      code: 'validation_failed',
      message: 'entry create accepts exactly one --json payload source.',
      details: [
        {
          path: 'json',
          code: 'multiple_payload_sources',
        },
      ],
    })
  })

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
