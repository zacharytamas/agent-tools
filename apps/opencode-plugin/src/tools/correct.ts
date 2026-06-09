import { type ToolResult, tool } from '@opencode-ai/plugin'
import { SlogError, type UpdateEntryInput, updateEntry } from '@tools/slog'
import { runSlog } from './shared.js'

function formatEntry(entry: {
  id: string
  text: string
  needs_triage: boolean
  actor: string
  occurred_at?: string | undefined
}): string {
  const lines = [
    `id: ${entry.id}`,
    `text: ${entry.text}`,
    `needs_triage: ${entry.needs_triage}`,
    `actor: ${entry.actor}`,
  ]
  if (entry.occurred_at !== undefined) {
    lines.push(`occurred_at: ${entry.occurred_at}`)
  }
  return lines.join('\n')
}

function errorResult(err: SlogError): ToolResult {
  return { title: 'Error', output: `${err.code}: ${err.message}` }
}

export const correctTool = tool({
  description:
    'Update a slog entry. Provide the entry id and at least one of text, occurredAt, or needsTriage. Pass occurredAt: null to clear the occurred_at field.',
  args: {
    id: tool.schema.string().describe('Full ULID of the entry to update'),
    text: tool.schema
      .string()
      .optional()
      .describe('New text content (non-empty)'),
    occurredAt: tool.schema
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 offset timestamp, or null to clear the field'),
    needsTriage: tool.schema
      .boolean()
      .optional()
      .describe('Triage state (true = needs review, false = settled)'),
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const hasMutableField =
      args.text !== undefined ||
      args.occurredAt !== undefined ||
      args.needsTriage !== undefined

    if (!hasMutableField) {
      return {
        title: 'Validation Error',
        output:
          'validation_failed: at least one of text, occurredAt, or needsTriage must be provided',
      }
    }

    const updateInput: UpdateEntryInput = {
      id: args.id,
      ...(args.text !== undefined ? { text: args.text } : {}),
      ...(args.occurredAt !== undefined ? { occurredAt: args.occurredAt } : {}),
      ...(args.needsTriage !== undefined
        ? { needsTriage: args.needsTriage }
        : {}),
    }

    try {
      const result = await runSlog(updateEntry(updateInput))
      return { title: 'Entry updated', output: formatEntry(result.entry) }
    } catch (err) {
      if (err instanceof SlogError) return errorResult(err)
      return { title: 'Error', output: 'Unexpected error during update' }
    }
  },
})
