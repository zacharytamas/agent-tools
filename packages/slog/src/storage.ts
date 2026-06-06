import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, Effect, Layer, Schema } from 'effect'
import { Entry, SlogError } from './domain.js'
import { decodeUlidTimestamp, SlogConfig } from './environment.js'

export interface EntryRepositoryShape {
  readonly append: (entry: Entry) => Effect.Effect<void, SlogError>
  readonly listToday: (
    date: Date,
  ) => Effect.Effect<ReadonlyArray<Entry>, SlogError>
  readonly findById: (id: string) => Effect.Effect<Entry | undefined, SlogError>
}

export class EntryRepository extends Context.Service<
  EntryRepository,
  EntryRepositoryShape
>()('@tools/slog/EntryRepository') {}

export const LiveEntryRepositoryLayer = Layer.effect(
  EntryRepository,
  Effect.gen(function* () {
    const config = yield* SlogConfig

    const readEntries = (date: Date) =>
      Effect.tryPromise({
        try: async () => {
          const path = dailyEntryPath(config.home, date)
          let content: string
          try {
            content = await readFile(path, 'utf8')
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
            throw cause
          }
          return content
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line, index) => decodeEntryLine(path, line, index + 1))
        },
        catch: (cause) =>
          cause instanceof SlogError
            ? cause
            : new SlogError(
                'io_error',
                cause instanceof Error ? cause.message : String(cause),
              ),
      })

    return {
      append: (entry) =>
        Effect.tryPromise({
          try: async () => {
            const path = dailyEntryPath(config.home, new Date(entry.created_at))
            await mkdir(dirname(path), { recursive: true })
            await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
          },
          catch: (cause) =>
            new SlogError(
              'io_error',
              cause instanceof Error ? cause.message : String(cause),
            ),
        }),
      listToday: readEntries,
      findById: (id) =>
        Effect.gen(function* () {
          const entries = yield* readEntries(decodeUlidTimestamp(id))
          return entries.find((entry) => entry.id === id)
        }),
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
