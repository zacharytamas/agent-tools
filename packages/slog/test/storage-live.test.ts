import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Layer } from 'effect'
import { showEntryProgram } from '../src/core.js'
import type { Entry } from '../src/domain.js'
import { formatLocalIso, generateUlid, SlogConfig } from '../src/environment.js'
import { LivePartitionLockLayer } from '../src/lock.js'
import {
  dailyEntryPath,
  EntryRepository,
  LiveEntryRepositoryLayer,
} from '../src/storage.js'

const fixedNow = new Date('2026-06-05T14:52:00-04:00')
const fixedId = `${generateUlid(fixedNow).slice(0, 10)}ABCDEFGHJKMNPQRS`

async function makeHome() {
  return await mkdtemp(join(tmpdir(), 'slog-effect-storage-'))
}

async function writeEntry(
  slogHome: string,
  entry: Entry,
  date = new Date(entry.created_at),
) {
  const path = dailyEntryPath(slogHome, date)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(entry)}\n`, { flag: 'a' })
}

describe('slog live Effect repository layer', () => {
  test('appends JSONL daily records and finds entries by full ULID partition', async () => {
    const slogHome = await makeHome()
    const entry: Entry = {
      id: fixedId,
      created_at: formatLocalIso(fixedNow),
      text: 'Stored through live repository',
      actor: 'zachary',
      authority: { source: 'zachary', mode: 'direct' },
      needs_triage: false,
    }
    const layer = LiveEntryRepositoryLayer.pipe(
      Layer.provideMerge(LivePartitionLockLayer),
      Layer.provideMerge(
        Layer.succeed(SlogConfig, { home: slogHome, user: 'zachary' }),
      ),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EntryRepository
        yield* repo.append(entry)
      }).pipe(Effect.provide(layer)),
    )

    const path = dailyEntryPath(slogHome, fixedNow)
    expect(await readFile(path, 'utf8')).toContain(
      'Stored through live repository',
    )

    const output = await Effect.runPromise(
      showEntryProgram(fixedId).pipe(Effect.provide(layer)),
    )
    expect(output).toContain('Stored through live repository')
  })

  test('show lookup does not scan the wrong daily partition', async () => {
    const slogHome = await makeHome()
    const wrongDate = new Date('2026-06-06T14:52:00-04:00')
    await writeEntry(
      slogHome,
      {
        id: fixedId,
        created_at: formatLocalIso(wrongDate),
        text: 'Wrong partition',
        actor: 'zachary',
        authority: { source: 'zachary', mode: 'direct' },
        needs_triage: false,
      },
      wrongDate,
    )
    const layer = LiveEntryRepositoryLayer.pipe(
      Layer.provideMerge(LivePartitionLockLayer),
      Layer.provideMerge(
        Layer.succeed(SlogConfig, { home: slogHome, user: 'zachary' }),
      ),
    )

    expect(
      Effect.runPromise(showEntryProgram(fixedId).pipe(Effect.provide(layer))),
    ).rejects.toThrow('No entry exists with the supplied id.')
  })

  test('rejects malformed persisted records with file and line context', async () => {
    const slogHome = await makeHome()
    const path = dailyEntryPath(slogHome, fixedNow)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{"id":"not-a-real-entry"}\n')
    const layer = LiveEntryRepositoryLayer.pipe(
      Layer.provideMerge(LivePartitionLockLayer),
      Layer.provideMerge(
        Layer.succeed(SlogConfig, { home: slogHome, user: 'zachary' }),
      ),
    )

    expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* EntryRepository
          yield* repo.listToday(fixedNow)
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow(`${path}:1: invalid entry record`)
  })
})
