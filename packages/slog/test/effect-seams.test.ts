import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { duplicateEntryJsonError } from '../src/cli.js'
import {
  addEntryProgram,
  listEntriesProgram,
  machineCreateCommandProgram,
  machineCreateEntryProgram,
  machineErrorEnvelope,
  machineListEntriesProgram,
  machineShowEntryProgram,
  machineUpdateCommandProgram,
  machineUpdateEntryProgram,
  showEntryProgram,
} from '../src/commands.js'
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
const laterId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF`
const missingId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF0`

function testLayer(
  writes: Entry[],
  now = fixedNow,
  id = fixedId,
  inputPayload = JSON.stringify({
    text: 'Read JSON from stdin service',
    actor: 'stdin-agent',
    authority: { source: 'stdin-source', mode: 'delegated' },
    needs_triage: false,
  }),
) {
  return Layer.mergeAll(
    Layer.succeed(SlogConfig, { home: '/tmp/unused-slog', user: 'zachary' }),
    Layer.succeed(FixedClock, {
      now: Effect.succeed(now),
    }),
    Layer.succeed(IdGenerator, {
      next: () => Effect.succeed(id),
    }),
    Layer.succeed(MachineInput, {
      readAll: Effect.succeed(inputPayload),
    }),
    Layer.succeed(EntryRepository, {
      append: (entry) => Effect.sync(() => writes.push(entry)),
      listToday: () => Effect.succeed(writes),
      findById: (entryId) =>
        Effect.succeed(writes.find((entry) => entry.id === entryId)),
      updateExisting: (entryId, patch) =>
        Effect.gen(function* () {
          const index = writes.findIndex((entry) => entry.id === entryId)
          if (index < 0) {
            return yield* Effect.fail(
              new SlogError(
                'entry_not_found',
                'No entry exists with the supplied id.',
              ),
            )
          }
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

  test('machine update JSON applies a text patch and returns entry envelope', async () => {
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Original text',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }

    const result = await Effect.runPromise(
      machineUpdateEntryProgram(
        JSON.stringify({ id: fixedId, changes: { text: ' Updated text ' } }),
      ).pipe(Effect.provide(testLayer([entry]))),
    )

    expect(result).toEqual({
      entry: { ...entry, text: 'Updated text' },
      warnings: [],
    })
  })

  test('machine update JSON sets occurred_at string, clears occurred_at null, and toggles needs_triage independently', async () => {
    const occurredEntry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Occurred target',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }
    const setOccurred = await Effect.runPromise(
      machineUpdateEntryProgram(
        JSON.stringify({
          id: fixedId,
          changes: { occurred_at: '2026-06-05T10:42:00-04:00' },
        }),
      ).pipe(Effect.provide(testLayer([occurredEntry]))),
    )
    expect(setOccurred.entry.occurred_at).toBe('2026-06-05T10:42:00-04:00')
    expect(setOccurred.warnings).toEqual([])

    const clearEntry: Entry = {
      ...occurredEntry,
      occurred_at: '2026-06-05T10:42:00-04:00',
    }
    const cleared = await Effect.runPromise(
      machineUpdateEntryProgram(
        JSON.stringify({ id: fixedId, changes: { occurred_at: null } }),
      ).pipe(Effect.provide(testLayer([clearEntry]))),
    )
    expect(cleared.entry).not.toHaveProperty('occurred_at')
    expect(cleared.warnings).toEqual([])

    const triageEntry: Entry = {
      ...occurredEntry,
      needs_triage: true,
    }
    const toggled = await Effect.runPromise(
      machineUpdateEntryProgram(
        JSON.stringify({ id: fixedId, changes: { needs_triage: false } }),
      ).pipe(Effect.provide(testLayer([triageEntry]))),
    )
    expect(toggled.entry.needs_triage).toBe(false)
    expect(toggled.warnings).toEqual([])
  })

  test('machine update JSON rejects empty changes because at least one allowed change is required', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: {} }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'Entry update payload failed validation.',
      details: [
        {
          path: 'changes',
          code: 'missing_change',
        },
      ],
    })
  })

  test('machine update JSON rejects forbidden and unknown keys in changes with detail paths', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({
            id: fixedId,
            changes: {
              actor: 'zachary',
              authority: { source: 'zachary' },
              created_at: formatLocalIso(fixedNow),
              id: laterId,
              bogus: true,
            },
          }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [
        { path: 'changes.actor', code: 'forbidden_field' },
        { path: 'changes.authority', code: 'forbidden_field' },
        { path: 'changes.created_at', code: 'forbidden_field' },
        { path: 'changes.id', code: 'forbidden_field' },
        { path: 'changes.bogus', code: 'unknown_field' },
        { path: 'changes', code: 'missing_change' },
      ],
    })
  })

  test('machine update JSON rejects unknown top-level keys', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { text: 'ok' }, bogus: true }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'bogus', code: 'unknown_field' }],
    })
  })

  test('machine update JSON rejects invalid id at path id', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: 'not-a-ulid', changes: { text: 'ok' } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'id', code: 'invalid_id' }],
    })
  })

  test('machine update JSON rejects null and empty text changes', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { text: null } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.text', code: 'invalid_type' }],
    })

    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { text: '   ' } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.text', code: 'empty' }],
    })
  })

  test('machine update JSON rejects numeric and malformed occurred_at changes', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { occurred_at: 123 } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.occurred_at', code: 'invalid_type' }],
    })

    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({
            id: fixedId,
            changes: { occurred_at: 'yesterday' },
          }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.occurred_at', code: 'invalid_timestamp' }],
    })
  })

  test('machine update JSON rejects non-boolean needs_triage changes', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { needs_triage: 'false' } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.needs_triage', code: 'invalid_type' }],
    })
  })

  test('machine update JSON propagates entry_not_found and renders standard error envelope', async () => {
    await expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: missingId, changes: { text: 'Missing' } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [],
    })

    expect(
      machineErrorEnvelope(
        new SlogError(
          'entry_not_found',
          'No entry exists with the supplied id.',
        ),
      ),
    ).toEqual({
      error: {
        code: 'entry_not_found',
        message: 'No entry exists with the supplied id.',
        details: [],
      },
    })
  })

  test('machine update JSON treats no-op patches as idempotent success', async () => {
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      occurred_at: '2026-06-05T10:42:00-04:00',
      text: 'Already current',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }

    const result = await Effect.runPromise(
      machineUpdateEntryProgram(
        JSON.stringify({
          id: fixedId,
          changes: {
            text: 'Already current',
            occurred_at: '2026-06-05T10:42:00-04:00',
            needs_triage: false,
          },
        }),
      ).pipe(Effect.provide(testLayer([entry]))),
    )

    expect(result).toEqual({ entry, warnings: [] })
  })

  test('machine update command reads --json - from provided input service', async () => {
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Original stdin update',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: true,
    }

    const result = await Effect.runPromise(
      machineUpdateCommandProgram('-').pipe(
        Effect.provide(
          testLayer(
            [entry],
            fixedNow,
            fixedId,
            JSON.stringify({
              id: fixedId,
              changes: { text: 'Updated from stdin', needs_triage: false },
            }),
          ),
        ),
      ),
    )

    expect(result).toEqual({
      entry: { ...entry, text: 'Updated from stdin', needs_triage: false },
      warnings: [],
    })
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
    const error = duplicateEntryJsonError([
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

  test('entry update preflight rejects duplicate --json payload sources', () => {
    const error = duplicateEntryJsonError([
      'entry',
      'update',
      '--json=A',
      '--json',
      'B',
    ])

    expect(error).toMatchObject({
      code: 'validation_failed',
      message: 'entry update accepts exactly one --json payload source.',
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
