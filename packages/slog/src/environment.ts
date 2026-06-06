import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { SlogError, validateIdentity } from './domain.js'

export interface SlogConfigShape {
  readonly home: string
  readonly user: string
}

export class SlogConfig extends Context.Service<SlogConfig, SlogConfigShape>()(
  '@tools/slog/SlogConfig',
) {}

export interface FixedClockShape {
  readonly now: Effect.Effect<Date>
}

export class FixedClock extends Context.Service<FixedClock, FixedClockShape>()(
  '@tools/slog/FixedClock',
) {}

export interface IdGeneratorShape {
  readonly next: (now: Date) => Effect.Effect<string>
}

export class IdGenerator extends Context.Service<
  IdGenerator,
  IdGeneratorShape
>()('@tools/slog/IdGenerator') {}

export const LiveClockLayer = Layer.succeed(FixedClock, {
  now: Effect.sync(() => new Date()),
})

export const LiveIdGeneratorLayer = Layer.succeed(IdGenerator, {
  next: (now) => Effect.sync(() => generateUlid(now)),
})

export const LiveSlogConfigLayer = Layer.effect(
  SlogConfig,
  Effect.gen(function* () {
    const home = resolveSlogHome(process.env.SLOG_HOME, homedir())
    const user = yield* loadConfiguredUser(home, userInfo().username)
    return { home, user }
  }),
)

export function resolveSlogHome(
  override: string | undefined,
  homeDir: string,
): string {
  return resolve(override?.trim() ? override : join(homeDir, '.slog'))
}

function loadConfiguredUser(
  home: string,
  fallbackUsername: string,
): Effect.Effect<string, SlogError> {
  return Effect.tryPromise({
    try: async () => {
      const configPath = join(home, 'config.toml')
      let text: string
      try {
        text = await readFile(configPath, 'utf8')
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
          return validateIdentity(fallbackUsername, 'OS username')
        throw cause
      }

      let parsed: unknown
      try {
        parsed = Bun.TOML.parse(text)
      } catch (cause) {
        throw new SlogError(
          'invalid_config',
          `Invalid config.toml: ${(cause as Error).message}`,
        )
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('user' in parsed)
      ) {
        throw new SlogError(
          'invalid_config',
          'Invalid config.toml: user must be a non-empty string.',
        )
      }
      const unsupported = Object.keys(parsed).filter((key) => key !== 'user')
      if (unsupported.length > 0) {
        throw new SlogError(
          'invalid_config',
          'Invalid config.toml: only user is supported.',
        )
      }
      const user = (parsed as { user?: unknown }).user
      if (typeof user !== 'string') {
        throw new SlogError(
          'invalid_config',
          'Invalid config.toml: user must be a non-empty string.',
        )
      }
      try {
        return validateIdentity(user, 'config user')
      } catch {
        throw new SlogError(
          'invalid_config',
          'Invalid config.toml: user must be a non-empty string without leading/trailing whitespace or control characters.',
        )
      }
    },
    catch: (cause) =>
      cause instanceof SlogError
        ? cause
        : new SlogError(
            'io_error',
            cause instanceof Error ? cause.message : String(cause),
          ),
  })
}

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const charValues = new Map(
  [...alphabet].map((char, index) => [char, BigInt(index)]),
)

export function generateUlid(now: Date): string {
  const time = BigInt(now.getTime())
  if (time < 0n || time > 0xffffffffffffn) {
    throw new SlogError('validation_failed', 'ULID timestamp is out of range.')
  }

  let encodedTime = ''
  let remaining = time
  for (let index = 0; index < 10; index += 1) {
    encodedTime = alphabet[Number(remaining & 31n)] + encodedTime
    remaining >>= 5n
  }

  let encodedRandom = ''
  const bytes = randomBytes(10)
  let random = bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
  for (let index = 0; index < 16; index += 1) {
    encodedRandom = alphabet[Number(random & 31n)] + encodedRandom
    random >>= 5n
  }

  return encodedTime + encodedRandom
}

export function decodeUlidTimestamp(id: string): Date {
  let value = 0n
  for (const char of id.slice(0, 10)) {
    const charValue = charValues.get(char)
    if (charValue === undefined) {
      throw new SlogError('validation_failed', 'id must be a full ULID.')
    }
    value = (value << 5n) | charValue
  }
  return new Date(Number(value))
}

export function formatLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

export function localDateStamp(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localTimeStamp(timestamp: string): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}
