import { describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Layer } from 'effect'
import type { Entry, SlogError } from '../src/domain.js'
import { formatLocalIso, generateUlid, SlogConfig } from '../src/environment.js'
import {
  LivePartitionLockLayer,
  makeLivePartitionLockLayer,
  PartitionLock,
  partitionLockPath,
} from '../src/lock.js'
import {
  dailyEntryPath,
  EntryRepository,
  type EntryRepositoryShape,
  LiveEntryRepositoryLayer,
} from '../src/storage.js'

const baseNow = new Date('2026-06-05T14:52:00-04:00')
const laterNow = new Date('2026-06-05T15:05:00-04:00')
const targetId = `${generateUlid(baseNow).slice(0, 10)}ABCDEFGHJKMNPQRS`
const otherId = `${generateUlid(laterNow).slice(0, 10)}123456789ABCDEF`

async function makeHome() {
  return await mkdtemp(join(tmpdir(), 'slog-storage-mutation-'))
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: targetId,
    created_at: formatLocalIso(baseNow),
    text: 'Original target text',
    actor: 'zachary',
    authority: { source: 'zachary', mode: 'direct' },
    needs_triage: false,
    ...overrides,
  }
}

function storageLayer(slogHome: string) {
  return LiveEntryRepositoryLayer.pipe(
    Layer.provideMerge(LivePartitionLockLayer),
    Layer.provideMerge(
      Layer.succeed(SlogConfig, { home: slogHome, user: 'zachary' }),
    ),
  )
}

function lockLayer(
  slogHome: string,
  options: Parameters<typeof makeLivePartitionLockLayer>[0] = {},
) {
  return makeLivePartitionLockLayer(options).pipe(
    Layer.provideMerge(
      Layer.succeed(SlogConfig, { home: slogHome, user: 'zachary' }),
    ),
  )
}

async function writePartition(
  slogHome: string,
  date: Date,
  lines: ReadonlyArray<string>,
) {
  const path = dailyEntryPath(slogHome, date)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

async function writeEntries(
  slogHome: string,
  entries: ReadonlyArray<Entry>,
  date = baseNow,
) {
  return await writePartition(
    slogHome,
    date,
    entries.map((entry) => JSON.stringify(entry)),
  )
}

async function runRepo<A>(
  slogHome: string,
  effect: (repo: EntryRepositoryShape) => Effect.Effect<A, SlogError>,
): Promise<A> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* EntryRepository
      return yield* effect(repo)
    }).pipe(Effect.provide(storageLayer(slogHome))),
  )
}

