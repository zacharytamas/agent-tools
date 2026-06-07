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

export function renderHumanTriageList(
  date: Date,
  entries: ReadonlyArray<Entry>,
  options: { readonly all?: boolean } = {},
): string {
  const groups = options.all
    ? groupEntriesByLocalDate(entries)
    : [
        {
          stamp: localDateStamp(date),
          entries: sortEntriesByCreatedAt(entries),
        },
      ]

  if (groups.length === 0) return ''

  return `${groups
    .map((group) => {
      const lines = [group.stamp, '']
      for (const entry of group.entries) {
        lines.push(
          `${localTimeStamp(entry.created_at)}  ${entry.id}  ${entry.text}`,
        )
      }
      return lines.join('\n')
    })
    .join('\n\n')}\n`
}

function groupEntriesByLocalDate(entries: ReadonlyArray<Entry>): ReadonlyArray<{
  readonly stamp: string
  readonly entries: ReadonlyArray<Entry>
}> {
  const grouped = new Map<string, Entry[]>()
  for (const entry of entries) {
    const stamp = localDateStamp(new Date(entry.created_at))
    const group = grouped.get(stamp)
    if (group) {
      group.push(entry)
    } else {
      grouped.set(stamp, [entry])
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stamp, dayEntries]) => ({
      stamp,
      entries: sortEntriesByCreatedAt(dayEntries),
    }))
}

function sortEntriesByCreatedAt(
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<Entry> {
  return [...entries].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  )
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
