import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { SlogError } from './domain.js'
import { formatLocalIso, localDateStamp, SlogConfig } from './environment.js'

export interface PartitionLockShape {
  readonly withLock: <A, E, R>(
    date: Date,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SlogError, R>
}

export interface PartitionLockOptions {
  readonly timeoutMillis: number
  readonly retryMillis: number
  readonly staleMillis: number
}

export class PartitionLock extends Context.Service<
  PartitionLock,
  PartitionLockShape
>()('@tools/slog/PartitionLock') {}

const defaultPartitionLockOptions: PartitionLockOptions = {
  timeoutMillis: 2_000,
  retryMillis: 25,
  staleMillis: 60_000,
}

export const LivePartitionLockLayer = makeLivePartitionLockLayer()

interface AcquiredLock {
  readonly path: string
  readonly token: string
}

export function makeLivePartitionLockLayer(
  overrides: Partial<PartitionLockOptions> = {},
) {
  const options = { ...defaultPartitionLockOptions, ...overrides }

  return Layer.effect(
    PartitionLock,
    Effect.gen(function* () {
      const config = yield* SlogConfig

      const acquireLock = Effect.fn('slog.PartitionLock.acquire')(function* (
        date: Date,
      ) {
        const path = partitionLockPath(config.home, date)
        yield* ensureLockDirectory(path)
        const deadline = (yield* currentTimeMillis) + options.timeoutMillis
        return yield* acquireLockAttempt(path, deadline, options)
      })

      // Release only removes the lock file if it still carries OUR token.
      // This prevents an acquisition whose lock was stale-reclaimed by another
      // writer from later deleting that other writer's live lock.
      const releaseLock = Effect.fn('slog.PartitionLock.release')(function* (
        lock: AcquiredLock,
      ) {
        yield* unlinkIfOwned(lock.path, lock.token)
      })

      return {
        withLock: <A, E, R>(date: Date, effect: Effect.Effect<A, E, R>) =>
          Effect.acquireUseRelease(
            acquireLock(date),
            () => effect,
            (lock: AcquiredLock) => releaseLock(lock),
          ),
      }
    }),
  )
}

export function partitionLockPath(slogHome: string, date: Date): string {
  return join(slogHome, 'locks', `${localDateStamp(date)}.lock`)
}

const currentTimeMillis = Effect.sync(() => Date.now())

const ensureLockDirectory = Effect.fn('slog.PartitionLock.ensureDirectory')(
  function* (path: string) {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true }),
      catch: ioError,
    })
  },
)

function acquireLockAttempt(
  path: string,
  deadline: number,
  options: PartitionLockOptions,
): Effect.Effect<AcquiredLock, SlogError> {
  return Effect.gen(function* () {
    const token = yield* Effect.sync(() => randomUUID())
    const created = yield* tryCreateLockFile(path, token)
    if (created) return { path, token }

    // The lock mechanism relies solely on atomic exclusive create + file
    // existence; staleness is judged by filesystem mtime, never by lock
    // content (content is diagnostics-only).
    const stale = yield* isLockStale(path, options.staleMillis)
    if (stale) {
      // Reclaim atomically: only unlink the specific stale file we observed
      // (by mtime), then race to recreate. If another writer wins the
      // recreate, we fall through and keep retrying within the deadline.
      yield* reclaimStaleLock(path, options.staleMillis)
      const reclaimedToken = yield* Effect.sync(() => randomUUID())
      const reclaimed = yield* tryCreateLockFile(path, reclaimedToken)
      if (reclaimed) return { path, token: reclaimedToken }
    }

    const now = yield* currentTimeMillis
    if (now >= deadline) {
      return yield* Effect.fail(
        new SlogError('partition_locked', `Partition lock is held: ${path}`, [
          {
            path,
            code: 'partition_locked',
            message: 'Timed out waiting for the partition lock.',
          },
        ]),
      )
    }

    yield* Effect.sleep(`${options.retryMillis} millis`)
    return yield* acquireLockAttempt(path, deadline, options)
  })
}

const tryCreateLockFile = Effect.fn('slog.PartitionLock.tryCreate')(function* (
  path: string,
  token: string,
) {
  const acquiredAt = yield* Effect.sync(() => formatLocalIso(new Date()))
  const body = JSON.stringify({
    token,
    pid: process.pid,
    acquired_at: acquiredAt,
    host: hostname(),
  })

  return yield* Effect.tryPromise({
    try: async () => {
      try {
        await writeFile(path, `${body}\n`, { encoding: 'utf8', flag: 'wx' })
        return true
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw cause
      }
    },
    catch: ioError,
  })
})

// Staleness is determined ONLY by filesystem mtime, never by lock-file JSON.
const isLockStale = Effect.fn('slog.PartitionLock.isStale')(function* (
  path: string,
  staleMillis: number,
) {
  const lockStat = yield* statIfExists(path)
  if (!lockStat) return false
  const now = yield* currentTimeMillis
  return now - lockStat.mtimeMs > staleMillis
})

// Reclaim re-checks staleness immediately before unlinking to shrink the
// TOCTOU window: if the lock was refreshed/replaced (newer mtime) between the
// first stale check and now, we do NOT unlink someone else's live lock.
const reclaimStaleLock = Effect.fn('slog.PartitionLock.reclaimStale')(
  function* (path: string, staleMillis: number) {
    const lockStat = yield* statIfExists(path)
    if (!lockStat) return
    const now = yield* currentTimeMillis
    if (now - lockStat.mtimeMs <= staleMillis) return
    yield* unlinkIfExists(path)
  },
)

const statIfExists = Effect.fn('slog.PartitionLock.statIfExists')(function* (
  path: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        return await stat(path)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw cause
      }
    },
    catch: ioError,
  })
})

const unlinkIfExists = Effect.fn('slog.PartitionLock.unlinkIfExists')(
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

// Release is ownership-aware: only unlink if the on-disk lock still carries
// our token. Protects against deleting a lock that was stale-reclaimed by
// another acquisition after ours was taken over.
const unlinkIfOwned = Effect.fn('slog.PartitionLock.unlinkIfOwned')(function* (
  path: string,
  token: string,
) {
  const onDiskToken = yield* readLockToken(path)
  if (onDiskToken !== token) return
  yield* unlinkIfExists(path)
})

const readLockToken = Effect.fn('slog.PartitionLock.readToken')(function* (
  path: string,
) {
  const content = yield* Effect.tryPromise({
    try: async () => {
      try {
        return await readFile(path, 'utf8')
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw cause
      }
    },
    catch: ioError,
  })
  if (content === undefined) return undefined

  return yield* Effect.sync(() => {
    try {
      const parsed = JSON.parse(content) as { token?: unknown }
      return typeof parsed.token === 'string' ? parsed.token : undefined
    } catch {
      return undefined
    }
  })
})

function ioError(cause: unknown): SlogError {
  return new SlogError(
    'io_error',
    cause instanceof Error ? cause.message : String(cause),
  )
}
