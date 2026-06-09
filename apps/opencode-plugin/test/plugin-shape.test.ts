import { expect, test } from 'bun:test'
import type { Hooks, PluginInput, ToolResult } from '@opencode-ai/plugin'
import AgentToolsPlugin from '../src/index.js'
import { makeMockToolContext, withTempSlogHome } from './harness.js'

const mockInput = {} as PluginInput

function requireTools(hooks: Hooks): NonNullable<Hooks['tool']> {
  if (!hooks.tool) throw new Error('expected hooks.tool to be defined')
  return hooks.tool
}

function outputText(result: ToolResult): string {
  return typeof result === 'string' ? result : result.output
}

function entryIdFrom(result: ToolResult): string {
  if (typeof result === 'string') {
    throw new Error('expected structured ToolResult metadata with entryId')
  }
  const entryId = result.metadata?.entryId
  if (typeof entryId !== 'string') {
    throw new Error('expected entryId metadata to be a string')
  }
  return entryId
}

test('registered slog tools support log, find, correct, and list lifecycle', async () => {
  const hooks: Hooks = await AgentToolsPlugin(mockInput)
  const tools = requireTools(hooks)

  const keys = Object.keys(tools).sort()
  expect(keys).toEqual(['slog_correct', 'slog_find', 'slog_list', 'slog_log'])
  expect(keys).not.toContain('slog_ping')
  expect(keys.some((key) => key.includes('delete'))).toBe(false)
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys.every((key) => key.startsWith('slog_'))).toBe(true)

  await withTempSlogHome(async () => {
    const ctx = makeMockToolContext({ agent: 'build' })
    const created = await tools.slog_log.execute({ text: 'draft note' }, ctx)
    const entryId = entryIdFrom(created)

    const foundDraft = await tools.slog_find.execute({ id: entryId }, ctx)
    expect(outputText(foundDraft)).toContain('draft note')

    const corrected = await tools.slog_correct.execute(
      { id: entryId, text: 'final note' },
      ctx,
    )
    expect(outputText(corrected)).toContain('final note')

    const listed = await tools.slog_list.execute({}, ctx)
    const listOutput = outputText(listed)
    expect(listOutput).toContain('final note')
    expect(listOutput).not.toContain('draft note')
  })
})
