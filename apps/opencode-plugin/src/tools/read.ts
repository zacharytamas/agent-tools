import { tool } from '@opencode-ai/plugin'
import {
  type Entry,
  type EntryFilter,
  findEntryById,
  listEntries,
  SlogError,
} from '@tools/slog'
import { Option } from 'effect'
import { runSlog } from './shared.js'

function formatEntry(entry: Entry): string {
  const triage = entry.needs_triage ? 'needs-triage' : 'settled'
  const time = entry.occurred_at ?? entry.created_at
  return `[${entry.id}] ${time} | ${entry.authority.mode} | ${triage}\n${entry.text}`
}

function formatSlogError(err: SlogError): string {
  const lines: string[] = [`Error (${err.code}): ${err.message}`]
  for (const detail of err.details) {
    lines.push(`  - ${detail.path}: [${detail.code}] ${detail.message}`)
  }
  return lines.join('\n')
}

export const slogListTool = tool({
  description:
    "List slog entries with optional filters. Omit all args to list today's entries.",
  args: {
    needsTriage: tool.schema
      .boolean()
      .optional()
      .describe(
        'Filter by triage status: true = needs triage, false = settled',
      ),
    actor: tool.schema
      .string()
      .optional()
      .describe('Filter to entries created by this actor identity'),
    authoritySource: tool.schema
      .string()
      .optional()
      .describe('Filter to entries with this authority source identity'),
    authorityMode: tool.schema
      .union([
        tool.schema.literal('direct'),
        tool.schema.literal('delegated'),
        tool.schema.literal('discretionary'),
        tool.schema.literal('observed'),
        tool.schema.literal('imported'),
        tool.schema.literal('derived'),
      ])
      .optional()
      .describe('Filter to entries with this authority mode'),
    textQuery: tool.schema
      .string()
      .optional()
      .describe(
        'Filter to entries whose text contains this substring (case-insensitive)',
      ),
    dateRange: tool.schema
      .object({
        start: tool.schema.string().describe('Start date, e.g. 2024-01-01'),
        end: tool.schema.string().describe('End date, e.g. 2024-01-31'),
      })
      .optional()
      .describe(
        "Date range for created_at; omit to default to today's entries",
      ),
  },
  async execute(args) {
    let filter: EntryFilter = {}

    if (args.needsTriage !== undefined) {
      filter = { ...filter, needsTriage: args.needsTriage }
    }
    if (args.actor !== undefined) {
      filter = { ...filter, actor: args.actor }
    }
    if (args.authoritySource !== undefined) {
      filter = { ...filter, authoritySource: args.authoritySource }
    }
    if (args.authorityMode !== undefined) {
      filter = { ...filter, authorityMode: args.authorityMode }
    }
    if (args.textQuery !== undefined) {
      filter = { ...filter, textQuery: args.textQuery }
    }

    if (args.dateRange !== undefined) {
      const start = new Date(args.dateRange.start)
      const end = new Date(args.dateRange.end)
      if (Number.isNaN(start.getTime())) {
        const err = new SlogError(
          'validation_failed',
          `dateRange.start is not a valid date: "${args.dateRange.start}"`,
        )
        return {
          output: formatSlogError(err),
          metadata: {
            error: {
              code: err.code,
              field: 'dateRange.start',
              value: args.dateRange.start,
            },
          },
        }
      }
      if (Number.isNaN(end.getTime())) {
        const err = new SlogError(
          'validation_failed',
          `dateRange.end is not a valid date: "${args.dateRange.end}"`,
        )
        return {
          output: formatSlogError(err),
          metadata: {
            error: {
              code: err.code,
              field: 'dateRange.end',
              value: args.dateRange.end,
            },
          },
        }
      }
      filter = { ...filter, dateRange: { start, end } }
    }

    const entries = await runSlog(listEntries(filter))

    if (entries.length === 0) {
      return { output: 'No entries found.' }
    }

    return { output: entries.map(formatEntry).join('\n\n') }
  },
})

export const slogFindTool = tool({
  description: 'Retrieve a single slog entry by its full ULID id.',
  args: {
    id: tool.schema.string().describe('Full ULID of the entry to retrieve'),
  },
  async execute(args) {
    let result: Option.Option<Entry>
    try {
      result = await runSlog(findEntryById(args.id))
    } catch (err) {
      if (err instanceof SlogError) {
        return {
          output: formatSlogError(err),
          metadata: {
            error: {
              code: err.code,
              message: err.message,
              details: err.details,
            },
          },
        }
      }
      throw err
    }

    if (Option.isSome(result)) {
      const entry = result.value
      const triage = entry.needs_triage ? 'needs-triage' : 'settled'
      const lines = [
        `id:        ${entry.id}`,
        `created:   ${entry.created_at}`,
        ...(entry.occurred_at !== undefined
          ? [`occurred:  ${entry.occurred_at}`]
          : []),
        `actor:     ${entry.actor}`,
        `authority: ${entry.authority.mode} / ${entry.authority.source}`,
        `triage:    ${triage}`,
        '',
        entry.text,
      ]
      return { output: lines.join('\n') }
    }

    // Option.isNone — graceful non-error not-found
    return { output: `No entry found with id: ${args.id}` }
  },
})