describe('slog storage mutation foundation', () => {
  test('updateExisting applies a patch to the latest stored entry and preserves other records verbatim', async () => {
    const slogHome = await makeHome()
    const target = makeEntry()
    const other = makeEntry({
      id: otherId,
      created_at: formatLocalIso(laterNow),
      text: 'Other entry text',
      needs_triage: true,
    })
    const otherLine = JSON.stringify(other)
    const path = await writePartition(slogHome, baseNow, [
      JSON.stringify(target),
      otherLine,
    ])

    const updated = await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, { text: 'Updated target text' }),
    )

    expect(updated).toEqual({ ...target, text: 'Updated target text' })
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')
    expect(JSON.parse(lines[0])).toEqual(updated)
    expect(lines[1]).toBe(otherLine)
  })

  test('updateExisting sets and clears occurred_at and patches text and needs_triage independently', async () => {
    const slogHome = await makeHome()
    const target = makeEntry()
    const path = await writeEntries(slogHome, [target])

    const withOccurred = await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, {
        occurred_at: '2026-06-05T10:42:00-04:00',
        needs_triage: true,
      }),
    )
    expect(withOccurred.occurred_at).toBe('2026-06-05T10:42:00-04:00')
    expect(withOccurred.needs_triage).toBe(true)

    const cleared = await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, {
        text: 'Changed while clearing occurred',
        occurred_at: null,
      }),
    )
    expect(cleared).toEqual({
      ...target,
      text: 'Changed while clearing occurred',
      needs_triage: true,
    })
    expect(cleared).not.toHaveProperty('occurred_at')

    const [line] = (await readFile(path, 'utf8')).trimEnd().split('\n')
    expect(JSON.parse(line)).toEqual(cleared)
  })

  test('updateExisting re-reads under lock so sequential disjoint-field updates both persist', async () => {
    const slogHome = await makeHome()
    const target = makeEntry()
    await writeEntries(slogHome, [target])

    await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, { text: 'First writer text' }),
    )
    const second = await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, { needs_triage: true }),
    )

    expect(second).toEqual({
      ...target,
      text: 'First writer text',
      needs_triage: true,
    })
  })

  test('updateExisting fails entry_not_found when the owning partition is missing', async () => {
    const slogHome = await makeHome()

    expect(
      runRepo(slogHome, (repo) =>
        repo.updateExisting(targetId, { text: 'Cannot update missing file' }),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [],
    })
  })

  test('updateExisting fails entry_not_found when id is absent from an existing partition', async () => {
    const slogHome = await makeHome()
    await writeEntries(slogHome, [makeEntry({ id: otherId })])

    expect(
      runRepo(slogHome, (repo) =>
        repo.updateExisting(targetId, { text: 'Cannot update absent id' }),
      ),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      message: 'No entry exists with the supplied id.',
      details: [],
    })
  })

  test('updateExisting detects duplicate ids as storage_corrupt and does not rewrite', async () => {
    const slogHome = await makeHome()
    const first = makeEntry({ text: 'Duplicate one' })
    const second = makeEntry({ text: 'Duplicate two', needs_triage: true })
    const path = await writeEntries(slogHome, [first, second])
    const before = await readFile(path, 'utf8')

    expect(
      runRepo(slogHome, (repo) =>
        repo.updateExisting(targetId, { text: 'Must not be written' }),
      ),
    ).rejects.toMatchObject({
      code: 'storage_corrupt',
      details: [
        {
          path,
          code: 'duplicate_entry_id',
        },
        { path: '', code: 'entry_id', message: targetId },
      ],
    })
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  test('findById detects duplicate ids in the owning partition as storage_corrupt', async () => {
    const slogHome = await makeHome()
    const path = await writeEntries(slogHome, [
      makeEntry({ text: 'Duplicate one' }),
      makeEntry({ text: 'Duplicate two' }),
    ])

    expect(
      runRepo(slogHome, (repo) => repo.findById(targetId)),
    ).rejects.toMatchObject({
      code: 'storage_corrupt',
      details: [
        {
          path,
          code: 'duplicate_entry_id',
        },
        { path: '', code: 'entry_id', message: targetId },
      ],
    })
  })

  test('listToday detects duplicate ids in the scanned partition as storage_corrupt', async () => {
    const slogHome = await makeHome()
    const path = await writeEntries(slogHome, [
      makeEntry({ text: 'Duplicate one' }),
      makeEntry({ text: 'Duplicate two' }),
    ])

    expect(
      runRepo(slogHome, (repo) => repo.listToday(baseNow)),
    ).rejects.toMatchObject({
      code: 'storage_corrupt',
      details: [
        {
          path,
          code: 'duplicate_entry_id',
        },
        { path: '', code: 'entry_id', message: targetId },
      ],
    })
  })

  test('listTriageToday returns only today entries that still need triage', async () => {
    const slogHome = await makeHome()
    const triage = makeEntry({ needs_triage: true, text: 'Needs human review' })
    const resolved = makeEntry({
      id: otherId,
      created_at: formatLocalIso(laterNow),
      needs_triage: false,
      text: 'Already settled',
    })
    const yesterday = new Date('2026-06-04T12:00:00-04:00')
    await writeEntries(slogHome, [triage, resolved])
    await writeEntries(
      slogHome,
      [
        makeEntry({
          id: `${generateUlid(yesterday).slice(0, 10)}ZZZZZZZZZZZZZZZZ`,
          created_at: formatLocalIso(yesterday),
          needs_triage: true,
          text: 'Wrong day triage',
        }),
      ],
      yesterday,
    )

    const listed = await runRepo(slogHome, (repo) =>
      repo.listTriageToday(baseNow),
    )

    expect(listed).toEqual([triage])
  })

  test('listAllTriage scans unresolved triage across daily partitions and treats a missing entries dir as empty', async () => {
    const emptyHome = await makeHome()
    expect(runRepo(emptyHome, (repo) => repo.listAllTriage())).resolves.toEqual(
      [],
    )

    const slogHome = await makeHome()
    const yesterday = new Date('2026-06-04T12:00:00-04:00')
    const tomorrow = new Date('2026-06-06T10:30:00-04:00')
    const todayTriage = makeEntry({
      needs_triage: true,
      text: 'Today triage',
    })
    const yesterdayTriage = makeEntry({
      id: `${generateUlid(yesterday).slice(0, 10)}YYYYYYYYYYYYYYYY`,
      created_at: formatLocalIso(yesterday),
      needs_triage: true,
      text: 'Yesterday triage',
    })
    const tomorrowResolved = makeEntry({
      id: `${generateUlid(tomorrow).slice(0, 10)}TTTTTTTTTTTTTTTT`,
      created_at: formatLocalIso(tomorrow),
      needs_triage: false,
      text: 'Tomorrow resolved',
    })
    await writeEntries(slogHome, [todayTriage])
    await writeEntries(slogHome, [yesterdayTriage], yesterday)
    await writeEntries(slogHome, [tomorrowResolved], tomorrow)

    const listed = await runRepo(slogHome, (repo) => repo.listAllTriage())

    expect(listed).toEqual([yesterdayTriage, todayTriage])
  })

  test('listAllTriage fails storage_corrupt when a scanned partition has duplicate ids', async () => {
    const slogHome = await makeHome()
    const duplicateOne = makeEntry({
      needs_triage: true,
      text: 'Duplicate one',
    })
    const duplicateTwo = makeEntry({
      needs_triage: true,
      text: 'Duplicate two',
    })
    const path = await writeEntries(slogHome, [duplicateOne, duplicateTwo])

    expect(
      runRepo(slogHome, (repo) => repo.listAllTriage()),
    ).rejects.toMatchObject({
      code: 'storage_corrupt',
      details: [
        {
          path,
          code: 'duplicate_entry_id',
        },
        { path: '', code: 'entry_id', message: targetId },
      ],
    })
  })

  test('updateExisting rewrites through temp and rename without leftover temp files and leaves valid JSONL', async () => {
    const slogHome = await makeHome()
    const path = await writeEntries(slogHome, [makeEntry()])

    await runRepo(slogHome, (repo) =>
      repo.updateExisting(targetId, { text: 'Temp rename rewrite' }),
    )

    const entriesDir = dirname(path)
    const files = await readdir(entriesDir)
    expect(files.filter((file) => file.includes('.tmp'))).toEqual([])
    const content = await readFile(path, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    const lines = content.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(() => JSON.parse(lines[0])).not.toThrow()
  })

  test('concurrent appends to the same partition are serialized without corruption or leftover lock/temp files', async () => {
    const slogHome = await makeHome()
    const createdAt = formatLocalIso(baseNow)
    const count = 25
    const entries: ReadonlyArray<Entry> = Array.from(
      { length: count },
      (_, index) =>
        makeEntry({
          id: `${generateUlid(new Date(baseNow.getTime() + index)).slice(0, 10)}${String(index).padStart(16, '0')}`,
          created_at: createdAt,
          text: `concurrent entry ${index}`,
        }),
    )

    const listed = await runRepo(slogHome, (repo) =>
      Effect.gen(function* () {
        yield* Effect.all(
          entries.map((entry) => repo.append(entry)),
          { concurrency: 'unbounded' },
        )
        return yield* repo.listToday(baseNow)
      }),
    )

    expect(listed).toHaveLength(count)

    const path = dailyEntryPath(slogHome, baseNow)
    const content = await readFile(path, 'utf8')
    const lines = content.trimEnd().split('\n')
    expect(lines).toHaveLength(count)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }

    const entriesDirFiles = await readdir(dirname(path))
    expect(entriesDirFiles.filter((file) => file.includes('.tmp'))).toEqual([])

    const lockFiles = await readdir(join(slogHome, 'locks')).catch(
      () => [] as string[],
    )
    expect(lockFiles).toEqual([])
  })
})

