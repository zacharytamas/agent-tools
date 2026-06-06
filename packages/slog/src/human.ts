import type { Entry } from './domain.js'
import { localDateStamp, localTimeStamp } from './environment.js'

export function renderHumanList(
  date: Date,
  entries: ReadonlyArray<Entry>,
): string {
  const lines = [localDateStamp(date), '']
  for (const entry of entries) {
    const time = localTimeStamp(entry.created_at)
    lines.push(
      entry.needs_triage
        ? `${time}  TRIAGE  ${entry.id}  ${entry.text}`
        : `${time}  ${entry.id}  ${entry.text}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function renderHumanShow(entry: Entry): string {
  const lines = [
    `ID:        ${entry.id}`,
    `Created:   ${entry.created_at}`,
    ...(entry.occurred_at ? [`Occurred:  ${entry.occurred_at}`] : []),
    `Actor:     ${entry.actor}`,
    `Authority: ${entry.authority.source} / ${entry.authority.mode}`,
    `Triage:    ${entry.needs_triage ? 'yes' : 'no'}`,
    '',
    entry.text,
  ]
  return `${lines.join('\n')}\n`
}
