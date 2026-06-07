import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Context, Effect, Layer, Schema } from 'effect'
import { Entry, SlogError } from './domain.js'
import { decodeUlidTimestamp, SlogConfig } from './environment.js'
import { PartitionLock } from './lock.js'

export interface EntryPatch {
  readonly text?: string
  readonly occurred_at?: string | null
  readonly needs_triage?: boolean
}

export interface EntryRepositoryShape {
  readonly append: (entry: Entry) => Effect.Effect<void, SlogError>
  readonly listToday: (
    date: Date,
  ) => Effect.Effect<ReadonlyArray<Entry>, SlogError>
  readonly findById: (id: string) => Effect.Effect<Entry | undefined, SlogError>
  readonly updateExisting: (
    id: string,
    patch: EntryPatch,
  ) => Effect.Effect<Entry, SlogError>
}

interface StoredEntryRecord {
  readonly entry: Entry
  readonly line: string
}

export class EntryRepository extends Context.Service<
  EntryRepository,
  EntryRepositoryShape
>()('@tools/slog/EntryRepository') {}

export const LiveEntryRepositoryLayer = Layer.effect(
  EntryRepository,
  Effect.gen(function* () {
    const config = yield* SlogConfig
    const partitionLock = yield* PartitionLock

    const readEntries = Effect.fn('slog.EntryRepository.readEntries')(
      function* (date: Date) {
        const path = dailyEntryPath(config.home, date)
        const records = yield* readPartitionRecords(path, 'empty')
        yield* ensureNoDuplicateEntryIds(path, records)
        return records.map((record) => record.entry)
      },
    )

    const append = Effect.fn('slog.EntryRepository.append')(function* (
      entry: Entry,
    ) {
      const date = new Date(entry.created_at)
      yield* partitionLock.withLock(
        date,
        Effect.gen(function* () {
          const path = dailyEntryPath(config.home, date)
          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(path), { recursive: true })
              await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
            },
            catch: ioError,
          })
        }),
      )
    })

    const listToday = Effect.fn('slog.EntryRepository.listToday')(function* (
      date: Date,
    ) {
      return yield* readEntries(date)
    })

    const findById = Effect.fn('slog.EntryRepository.findById')(function* (
      id: string,
    ) {
      const date = yield* decodeIdPartitionDate(id)
      const path = dailyEntryPath(config.home, date)
      const records = yield* readPartitionRecords(path, 'empty')
      yield* ensureNoDuplicateEntryIds(path, records)
      return records.find((record) => record.entry.id === id)?.entry
    })

    const updateExisting = Effect.fn('slog.EntryRepository.updateExisting')(
      function* (id: string, patch: EntryPatch) {
        const date = yield* decodeIdPartitionDate(id)
        return yield* partitionLock.withLock(
          date,
          Effect.gen(function* () {
            const path = dailyEntryPath(config.home, date)
            const records = yield* readPartitionRecords(path, 'not_found')
            const matchingIndexes = records.flatMap((record, index) =>
              record.entry.id === id ? [index] : [],
            )

            if (matchingIndexes.length === 0) {
              return yield* Effect.fail(entryNotFoundError())
            }
            if (matchingIndexes.length > 1) {
              return yield* Effect.fail(duplicateEntryIdError(path, id))
            }

            const matchIndex = matchingIndexes[0]
            const current = records[matchIndex].entry
            const updated = applyEntryPatch(current, patch)
            const nextLines = records.map((record, index) =>
              index === matchIndex ? JSON.stringify(updated) : record.line,
            )
            yield* rewritePartition(path, nextLines)
            return updated
          }),
        )
      },
    )

    return {
      append,
      listToday,
      findById,
      updateExisting,
    }
  }),
)

export function dailyEntryPath(slogHome: string, date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return join(slogHome, 'entries', year, month, `${day}.jsonl`)
}

function decodeEntryLine(
  path: string,
  line: string,
  lineNumber: number,
): Entry {
  try {
    return Schema.decodeUnknownSync(Entry)(JSON.parse(line))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new SlogError(
      'invalid_record',
      `${path}:${lineNumber}: invalid entry record: ${message}`,
    )
  }
}