describe('slog PartitionLock live layer', () => {
  test('withLock runs the inner effect and releases so a second lock succeeds', async () => {
    const slogHome = await makeHome()
    const layer = lockLayer(slogHome)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lock = yield* PartitionLock
        const first = yield* lock.withLock(baseNow, Effect.succeed('first'))
        const second = yield* lock.withLock(baseNow, Effect.succeed('second'))
        return [first, second]
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual(['first', 'second'])
    expect(stat(partitionLockPath(slogHome, baseNow))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('withLock reclaims a stale lock file by age and proceeds', async () => {
    const slogHome = await makeHome()
    const path = partitionLockPath(slogHome, baseNow)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        pid: 12345,
        acquired_at: '2026-06-05T09:00:00-04:00',
        host: 'stale-host',
      }),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lock = yield* PartitionLock
        return yield* lock.withLock(baseNow, Effect.succeed('reclaimed'))
      }).pipe(
        Effect.provide(
          lockLayer(slogHome, {
            staleMillis: 1,
            timeoutMillis: 250,
            retryMillis: 10,
          }),
        ),
      ),
    )

    expect(result).toBe('reclaimed')
    expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('withLock fails with partition_locked within the bounded timeout for a fresh held lock', async () => {
    const slogHome = await makeHome()
    const path = partitionLockPath(slogHome, baseNow)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        pid: process.pid,
        acquired_at: formatLocalIso(new Date()),
        host: 'fresh-host',
      }),
    )
    const started = Date.now()

    expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const lock = yield* PartitionLock
          return yield* lock.withLock(baseNow, Effect.succeed('blocked'))
        }).pipe(
          Effect.provide(
            lockLayer(slogHome, {
              timeoutMillis: 100,
              retryMillis: 10,
              staleMillis: 60_000,
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'partition_locked' })
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
