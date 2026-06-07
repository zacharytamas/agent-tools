import type { Entry, SlogError } from './domain.js'
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

export function renderHumanMutation(verb: string, entry: Entry): string {
  return `${verb} ${entry.id}  ${mutationSnippet(entry.text)}`
}

function mutationSnippet(text: string): string {
  const collapsed = collapseNewlines(text)
  const characters = Array.from(collapsed)
  if (characters.length <= 60) return collapsed
  return `${characters.slice(0, 60).join('')}…`
}

function collapseNewlines(text: string): string {
  let collapsed = ''
  let inNewline = false
  for (const character of text) {
    if (character === '\n' || character === '\r') {
      if (!inNewline) collapsed += ' '
      inNewline = true
    } else {
      collapsed += character
      inNewline = false
    }
  }
  return collapsed
}

// Renders a SlogError as a single human-readable line for stderr. Human
// commands surface failures this way (clean message, nonzero exit) rather
// than via the machine JSON envelope or an unhandled stack trace. Certain
// codes use the doctrine-specified human phrasing, reading the entry id from
// the error's `id` detail when present.
export function renderHumanError(error: SlogError): string {
  const idDetail = error.details.find((detail) => detail.code === 'entry_id')
  const id = idDetail?.message

  if (error.code === 'entry_not_found' && id) {
    return `Entry not found: ${id}`
  }
  if (error.code === 'storage_corrupt' && id) {
    return `Storage corrupt: multiple records found for ${id}`
  }

  const detail = error.details.find((entry) => entry.path.length > 0)
  if (detail) {
    return `${error.message} (${detail.path})`
  }
  return error.message
}
