import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from '@opencode-ai/plugin'
import { SlogLive } from '@tools/slog'
import { Effect, type Layer } from 'effect'

/**
 * Returns a type-accurate mock ToolContext for use in plugin tool tests.
 * The `ask()` method throws unconditionally to enforce guardrail S4: slog
 * tools must never call `ask()`. Any test that exercises a code path which
 * calls `ask()` will fail loudly rather than silently hang.
 */
export function makeMockToolContext(
  overrides?: Partial<ToolContext>,
): ToolContext {
  return {
    sessionID: 'mock-session-id',
    messageID: 'mock-message-id',
    agent: 'test',
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => {
      throw new Error('ask() is forbidden in slog tools')
    },
    ...overrides,
  }
}

/**
 * Runs `fn` under an isolated temp directory wired as `SLOG_HOME`.
 * Restores the previous `SLOG_HOME` value (or unsets it) and removes the temp
 * directory on completion or failure.
 */
export async function withTempSlogHome<T>(
  fn: (tempHome: string) => Promise<T>,
): Promise<T> {
  const tempHome = await mkdtemp(join(tmpdir(), 'slog-test-plugin-'))
  const prev = process.env.SLOG_HOME
  process.env.SLOG_HOME = tempHome
  try {
    return await fn(tempHome)
  } finally {
    if (prev === undefined) {
      delete process.env.SLOG_HOME
    } else {
      process.env.SLOG_HOME = prev
    }
    await rm(tempHome, { recursive: true, force: true })
  }
}

export function runSlog<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(SlogLive as unknown as Layer.Layer<R, never, never>),
    ),
  )
}
