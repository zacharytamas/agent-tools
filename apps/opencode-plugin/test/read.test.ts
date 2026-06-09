import { describe, expect, test } from 'bun:test'
import type { ToolResult } from '@opencode-ai/plugin'
import { createEntry } from '@tools/slog'
import { slogFindTool, slogListTool } from '../src/tools/read.js'
import { makeMockToolContext, runSlog, withTempSlogHome } from './harness.js'

const ctx = makeMockToolContext()

// A syntactically valid ULID that cannot exist in any freshly-seeded test store.
const ABSENT_ULID = '01ARYZ3NDEKTSV4RRFFQ69G5FV'

function outputText(result: ToolResult): string {
  return typeof result === 'string' ? result : result.output
}

function errorMeta(result: ToolResult): unknown {
  if (typeof result === 'string') return undefined
  return result.metadata?.error
}

describe('slogListTool', () => {
  test('returns all seeded entries when no filter is applied', async () => {
    const result = await withTempSlogHome(async () => {
      await runSlog(
        createEntry({
          text: 'first entry',
          actor: 'opencode:build',
          authorityMode: 'discretionary',
        }),
      )
      await runSlog(
        createEntry({
          text: 'second entry',
          actor: 'opencode:build',
          authorityMode: 'delegated',
          authoritySource: 'zachary',
          needsTriage: false,
        }),
      )
      return slogListTool.execute({}, ctx)
    })

    const text = outputText(result)
    expect(text).toContain('first entry')
    expect(text).toContain('second entry')
  })

  test('filters to only entries needing triage when needsTriage is true', async () => {
    const result = await withTempSlogHome(async () => {
      await runSlog(
        createEntry({
          text: 'entry needing triage',
          actor: 'opencode:build',
          authorityMode: 'discretionary',
        }),
      )
      await runSlog(
        createEntry({
          text: 'settled entry',
          actor: 'opencode:build',
          authorityMode: 'delegated',
          authoritySource: 'zachary',
          needsTriage: false,
        }),
      )
      return slogListTool.execute({ needsTriage: true }, ctx)
    })

    const text = outputText(result)
    expect(text).toContain('entry needing triage')
    expect(text).not.toContain('settled entry')
  })
})

describe('slogFindTool', () => {
  test('returns entry detail when the entry exists (Option.some)', async () => {
    const result = await withTempSlogHome(async () => {
      const { entry } = await runSlog(
        createEntry({
          text: 'findable entry',
          actor: 'opencode:build',
          authorityMode: 'discretionary',
        }),
      )
      return slogFindTool.execute({ id: entry.id }, ctx)
    })

    const text = outputText(result)
    expect(text).toContain('findable entry')
    expect(text).toContain('opencode:build')
    expect(text).toContain('discretionary')
  })

  test('returns graceful not-found message when entry is absent (Option.none, not an error)', async () => {
    const result = await withTempSlogHome(() =>
      slogFindTool.execute({ id: ABSENT_ULID }, ctx),
    )

    const text = outputText(result)
    expect(text).toContain('No entry found')
    expect(errorMeta(result)).toBeUndefined()
  })

  test('returns structured error result for an invalid ULID (validation_failed)', async () => {
    const result = await withTempSlogHome(() =>
      slogFindTool.execute({ id: 'not-a-valid-ulid' }, ctx),
    )

    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.output).toContain('Error')
      expect((result.metadata?.error as { code?: string })?.code).toBe(
        'validation_failed',
      )
    }
  })
})
