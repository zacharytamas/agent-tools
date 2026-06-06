import { Schema } from 'effect'

export const AuthorityMode = Schema.Literals([
  'direct',
  'delegated',
  'discretionary',
  'observed',
  'imported',
  'derived',
])
export type AuthorityMode = typeof AuthorityMode.Type

export class Authority extends Schema.Class<Authority>('Authority')({
  source: Schema.NonEmptyString,
  mode: AuthorityMode,
}) {}

export class Entry extends Schema.Class<Entry>('Entry')({
  id: Schema.String,
  created_at: Schema.String,
  occurred_at: Schema.optional(Schema.String),
  text: Schema.NonEmptyString,
  actor: Schema.NonEmptyString,
  authority: Authority,
  needs_triage: Schema.Boolean,
}) {}

export class SlogError extends Error {
  readonly _tag = 'SlogError'

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SlogError'
  }
}

const fullUlidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const explicitOffsetTimestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?([+-])(\d{2}):(\d{2})$/

export function validateText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new SlogError('validation_failed', 'text must be non-empty.')
  }
  return trimmed
}

export function validateIdentity(value: string, path: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new SlogError(
      'validation_failed',
      `${path} must be a non-empty string without leading/trailing whitespace or control characters.`,
    )
  }
  return value
}

export function validateFullUlid(value: string): string {
  if (!fullUlidPattern.test(value)) {
    throw new SlogError('validation_failed', 'id must be a full ULID.')
  }
  return value
}

export function validateOffsetTimestamp(value: string, path: string): string {
  const match = explicitOffsetTimestampPattern.exec(value)
  if (!match) {
    throw new SlogError(
      'validation_failed',
      `${path} must be an ISO 8601 timestamp with an explicit offset.`,
    )
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText)
  const offsetMinute = Number(offsetMinuteText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw new SlogError(
      'validation_failed',
      `${path} must be a valid timestamp.`,
    )
  }
  return value
}
