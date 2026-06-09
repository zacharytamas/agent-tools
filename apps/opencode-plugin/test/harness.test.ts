import { describe, expect, test } from 'bun:test'
import type { ToolContext } from '@opencode-ai/plugin'
import { createEntry } from '@tools/slog'
import { makeMockToolContext, runSlog, withTempSlogHome } from './harness.js'

// Compile-time shape check: if this assignment fails tsc, the mock has diverged
// from the SDK ToolContext type. It is intentionally unused at runtime.
const _typeCheck: ToolContext = makeMockToolContext()
void _typeCheck

describe('makeMockToolContext', () => {
  test('returns an object with all required ToolContext fields', () => {
    const ctx = makeMockToolContext()
    expect(typeof ctx.sessionID).toBe('string')
    expect(typeof ctx.messageID).toBe('string')
    expect(typeof ctx.agent).toBe('string')
    expect(typeof ctx.directory).toBe('string')
    expect(typeof ctx.worktree).toBe('string')
    expect(ctx.abort).toBeInstanceOf(AbortSignal)
    expect(typeof ctx.metadata).toBe('function')
    expect(typeof ctx.ask).toBe('function')
  })

  test('overrides replace individual fields while keeping defaults for the rest', () => {
    const ctx = makeMockToolContext({ agent: 'build', sessionID: 'custom-sid' })
    expect(ctx.agent).toBe('build')
    expect(ctx.sessionID).toBe('custom-sid')
    expect(typeof ctx.messageID).toBe('string')
    expect(typeof ctx.directory).toBe('string')
  })

  test('ask() throws the forbidden-ask sentinel error', () => {
    const ctx = makeMockToolContext()
    expect(() =>
      ctx.ask({
        permission: 'test-perm',
        patterns: [],
        always: [],
        metadata: {},
      }),
    ).toThrow('ask() is forbidden in slog tools')
  })

  test('metadata() accepts optional input without throwing', () => {
    const ctx = makeMockToolContext()
    expect(() => ctx.metadata({})).not.toThrow()
    expect(() => ctx.metadata({ title: 'test title' })).not.toThrow()
    expect(() =>
      ctx.metadata({ title: 'x', metadata: { key: 'value' } }),
    ).not.toThrow()
  })
})

describe('withTempSlogHome', () => {
  test('sets SLOG_HOME to a fresh temp directory during fn execution', async () => {
    let capturedHome = ''
    await withTempSlogHome(async (home) => {
      capturedHome = home
      expect(process.env.SLOG_HOME).toBe(home)
    })
    expect(capturedHome).toContain('slog-test-plugin-')
  })

  test('restores prior SLOG_HOME after fn resolves', async () => {
    const prior = process.env.SLOG_HOME
    await withTempSlogHome(async () => {})
    expect(process.env.SLOG_HOME).toBe(prior)
  })

  test('restores prior SLOG_HOME even when fn throws', async () => {
    const prior = process.env.SLOG_HOME
    await expect(
      withTempSlogHome(async () => {
        throw new Error('fn failure')
      }),
    ).rejects.toThrow('fn failure')
    expect(process.env.SLOG_HOME).toBe(prior)
  })
})

describe('runSlog', () => {
  test('createEntry persists and resolves an entry under temp SLOG_HOME', async () => {
    const result = await withTempSlogHome(() =>
      runSlog(
        createEntry({
          text: 'harness self-test entry',
          actor: 'opencode:build',
          authorityMode: 'discretionary',
        }),
      ),
    )
    expect(result.entry.text).toBe('harness self-test entry')
    expect(result.entry.actor).toBe('opencode:build')
    expect(result.entry.authority.mode).toBe('discretionary')
    expect(typeof result.entry.id).toBe('string')
    expect(result.entry.needs_triage).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })
})