const decodeIdPartitionDate = Effect.fn(
  'slog.EntryRepository.decodeIdPartitionDate',
)(function* (id: string) {
  return yield* Effect.try({
    try: () => decodeUlidTimestamp(id),
    catch: normalizeSlogError,
  })
})

const readPartitionRecords = Effect.fn(
  'slog.EntryRepository.readPartitionRecords',
)(function* (path: string, missing: 'empty' | 'not_found') {
  const content = yield* Effect.tryPromise({
    try: async () => {
      try {
        return await readFile(path, 'utf8')
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
          if (missing === 'empty') return undefined
          throw entryNotFoundError()
        }
        throw cause
      }
    },
    catch: normalizeSlogError,
  })

  if (content === undefined) return []

  return yield* Effect.try({
    try: () =>
      content
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line, index) => ({
          entry: decodeEntryLine(path, line, index + 1),
          line,
        })),
    catch: normalizeSlogError,
  })
})

const ensureNoDuplicateEntryIds = Effect.fn(
  'slog.EntryRepository.ensureNoDuplicateEntryIds',
)(function* (path: string, records: ReadonlyArray<StoredEntryRecord>) {
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.entry.id)) {
      return yield* Effect.fail(duplicateEntryIdError(path, record.entry.id))
    }
    seen.add(record.entry.id)
  }
})

function applyEntryPatch(entry: Entry, patch: EntryPatch): Entry {
  const next: {
    id: string
    created_at: string
    occurred_at?: string
    text: string
    actor: string
    authority: Entry['authority']
    needs_triage: boolean
  } = {
    id: entry.id,
    created_at: entry.created_at,
    ...(entry.occurred_at !== undefined
      ? { occurred_at: entry.occurred_at }
      : {}),
    text: entry.text,
    actor: entry.actor,
    authority: entry.authority,
    needs_triage: entry.needs_triage,
  }

  if (patch.text !== undefined) next.text = patch.text
  if (patch.needs_triage !== undefined) next.needs_triage = patch.needs_triage
  if ('occurred_at' in patch) {
    if (patch.occurred_at === null) {
      delete next.occurred_at
    } else if (patch.occurred_at !== undefined) {
      next.occurred_at = patch.occurred_at
    }
  }

  return new Entry(next)
}

const rewritePartition = Effect.fn('slog.EntryRepository.rewritePartition')(
  function* (path: string, lines: ReadonlyArray<string>) {
    const tempPath = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
    )
    const content = `${lines.join('\n')}\n`

    yield* Effect.tryPromise({
      try: () => writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' }),
      catch: normalizeSlogError,
    }).pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () => rename(tempPath, path),
          catch: normalizeSlogError,
        }),
      ),
      Effect.ensuring(
        unlinkIfExists(tempPath).pipe(Effect.catch(() => Effect.void)),
      ),
    )
  },
)

const unlinkIfExists = Effect.fn('slog.EntryRepository.unlinkIfExists')(
  function* (path: string) {
    yield* Effect.tryPromise({
      try: async () => {
        try {
          await unlink(path)
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
        }
      },
      catch: ioError,
    })
  },
)

function duplicateEntryIdError(path: string, id: string): SlogError {
  return new SlogError(
    'storage_corrupt',
    `Partition contains duplicate entry id ${id}.`,
    [
      {
        path,
        code: 'duplicate_entry_id',
        message: `Partition contains more than one record for entry id ${id}.`,
      },
    ],
  )
}

function entryNotFoundError(): SlogError {
  return new SlogError(
    'entry_not_found',
    'No entry exists with the supplied id.',
  )
}

function normalizeSlogError(cause: unknown): SlogError {
  return cause instanceof SlogError ? cause : ioError(cause)
}

function ioError(cause: unknown): SlogError {
  return new SlogError(
    'io_error',
    cause instanceof Error ? cause.message : String(cause),
  )
}
