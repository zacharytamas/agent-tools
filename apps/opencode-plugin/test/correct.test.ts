import { describe, expect, test } from 'bun:test'
import { createEntry, findEntryById } from '@tools/slog'
import { Option } from 'effect'
import { correctTool } from '../src/tools/correct.js'
import { makeMockToolContext, runSlog, withTempSlogHome } from './harness.js'

const ctx = makeMockToolContext()

// A syntactically valid ULID that will not exist in any fresh temp store.
const MISSING_ULID = '01J00000000000000000000000'

function getOutput(
  result: Awaited<ReturnType<typeof correctTool.execute>>,
): string {
  return typeof result === 'string' ? result : result.output
}

describe('correct tool', () => {
  test('updates the text of an existing entry', async () => {
    await withTempSlogHome(async () => {
      const { entry } = await runSlog(
        createEntry({
          text: 'original wording',
          actor: 'opencode:test',
          authorityMode: 'discretionary',
        }),
      )

      const result = await correctTool.execute(
        { id: entry.id, text: 'corrected wording' },
        ctx,
      )

      expect(getOutput(result)).toContain('corrected wording')
      expect(getOutput(result)).not.toContain('original wording')

      const found = await runSlog(findEntryById(entry.id))
      if (!Option.isSome(found))
        throw new Error(`reload failed: entry ${entry.id} not found`)
      expect(found.value.text).toBe('corrected wording')
    })
  })

  test('clears occurredAt when null is passed', async () => {
    await withTempSlogHome(async () => {
      const { entry } = await runSlog(
        createEntry({
          text: 'timed entry',
          actor: 'opencode:test',
          authorityMode: 'discretionary',
          occurredAt: '2026-06-05T10:00:00+00:00',
        }),
      )

      const result = await correctTool.execute(
        { id: entry.id, occurredAt: null },
        ctx,
      )

      const output = getOutput(result)
      expect(output).toContain('id:')
      expect(output).not.toContain('occurred_at')

      const found = await runSlog(findEntryById(entry.id))
      if (!Option.isSome(found))
        throw new Error(`reload failed: entry ${entry.id} not found`)
      expect(found.value.occurred_at).toBeUndefined()
    })
  })

  test('toggles needsTriage from true to false', async () => {
    await withTempSlogHome(async () => {
      const { entry } = await runSlog(
        createEntry({
          text: 'triage entry',
          actor: 'opencode:test',
          authorityMode: 'discretionary',
        }),
      )
      expect(entry.needs_triage).toBe(true)

      const result = await correctTool.execute(
        { id: entry.id, needsTriage: false },
        ctx,
      )

      expect(getOutput(result)).toContain('needs_triage: false')

      const found = await runSlog(findEntryById(entry.id))
      if (!Option.isSome(found))
        throw new Error(`reload failed: entry ${entry.id} not found`)
      expect(found.value.needs_triage).toBe(false)
    })
  })

  test('returns entry_not_found error for an unknown id', async () => {
    await withTempSlogHome(async () => {
      const result = await correctTool.execute(
        { id: MISSING_ULID, text: 'any text' },
        ctx,
      )

      expect(getOutput(result)).toContain('entry_not_found')
    })
  })

  test('returns validation_failed when no mutable fields are provided', async () => {
    await withTempSlogHome(async () => {
      const result = await correctTool.execute({ id: MISSING_ULID }, ctx)

      expect(getOutput(result)).toContain('validation_failed')
    })
  })
})
