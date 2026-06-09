import { expect, test } from 'bun:test'
import {
  AuthorityMode,
  Authority,
  Entry,
  SlogError,
  SlogLive,
  createEntry,
  deleteEntry,
  findEntryById,
  listEntries,
  updateEntry,
} from '@tools/slog'
import type {
  CreateEntryAuthorityMode,
  CreateEntryInput,
  EntryFilter,
  MachineEntryEnvelope,
  MachineErrorEnvelope,
  MachineListEnvelope,
  MachineWarning,
  UpdateEntryInput,
  ValidationDetail,
  Warning,
} from '@tools/slog'
import { Effect, Layer } from 'effect'

// --- Compile-time type assertions ---
// These assignments compile away at runtime but fail tsc if the exported
// types don't match the expected shapes. Any regression in the public surface
// becomes a build error, not just a missing runtime value.

const _createEntryInput: CreateEntryInput = {
  text: 'hello',
  actor: 'test-actor',
  authorityMode: 'delegated',
}
const _updateEntryInput: UpdateEntryInput = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  text: 'updated',
}
const _entryFilter: EntryFilter = { needsTriage: true }
const _warning: Warning = { code: 'test', message: 'test msg' }
const _machineWarning: MachineWarning = { code: 'test', message: 'test msg' }
const _createEntryAuthorityMode: CreateEntryAuthorityMode = 'delegated'
const _machineListEnvelope: MachineListEnvelope = { entries: [], warnings: [] }
const _machineErrorEnvelope: MachineErrorEnvelope = {
  error: { code: 'err', message: 'msg', details: [] },
}
const _validationDetail: ValidationDetail = {
  path: 'field',
  code: 'invalid_type',
  message: 'must be a string',
}

// Warning must be assignable to MachineWarning and vice-versa (alias check).
const _warnAlias: MachineWarning = _warning
const _machineWarnAlias: Warning = _machineWarning
void _warnAlias
void _machineWarnAlias

// MachineEntryEnvelope requires Entry instance in entry field.
const _entryInstance = new Entry({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  created_at: '2026-06-09T10:00:00+00:00',
  text: 'surface-lock entry',
  actor: 'test',
  authority: new Authority({ source: 'test', mode: 'direct' }),
  needs_triage: false,
})
const _machineEntryEnvelope: MachineEntryEnvelope = {
  entry: _entryInstance,
  warnings: [],
}
void _machineEntryEnvelope

// SlogLive must be assignable to Layer.Layer to satisfy compile-time check.
const _slogLiveIsLayer: Layer.Layer<unknown, unknown, never> =
  SlogLive as unknown as Layer.Layer<unknown, unknown, never>
void _slogLiveIsLayer

// Suppress "unused variable" warnings for compile-time-only bindings.
void _createEntryInput
void _updateEntryInput
void _entryFilter
void _createEntryAuthorityMode
void _machineListEnvelope
void _machineErrorEnvelope
void _validationDetail

// --- Runtime assertions ---

test('adapter surface: core CRUD functions are defined', () => {
  expect(typeof createEntry).toBe('function')
  expect(typeof updateEntry).toBe('function')
  expect(typeof findEntryById).toBe('function')
  expect(typeof listEntries).toBe('function')
  expect(typeof deleteEntry).toBe('function')
})

test('adapter surface: SlogLive is defined and is a Layer', () => {
  expect(SlogLive).toBeDefined()
  expect(Layer.isLayer(SlogLive)).toBe(true)
})

test('adapter surface: domain classes are exported and constructable', () => {
  expect(Entry).toBeDefined()
  expect(Authority).toBeDefined()
  expect(SlogError).toBeDefined()
  expect(AuthorityMode).toBeDefined()
})

test('adapter surface: SlogError is a constructable error class with _tag', () => {
  const err = new SlogError('test_code', 'test message')
  expect(err).toBeInstanceOf(Error)
  expect(err.code).toBe('test_code')
  expect(err.message).toBe('test message')
  expect(err._tag).toBe('SlogError')
})

test('adapter surface: AuthorityMode schema includes all expected literals', () => {
  const literals = AuthorityMode.literals
  expect(literals).toContain('direct')
  expect(literals).toContain('delegated')
  expect(literals).toContain('discretionary')
  expect(literals).toContain('observed')
  expect(literals).toContain('imported')
  expect(literals).toContain('derived')
})

test('adapter surface: createEntry returns an Effect', () => {
  const effect = createEntry({
    text: 'Type-lock entry',
    actor: 'test-actor',
    authorityMode: 'delegated',
  })
  expect(Effect.isEffect(effect)).toBe(true)
})

test('adapter surface: updateEntry returns an Effect', () => {
  const effect = updateEntry({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', text: 'x' })
  expect(Effect.isEffect(effect)).toBe(true)
})

test('adapter surface: findEntryById returns an Effect', () => {
  const effect = findEntryById('01ARZ3NDEKTSV4RRFFQ69G5FAV')
  expect(Effect.isEffect(effect)).toBe(true)
})

test('adapter surface: listEntries returns an Effect', () => {
  const effect = listEntries()
  expect(Effect.isEffect(effect)).toBe(true)
})

test('adapter surface: deleteEntry returns an Effect', () => {
  const effect = deleteEntry('01ARZ3NDEKTSV4RRFFQ69G5FAV')
  expect(Effect.isEffect(effect)).toBe(true)
})
