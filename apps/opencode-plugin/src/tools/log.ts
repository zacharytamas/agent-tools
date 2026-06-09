import { type ToolContext, type ToolResult, tool } from '@opencode-ai/plugin'
import {
  type CreateEntryInput,
  createEntry,
  type MachineEntryEnvelope,
  SlogError,
  type Warning,
} from '@tools/slog'
import { resolveLocalUser, resolveProvenance } from '../provenance.js'
import { runSlog } from './shared.js'

type LogToolResolveUser = () => string | undefined | Promise<string | undefined>

interface LogToolArgs {
  readonly text?: string | undefined
  readonly authorityMode?: 'delegated' | 'discretionary' | undefined
  readonly occurredAt?: string | undefined
}

interface LogToolErrorDetail {
  readonly path: string
  readonly code: string
  readonly message: string
}

export const slogLogTool = tool({
  description:
    'Write a slog entry from the current OpenCode turn using delegated or discretionary authority.',
  args: {
    text: tool.schema.string().min(1).describe('Non-empty text to persist.'),
    authorityMode: tool.schema
      .enum(['delegated', 'discretionary'])
      .optional()
      .describe('Authority mode requested for this log entry.'),
    occurredAt: tool.schema
      .string()
      .optional()
      .describe('Optional ISO 8601 timestamp with an explicit offset.'),
  },
  async execute(args, ctx) {
    return executeLogTool(args, ctx, resolveLocalUser)
  },
})

export const logTool = slogLogTool

export async function executeLogTool(
  args: LogToolArgs,
  ctx: ToolContext,
  resolveUser: LogToolResolveUser = resolveLocalUser,
): Promise<ToolResult> {
  const validText = validateTextArg(args)
  if (validText === undefined) {
    return buildLogToolErrorResult(
      new SlogError('validation_failed', 'text must be a non-empty string.', [
        {
          path: 'text',
          code: 'required',
          message: 'text must be a non-empty string.',
        },
      ]),
    )
  }

  try {
    const provenance = await resolveProvenance({
      agent: ctx.agent,
      authorityMode: args.authorityMode,
      resolveUser,
    })
    const input: CreateEntryInput = {
      text: validText,
      actor: provenance.actor,
      authorityMode: provenance.authorityMode,
      authoritySource: provenance.authoritySource,
      ...(args.occurredAt !== undefined ? { occurredAt: args.occurredAt } : {}),
    }
    const envelope = await runSlog(createEntry(input))
    return buildLogToolSuccessResult(
      envelope,
      mergeWarnings(provenance.warnings, envelope.warnings),
    )
  } catch (cause) {
    return buildLogToolErrorResult(cause)
  }
}

export function mergeWarnings(
  provenanceWarnings: ReadonlyArray<Warning>,
  coreWarnings: ReadonlyArray<Warning>,
): ReadonlyArray<Warning> {
  return [...provenanceWarnings, ...coreWarnings]
}

export function buildLogToolErrorResult(cause: unknown): ToolResult {
  if (cause instanceof SlogError) {
    const details = cause.details.map((detail) => ({
      path: detail.path,
      code: detail.code,
      message: detail.message,
    }))
    return {
      title: 'slog_log error',
      output: renderSlogError(cause, details),
      metadata: {
        errorCode: cause.code,
        details,
      },
    }
  }

  return {
    title: 'slog_log error',
    output: 'Unable to write slog entry. Retry later or inspect slog storage.',
    metadata: {
      errorCode: 'internal_error',
      details: [],
    },
  }
}

function buildLogToolSuccessResult(
  envelope: MachineEntryEnvelope,
  warnings: ReadonlyArray<Warning>,
): ToolResult {
  const { entry } = envelope
  const warningCodes = warnings.map((warning) => warning.code)
  const warningSummary =
    warningCodes.length === 0 ? 'none' : warningCodes.join(',')

  return {
    title: 'slog entry created',
    output: `Created slog entry ${entry.id} mode=${entry.authority.mode} needs_triage=${entry.needs_triage} warnings=${warningSummary}`,
    metadata: {
      entryId: entry.id,
      authorityMode: entry.authority.mode,
      authoritySource: entry.authority.source,
      actor: entry.actor,
      needsTriage: entry.needs_triage,
      warnings,
    },
  }
}

function validateTextArg(args: LogToolArgs): string | undefined {
  if (typeof args.text !== 'string') return undefined
  return args.text.trim().length === 0 ? undefined : args.text
}

function renderSlogError(
  error: SlogError,
  details: ReadonlyArray<LogToolErrorDetail>,
): string {
  const friendly = friendlyErrorMessage(error.code)
  const detailText = details.map((detail) => detail.message).join(' ')
  return detailText
    ? `${friendly}: ${detailText}`
    : `${friendly}: ${error.message}`
}

function friendlyErrorMessage(code: string): string {
  if (code === 'validation_failed') return 'Invalid log input'
  if (code === 'partition_locked') return 'Slog storage is busy'
  if (code === 'storage_corrupt') return 'Slog storage needs repair'
  return 'Unable to write slog entry'
}
