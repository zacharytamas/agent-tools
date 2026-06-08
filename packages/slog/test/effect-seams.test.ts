import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { duplicateEntryJsonError } from '../src/cli.js'
import {
  editCommandProgram,
  machineErrorEnvelope,
} from '../src/cli-commands.js'
import {
  addEntryProgram,
  createEntry,
  editEntryProgram,
  listEntries,
  listEntriesProgram,
  machineCreateCommandProgram,
  machineCreateEntryProgram,
  machineListEntriesProgram,
  machineShowEntryProgram,
  machineUpdateCommandProgram,
  machineUpdateEntryProgram,
  reopenTriageEntryProgram,
  resolveTriageEntryProgram,
  showEntryProgram,
  triageEntriesProgram,
  updateEntry,
} from '../src/core.js'
import { type Entry, SlogError } from '../src/domain.js'
import {
  FixedClock,
  formatLocalIso,
  generateUlid,
  IdGenerator,
  localDateStamp,
  MachineInput,
  SlogConfig,
} from '../src/environment.js'
import { renderHumanError, renderHumanTriageList } from '../src/human.js'
import { EntryRepository } from '../src/storage.js'

const fixedNow = new Date('2026-06-05T14:52:00-04:00')
const laterNow = new Date('2026-06-05T15:05:00-04:00')
const fixedId = `${generateUlid(fixedNow).slice(0, 10)}ABCDEFABCDEFABCD`
const laterId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF`
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

async function captureConsoleLog(
  effect: Effect.Effect<void, SlogError>,
): Promise<ReadonlyArray<string>> {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    await Effect.runPromise(effect)
  } finally {
    console.log = originalLog
  }
  return lines
}

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
      listByCreatedAtDateRange: (start, end) =>
        Effect.succeed(
          writes.filter((entry) => {
            const stamp = localDateStamp(new Date(entry.created_at))
            const startStamp = localDateStamp(start)
            const endStamp = localDateStamp(end)
            const [minStamp, maxStamp] =
              startStamp <= endStamp
                ? [startStamp, endStamp]
                : [endStamp, startStamp]
            return stamp >= minStamp && stamp <= maxStamp
          }),
        ),
      listToday: () => Effect.succeed(writes),
      listTriageToday: () =>
        Effect.succeed(writes.filter((entry) => entry.needs_triage)),
      listAllTriage: () =>
        Effect.succeed(writes.filter((entry) => entry.needs_triage)),
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
  test('typed listEntries with no filter returns today entries only', async () => {
    const yesterday = new Date('2026-06-04T12:00:00-04:00')
    const yesterdayEntry = entryFixture({
      id: `${generateUlid(yesterday).slice(0, 10)}YYYYYYYYYYYYYYYY`,
      created_at: formatLocalIso(yesterday),
      text: 'Yesterday typed list row',
    })
    const todayEntry = entryFixture({ text: 'Today typed list row' })

    const result = await Effect.runPromise(
      listEntries().pipe(
        Effect.provide(testLayer([yesterdayEntry, todayEntry])),
      ),
    )

    expect(result).toEqual([todayEntry])
  })

  test('typed listEntries filters by needsTriage exact match', async () => {
    const triage = entryFixture({
      text: 'Needs typed list triage',
      needs_triage: true,
    })
    const settled = entryFixture({
      id: laterId,
      created_at: formatLocalIso(laterNow),
      text: 'Settled typed list row',
      needs_triage: false,
    })

    const result = await Effect.runPromise(
      listEntries({ needsTriage: true }).pipe(
        Effect.provide(testLayer([settled, triage])),
      ),
    )

    expect(result).toEqual([triage])
  })

  test('typed listEntries filters by actor exact match', async () => {
    const hermes = entryFixture({
      text: 'Hermes typed list row',
      actor: 'hermes:hightower',
      authority: { source: 'hermes:hightower', mode: 'discretionary' },
    })
    const zachary = entryFixture({ text: 'Zachary typed list row' })

    const result = await Effect.runPromise(
      listEntries({ actor: 'hermes:hightower' }).pipe(
        Effect.provide(testLayer([zachary, hermes])),
      ),
    )

    expect(result).toEqual([hermes])
  })

  test('typed listEntries filters by authoritySource exact match', async () => {
    const delegated = entryFixture({
      text: 'Delegated typed list row',
      actor: 'hermes:hightower',
      authority: { source: 'zachary', mode: 'delegated' },
    })
    const discretionary = entryFixture({
      text: 'Discretionary typed list row',
      actor: 'hermes:hightower',
      authority: { source: 'hermes:hightower', mode: 'discretionary' },
    })

    const result = await Effect.runPromise(
      listEntries({ authoritySource: 'zachary' }).pipe(
        Effect.provide(testLayer([discretionary, delegated])),
      ),
    )

    expect(result).toEqual([delegated])
  })

  test('typed listEntries filters by authorityMode exact match', async () => {
    const observed = entryFixture({
      text: 'Observed typed list row',
      authority: { source: 'external:github', mode: 'observed' },
    })
    const direct = entryFixture({ text: 'Direct typed list row' })

    const result = await Effect.runPromise(
      listEntries({ authorityMode: 'observed' }).pipe(
        Effect.provide(testLayer([direct, observed])),
      ),
    )

    expect(result).toEqual([observed])
  })

  test('typed listEntries filters textQuery as case-insensitive substring', async () => {
    const match = entryFixture({ text: 'Reviewed Tenant Fallback PR' })
    const miss = entryFixture({
      id: laterId,
      created_at: formatLocalIso(laterNow),
      text: 'Updated deployment docs',
    })

    const result = await Effect.runPromise(
      listEntries({ textQuery: 'tenant fallback' }).pipe(
        Effect.provide(testLayer([miss, match])),
      ),
    )

    expect(result).toEqual([match])
  })

  test('typed updateEntry updates text and returns entry envelope', async () => {
    const entry = entryFixture({ text: 'Original typed update text' })
    const writes: Entry[] = [entry]

    const result = await Effect.runPromise(
      updateEntry({ id: fixedId, text: ' Updated typed text ' }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(result).toEqual({
      entry: { ...entry, text: 'Updated typed text' },
      warnings: [],
    })
    expect(writes[0].text).toBe('Updated typed text')
  })

  test('typed updateEntry clears occurredAt with null', async () => {
    const entry = entryFixture({ occurred_at: '2026-06-05T10:42:00-04:00' })
    const writes: Entry[] = [entry]

    const result = await Effect.runPromise(
      updateEntry({ id: fixedId, occurredAt: null }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(result.entry).not.toHaveProperty('occurred_at')
    expect(result.warnings).toEqual([])
    expect(writes[0]).not.toHaveProperty('occurred_at')
  })

  test('typed updateEntry sets needsTriage', async () => {
    const entry = entryFixture({ needs_triage: false })
    const writes: Entry[] = [entry]

    const result = await Effect.runPromise(
      updateEntry({ id: fixedId, needsTriage: true }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(result.entry.needs_triage).toBe(true)
    expect(result.warnings).toEqual([])
    expect(writes[0].needs_triage).toBe(true)
  })

  test('typed updateEntry rejects empty patch', async () => {
    expect(
      Effect.runPromise(
        updateEntry({ id: fixedId }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message:
        'updateEntry requires at least one of text, occurredAt, or needsTriage.',
    })
  })

  test('typed updateEntry propagates entry_not_found for non-existent id', async () => {
    expect(
      Effect.runPromise(
        updateEntry({ id: missingId, text: 'Missing typed update' }).pipe(
          Effect.provide(testLayer([])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
    })
  })

  test('typed createEntry defaults authoritySource to actor when omitted', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      createEntry({
        text: 'Typed entry default source',
        actor: 'hermes:hightower',
        authorityMode: 'discretionary',
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry).toMatchObject({
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Typed entry default source',
      actor: 'hermes:hightower',
      authority: { source: 'hermes:hightower', mode: 'discretionary' },
      needs_triage: true,
    })
    expect(result.warnings).toEqual([])
    expect(writes).toEqual([result.entry])
  })

  test('typed createEntry preserves explicit authoritySource', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      createEntry({
        text: 'Typed entry explicit source',
        actor: 'hermes:hightower',
        authorityMode: 'delegated',
        authoritySource: 'zachary',
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry.authority).toEqual({
      source: 'zachary',
      mode: 'delegated',
    })
    expect(result.entry.needs_triage).toBe(false)
    expect(result.warnings).toEqual([])
  })

  test('typed createEntry forces discretionary needsTriage false to triage with warning', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      createEntry({
        text: 'Typed discretionary settled intent',
        actor: 'hermes:hightower',
        authorityMode: 'discretionary',
        needsTriage: false,
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry.needs_triage).toBe(true)
    expect(result.warnings).toEqual([
      {
        code: 'needs_triage_forced',
        message: 'Only direct and delegated entries may be created as settled.',
      },
    ])
  })

  test('typed createEntry leaves delegated needsTriage false settled without warning', async () => {
    const writes: Entry[] = []

    const result = await Effect.runPromise(
      createEntry({
        text: 'Typed delegated settled intent',
        actor: 'hermes:hightower',
        authorityMode: 'delegated',
        authoritySource: 'zachary',
        needsTriage: false,
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result.entry.needs_triage).toBe(false)
    expect(result.warnings).toEqual([])
  })

  test('typed createEntry rejects empty text as validation_failed', async () => {
    expect(
      Effect.runPromise(
        createEntry({
          text: '   ',
          actor: 'hermes:hightower',
          authorityMode: 'delegated',
          authoritySource: 'zachary',
        }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'text must be non-empty.',
    })
  })

  test('typed createEntry rejects bad actor identity as validation_failed', async () => {
    expect(
      Effect.runPromise(
        createEntry({
          text: 'Bad actor identity',
          actor: ' hermes:hightower',
          authorityMode: 'delegated',
          authoritySource: 'zachary',
        }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message:
        'actor must be a non-empty string without leading/trailing whitespace or control characters.',
    })
  })

  test('typed createEntry rejects invalid occurredAt offset timestamp', async () => {
    expect(
      Effect.runPromise(
        createEntry({
          text: 'Bad occurredAt',
          actor: 'hermes:hightower',
          authorityMode: 'delegated',
          authoritySource: 'zachary',
          occurredAt: '2026-06-05T10:42:00Z',
        }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message:
        'occurredAt must be an ISO 8601 timestamp with an explicit offset.',
    })
  })

  test('human edit --text updates text and prints mutation line', async () => {
    const writes: Entry[] = [entryFixture({ needs_triage: true })]

    const lines = await captureConsoleLog(
      editCommandProgram({ id: fixedId, text: ' Updated text ' }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(lines).toEqual([`Updated ${fixedId}  Updated text`])
    expect(writes[0]).toMatchObject({
      text: 'Updated text',
      needs_triage: true,
    })
  })

  test('triage resolve flips needs_triage to false and renders mutation line', async () => {
    const writes: Entry[] = [
      entryFixture({ needs_triage: true, text: 'Needs review before archive' }),
    ]

    const output = await Effect.runPromise(
      resolveTriageEntryProgram(fixedId).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(output).toBe(`Resolved ${fixedId}  Needs review before archive`)
    expect(writes[0]).toMatchObject({
      text: 'Needs review before archive',
      needs_triage: false,
    })
  })

  test('triage reopen flips only needs_triage to true and preserves entry fields', async () => {
    const writes: Entry[] = [
      entryFixture({
        needs_triage: false,
        text: 'Keep text stable',
        occurred_at: '2026-06-05T10:42:00-04:00',
      }),
    ]

    const output = await Effect.runPromise(
      reopenTriageEntryProgram(fixedId).pipe(Effect.provide(testLayer(writes))),
    )

    expect(output).toBe(`Reopened ${fixedId}  Keep text stable`)
    expect(writes[0]).toEqual(
      entryFixture({
        needs_triage: true,
        text: 'Keep text stable',
        occurred_at: '2026-06-05T10:42:00-04:00',
      }),
    )
  })

  test('triage resolve and reopen attach entry_id detail on missing full ULID', async () => {
    for (const program of [
      resolveTriageEntryProgram,
      reopenTriageEntryProgram,
    ]) {
      expect(
        Effect.runPromise(
          program(missingId).pipe(Effect.provide(testLayer([]))),
        ),
      ).rejects.toMatchObject({
        code: 'entry_not_found',
        message: 'No entry exists with the supplied id.',
        details: [{ path: '', code: 'entry_id', message: missingId }],
      })
    }
  })

  test('human edit --occurred-at sets occurred_at and --clear-occurred-at clears it', async () => {
    const setWrites: Entry[] = [entryFixture()]

    const setOutput = await Effect.runPromise(
      editEntryProgram({
        id: fixedId,
        occurredAt: '2026-06-05T10:42:00-04:00',
      }).pipe(Effect.provide(testLayer(setWrites))),
    )

    expect(setOutput).toBe(`Updated ${fixedId}  Original text`)
    expect(setWrites[0].occurred_at).toBe('2026-06-05T10:42:00-04:00')

    const clearWrites: Entry[] = [
      entryFixture({ occurred_at: '2026-06-05T10:42:00-04:00' }),
    ]
    const clearOutput = await Effect.runPromise(
      editEntryProgram({ id: fixedId, clearOccurredAt: true }).pipe(
        Effect.provide(testLayer(clearWrites)),
      ),
    )

    expect(clearOutput).toBe(`Updated ${fixedId}  Original text`)
    expect(clearWrites[0]).not.toHaveProperty('occurred_at')
  })

  test('human edit mutation snippet collapses newlines and truncates over 60 characters only', async () => {
    const longText =
      '123456789012345678901234567890123456789012345678901234567890X'
    const longWrites: Entry[] = [entryFixture()]

    const longOutput = await Effect.runPromise(
      editEntryProgram({ id: fixedId, text: longText }).pipe(
        Effect.provide(testLayer(longWrites)),
      ),
    )

    expect(longOutput).toBe(
      `Updated ${fixedId}  123456789012345678901234567890123456789012345678901234567890…`,
    )

    const newlineWrites: Entry[] = [entryFixture()]
    const newlineOutput = await Effect.runPromise(
      editEntryProgram({ id: fixedId, text: 'First line\nSecond line' }).pipe(
        Effect.provide(testLayer(newlineWrites)),
      ),
    )

    expect(newlineOutput).toBe(`Updated ${fixedId}  First line Second line`)

    const sixtyCharacters =
      '123456789012345678901234567890123456789012345678901234567890'
    const exactWrites: Entry[] = [entryFixture()]
    const exactOutput = await Effect.runPromise(
      editEntryProgram({ id: fixedId, text: sixtyCharacters }).pipe(
        Effect.provide(testLayer(exactWrites)),
      ),
    )

    expect(exactOutput).toBe(`Updated ${fixedId}  ${sixtyCharacters}`)
  })

  test('human edit no-op prints No changes and succeeds', async () => {
    const writes: Entry[] = [entryFixture({ text: 'Already current' })]

    const output = await Effect.runPromise(
      editEntryProgram({ id: fixedId, text: 'Already current' }).pipe(
        Effect.provide(testLayer(writes)),
      ),
    )

    expect(output).toBe(`No changes ${fixedId}  Already current`)
    expect(writes).toEqual([entryFixture({ text: 'Already current' })])
  })

  test('human edit rejects missing flags', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({ id: fixedId }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message:
        'edit requires at least one of --text, --occurred-at, or --clear-occurred-at.',
    })
  })

  test('human edit rejects mutually exclusive occurred-at flags', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({
          id: fixedId,
          occurredAt: '2026-06-05T10:42:00-04:00',
          clearOccurredAt: true,
        }).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'Use either --occurred-at or --clear-occurred-at, not both.',
    })
  })

  test('human edit rejects empty text', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({ id: fixedId, text: '   ' }).pipe(
          Effect.provide(testLayer([])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'text must be non-empty.',
    })
  })

  test('human edit rejects invalid occurred_at', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({ id: fixedId, occurredAt: 'yesterday' }).pipe(
          Effect.provide(testLayer([])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message:
        'occurred_at must be an ISO 8601 timestamp with an explicit offset.',
    })
  })

  test('human edit rejects invalid id as validation_failed', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({ id: 'not-a-ulid', text: 'Valid text' }).pipe(
          Effect.provide(testLayer([])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'id must be a full ULID.',
    })
  })

  test('human edit propagates entry_not_found for absent full ULID', async () => {
    expect(
      Effect.runPromise(
        editEntryProgram({ id: missingId, text: 'Missing' }).pipe(
          Effect.provide(testLayer([])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [{ path: '', code: 'entry_id', message: missingId }],
    })
  })

  test('human edit does not change needs_triage when editing text or occurred_at', async () => {
    const writes: Entry[] = [entryFixture({ needs_triage: true })]

    const result = await Effect.runPromise(
      editEntryProgram({
        id: fixedId,
        text: 'Changed text',
        occurredAt: '2026-06-05T10:42:00-04:00',
      }).pipe(Effect.provide(testLayer(writes))),
    )

    expect(result).toBe(`Updated ${fixedId}  Changed text`)
    expect(writes[0]).toMatchObject({
      text: 'Changed text',
      occurred_at: '2026-06-05T10:42:00-04:00',
      needs_triage: true,
    })
  })

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
    expect(
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
    expect(
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
    expect(
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
    expect(
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
    expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { text: null } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.text', code: 'invalid_type' }],
    })

    expect(
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
    expect(
      Effect.runPromise(
        machineUpdateEntryProgram(
          JSON.stringify({ id: fixedId, changes: { occurred_at: 123 } }),
        ).pipe(Effect.provide(testLayer([]))),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'changes.occurred_at', code: 'invalid_type' }],
    })

    expect(
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
    expect(
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
    expect(
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

    expect(
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

    expect(
      Effect.runPromise(
        machineShowEntryProgram(missingId).pipe(
          Effect.provide(testLayer([entry])),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [{ path: '', code: 'entry_id', message: missingId }],
    })

    expect(
      Effect.runPromise(
        machineShowEntryProgram(fixedId).pipe(
          Effect.provide(testLayer([entry])),
        ),
      ),
    ).resolves.toEqual({ entry, warnings: [] })
  })

  test('machine create JSON rejects forbidden generated fields with validation details', async () => {
    expect(
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
    expect(
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

  test('triage renderer groups by day in chronological order without redundant TRIAGE markers', () => {
    const yesterday = new Date('2026-06-04T12:00:00-04:00')
    const yesterdayId = `${generateUlid(yesterday).slice(0, 10)}YYYYYYYYYYYYYYYY`
    const entries: Entry[] = [
      entryFixture({
        id: laterId,
        created_at: formatLocalIso(laterNow),
        text: 'Later today triage',
        needs_triage: true,
      }),
      entryFixture({
        id: yesterdayId,
        created_at: formatLocalIso(yesterday),
        text: 'Yesterday triage',
        needs_triage: true,
      }),
      entryFixture({
        id: fixedId,
        created_at: formatLocalIso(fixedNow),
        text: 'Earlier today triage',
        needs_triage: true,
      }),
    ]

    const todayOnly = renderHumanTriageList(fixedNow, [entries[0], entries[2]])
    expect(todayOnly).toBe(
      `2026-06-05\n\n18:52  ${fixedId}  Earlier today triage\n19:05  ${laterId}  Later today triage\n`,
    )
    expect(todayOnly).not.toContain('TRIAGE')

    const all = renderHumanTriageList(fixedNow, entries, { all: true })
    expect(all).toBe(
      `2026-06-04\n\n16:00  ${yesterdayId}  Yesterday triage\n\n2026-06-05\n\n18:52  ${fixedId}  Earlier today triage\n19:05  ${laterId}  Later today triage\n`,
    )
    expect(all).not.toContain('TRIAGE')
  })

  test('triage list program uses today scope by default and all-partition scan with --all', async () => {
    const entries: Entry[] = [
      entryFixture({ needs_triage: true, text: 'Today triage' }),
      entryFixture({
        id: laterId,
        created_at: formatLocalIso(laterNow),
        needs_triage: false,
        text: 'Resolved today',
      }),
    ]

    const today = await Effect.runPromise(
      triageEntriesProgram({ all: false }).pipe(
        Effect.provide(testLayer(entries)),
      ),
    )
    expect(today).toContain(`${fixedId}  Today triage`)
    expect(today).not.toContain(laterId)

    entries[1] = { ...entries[1], needs_triage: true }
    const all = await Effect.runPromise(
      triageEntriesProgram({ all: true }).pipe(
        Effect.provide(testLayer(entries)),
      ),
    )
    expect(all).toContain(`${fixedId}  Today triage`)
    expect(all).toContain(`${laterId}  Resolved today`)
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

describe('renderHumanError', () => {
  test('renders entry_not_found with doctrine phrasing and id from entry_id detail', () => {
    expect(
      renderHumanError(
        new SlogError(
          'entry_not_found',
          'No entry exists with the supplied id.',
          [
            {
              path: '',
              code: 'entry_id',
              message: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            },
          ],
        ),
      ),
    ).toBe('Entry not found: 01ARZ3NDEKTSV4RRFFQ69G5FAV')
  })

  test('renders storage_corrupt with doctrine phrasing and id from entry_id detail', () => {
    expect(
      renderHumanError(
        new SlogError(
          'storage_corrupt',
          'Partition contains duplicate entry id.',
          [
            {
              path: 'entries/2026/06/05.jsonl',
              code: 'duplicate_entry_id',
              message: 'duplicate',
            },
            {
              path: '',
              code: 'entry_id',
              message: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            },
          ],
        ),
      ),
    ).toBe(
      'Storage corrupt: multiple records found for 01ARZ3NDEKTSV4RRFFQ69G5FAV',
    )
  })

  test('renders a bare single-line message when there are no path details', () => {
    expect(
      renderHumanError(
        new SlogError(
          'validation_failed',
          'edit requires at least one of --text, --occurred-at, or --clear-occurred-at.',
        ),
      ),
    ).toBe(
      'edit requires at least one of --text, --occurred-at, or --clear-occurred-at.',
    )
  })

  test('appends the first non-empty path detail when present and no doctrine code matches', () => {
    expect(
      renderHumanError(
        new SlogError('validation_failed', 'changes failed validation.', [
          {
            path: 'changes.actor',
            code: 'forbidden_field',
            message: 'forbidden',
          },
        ]),
      ),
    ).toBe('changes failed validation. (changes.actor)')
  })

  test('ignores detail with empty path when no doctrine code matches', () => {
    expect(
      renderHumanError(
        new SlogError('validation_failed', 'id must be a full ULID.', [
          { path: '', code: 'invalid', message: 'x' },
        ]),
      ),
    ).toBe('id must be a full ULID.')
  })
})
