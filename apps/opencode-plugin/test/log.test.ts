import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolContext, ToolResult } from '@opencode-ai/plugin'
import { listEntries, type Warning } from '@tools/slog'
import {
  buildLogToolErrorResult,
  executeLogTool,
  mergeWarnings,
  slogLogTool,
} from '../src/tools/log.js'
import { makeMockToolContext, runSlog, withTempSlogHome } from './harness.js'

type LogToolArgs = Parameters<typeof slogLogTool.execute>[0]

interface StructuredToolResult {
  readonly title?: string
  readonly output: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

function structured(result: ToolResult): StructuredToolResult {
  if (typeof result === 'string')
    throw new Error('expected structured ToolResult')
  return result
}

async function executeLog(args: LogToolArgs, context?: Partial<ToolContext>) {
  const ctx = makeMockToolContext({ agent: 'build', ...context })
  const result = await slogLogTool.execute(args, ctx)
  const entries = await runSlog(listEntries())
  return { result: structured(result), entries }
}

describe('slog_log tool', () => {
  test('delegated authority records resolved human identity as authority source', async () => {
    await withTempSlogHome(async (home) => {
      await writeFile(join(home, 'config.toml'), 'user = "zachary"\n')

      const { result, entries } = await executeLog({
        text: 'Reviewed PR',
        authorityMode: 'delegated',
      })

      expect(entries).toHaveLength(1)
      const [entry] = entries
      expect(entry.text).toBe('Reviewed PR')
      expect(entry.actor).toBe('opencode:build')
      expect(entry.authority).toEqual({ source: 'zachary', mode: 'delegated' })
      expect(entry.needs_triage).toBe(false)
      expect(result.metadata?.entryId).toBe(entry.id)
      expect(result.metadata?.authorityMode).toBe('delegated')
      expect(result.metadata?.warnings).toEqual([])
      expect(result.output).toContain(entry.id)
      expect(result.output).toContain('mode=delegated')
    })
  })

  test('explicit discretionary authority records actor authority and needs triage', async () => {
    await withTempSlogHome(async () => {
      const { result, entries } = await executeLog({
        text: 'noticed a flaky test',
        authorityMode: 'discretionary',
      })

      expect(entries).toHaveLength(1)
      const [entry] = entries
      expect(entry.authority).toEqual({
        source: 'opencode:build',
        mode: 'discretionary',
      })
      expect(entry.needs_triage).toBe(true)
      expect(result.metadata?.authorityMode).toBe('discretionary')
      expect(result.metadata?.needsTriage).toBe(true)
    })
  })

  test('omitted authority mode defaults to safe discretionary actor authority', async () => {
    await withTempSlogHome(async () => {
      const { result, entries } = await executeLog({
        text: 'defaulted to discretionary',
      })

      expect(entries).toHaveLength(1)
      const [entry] = entries
      expect(entry.authority.mode).toBe('discretionary')
      expect(entry.authority.source).toBe('opencode:build')
      expect(entry.needs_triage).toBe(true)
      expect(result.output).toContain('mode=discretionary')
    })
  })

  test('delegated authority downgrades when local identity is unresolvable', async () => {
    await withTempSlogHome(async () => {
      const ctx = makeMockToolContext({ agent: 'solo' })
      const result = structured(
        await executeLogTool(
          { text: 'delegated without identity', authorityMode: 'delegated' },
          ctx,
          () => undefined,
        ),
      )
      const entries = await runSlog(listEntries())

      expect(entries).toHaveLength(1)
      const [entry] = entries
      expect(entry.actor).toBe('opencode:solo')
      expect(entry.authority).toEqual({
        source: 'opencode:solo',
        mode: 'discretionary',
      })
      expect(entry.needs_triage).toBe(true)
      expect(result.metadata?.warnings).toEqual([
        {
          code: 'authority_downgraded',
          message:
            'Delegated authority requires a resolved human identity distinct from the OpenCode actor; downgraded to discretionary.',
        },
      ])
      expect(result.output).toContain('warnings=authority_downgraded')
    })
  })

  test('missing or empty text returns a structured validation error without asking', async () => {
    await withTempSlogHome(async () => {
      const execute = slogLogTool.execute as (
        args: Readonly<Record<string, unknown>>,
        context: ToolContext,
      ) => Promise<ToolResult>
      const result = structured(await execute({}, makeMockToolContext()))

      expect(result.title).toBe('slog_log error')
      expect(result.metadata?.errorCode).toBe('validation_failed')
      expect(result.metadata?.details).toEqual([
        {
          path: 'text',
          code: 'required',
          message: 'text must be a non-empty string.',
        },
      ])
      expect(result.output).toContain('text must be a non-empty string')

      const empty = structured(
        await slogLogTool.execute({ text: '' }, makeMockToolContext()),
      )
      expect(empty.metadata?.errorCode).toBe('validation_failed')
    })
  })

  test('SlogError failures return structured tool errors without raw envelopes', async () => {
    await withTempSlogHome(async () => {
      const result = structured(
        await slogLogTool.execute(
          { text: 'bad timestamp', occurredAt: '2026-06-09T12:00:00Z' },
          makeMockToolContext({ agent: 'build' }),
        ),
      )

      expect(result.title).toBe('slog_log error')
      expect(result.metadata?.errorCode).toBe('validation_failed')
      expect(result.output).toContain('Invalid log input')
      expect(result.output).toContain('explicit offset')
      expect(result.output).not.toContain('"error"')
    })
  })

  test('provenance warnings merge with core warnings in order', () => {
    const provenanceWarning: Warning = {
      code: 'authority_downgraded',
      message: 'downgraded',
    }
    const coreWarning: Warning = {
      code: 'needs_triage_forced',
      message: 'forced',
    }

    expect(mergeWarnings([provenanceWarning], [coreWarning])).toEqual([
      provenanceWarning,
      coreWarning,
    ])
  })

  test('plain failures map to safe structured tool errors', () => {
    const result = structured(buildLogToolErrorResult(new Error('kapow')))

    expect(result.metadata?.errorCode).toBe('internal_error')
    expect(result.output).toContain('Unable to write slog entry')
    expect(result.output).not.toContain('kapow')
  })
})
