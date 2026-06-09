# Adapter interface for slog

## Status

Design resolved. Ready for implementation.

## Purpose

Define the slog core API, which is the programmatic boundary shared by all clients. The CLI is one such client; Hermes, OpenCode, hooks, imports, and future harnesses are additional clients. All clients share the same entry model, authority semantics, and guardrails defined in `001-establishment.md`, but they interact with those primitives through this core API rather than directly with storage.

Harness-specific concerns (e.g., how a Hermes tool schema maps to `createEntry` parameters, or how OpenCode surfaces a log function) are out of scope. They belong in separate harness plugin design documents.

## Glossary

Terms used in this document are defined in `CONTEXT.md`.

## Boundary: the core API

The slog core exposes a typed programmatic API implemented as Effect functions in `packages/slog/src/core.ts`. All business logic, including validation, guardrails, storage orchestration, and atomic partition rewrites, lives in the core. Clients import from it and translate results into their native protocols.

What the core provides:

- `createEntry`: create a new entry with validated provenance and applied guardrails
- `updateEntry`: update an existing entry's mutable fields
- `findEntryById`: retrieve a single entry by full ULID
- `listEntries`: query entries with optional filters
- `deleteEntry`: hard delete an entry (reserved/unstable for v1 harness plugins)

What the core does **not** provide:

- Harness-specific tool schemas (Hermes, OpenCode)
- Human-readable formatting (that lives in client presentation layers)
- Process exit codes or JSON envelopes (the CLI client adds these)
- Conversation history access (the core has no access to harness context)

The CLI machine contract defined in `001-establishment.md` (`slog entry create|update --json -`) remains supported as one client presentation. It is not the canonical boundary.

## Shared semantics

### Origin is the report-bearing axis, carried by `authority.mode`

An entry's *origin*, whether interactive (captured live in a human session), automated (script/hook/import), or synthetic (generated from other entries), is the axis downstream reporting weights on. It is derived from `authority.mode`, not from `actor` strings and not from a new field:

- **interactive:** `direct`, `delegated`, `discretionary`
- **automated:** `observed`, `imported`
- **synthetic:** `derived`

Reporting (`003`) treats interactive entries as the high-relevance spine and automated entries as low-narrative-weight but high-precision factual scaffolding that must not be dropped. See [ADR-0001](../../docs/adr/0001-origin-is-carried-by-authority-mode.md).

### `delegated` vs `discretionary`: same-turn explicit log-intent

An entry may be stamped `delegated` only when all three hold:

1. **Explicit log intent**: the user's words in the current turn ask for an entry to be recorded ("log that…", "note…", "add to slog…"), not merely that the user did something loggable.
2. **Same-turn traceability**: the instruction is in the current user turn, not inferred from session history or a standing rule.
3. **Content fidelity**: the entry records what the user asked to log. Agent embellishment beyond that intent is `discretionary`, not `delegated`.

Anything failing the gate is `discretionary`. **On any ambiguity, the harness plugin must drop to `discretionary`.**

This gate is a **harness plugin concern**, not a core concern. The core has no access to conversation history and cannot verify whether a human said "log this." The core structurally enforces that only `direct` and `delegated` may create settled entries (`needs_triage=false`); all other modes are forced to `needs_triage=true`. Lying "down" (discretionary where delegated was true) costs one triage review; lying "up" (delegated where discretionary was true) permanently mislabels provenance.

Standing user rules (e.g. "always log my PR reviews") authorize an agent's *initiative*, not a specific entry's human authority. Entries written under a standing rule in a later turn are `discretionary`, not `delegated`.

### Actor identity conventions (prescriptive)

Harness plugins must use the following identity strings. The core validates string hygiene only (non-empty, no leading/trailing whitespace, no control characters). An identity that passes hygiene but violates convention will produce technically valid entries that sort poorly at filter time.

| Context | `actor` | `authority.source` (non-delegated modes) |
| --- | --- | --- |
| Interactive agent | `<harness>:<agent-name>` (e.g. `hermes:hightower`) | Same as `actor` (agent acting on own initiative) |
| Hook | `<system>-hook` (e.g. `github-hook`) | `external:<system>` |
| Import | `<system>-import` (e.g. `github-import`) | `external:<system>` |
| Derived generator | `slog-<tool>` (e.g. `slog-summary`) | `slog-<tool>` |
| Human CLI | configured user name or OS username fallback | Same as `actor` |

When mode is `delegated`, `authority.source` **must** be the resolved user identity, and **must not** be the same as `actor`. The core trusts the harness plugin to supply the correct `authority.source`; it cannot validate this because it has no access to user identity resolution.

The core does not maintain a registry of allowed actors. It accepts any string that passes hygiene validation.

### Safe defaults

When fields are omitted from `createEntry` input, the core applies the following defaults:

- `authority.source`: **`actor`** (the harness plugin's identity)
- `occurred_at`: **omitted**, meaning the entry describes something happening at or near creation time. Set only when a reliable external event time is available.
- `needs_triage`: **omitted (let core apply default policy)**, where non-`direct`/`delegated` modes are forced to `true` by the core guardrail regardless of caller intent.

No trust-policy configuration, timezone overrides, or adapter-profile configuration is introduced in v1.

## Core API surface

### Types

```ts
type AuthorityMode =
  | 'direct'
  | 'delegated'
  | 'discretionary'
  | 'observed'
  | 'imported'
  | 'derived'

type CreateEntryAuthorityMode =
  | 'delegated'
  | 'discretionary'
  | 'observed'
  | 'imported'

interface CreateEntryInput {
  readonly text: string
  readonly actor: string
  readonly authorityMode: CreateEntryAuthorityMode
  readonly authoritySource?: string
  readonly occurredAt?: string
  readonly needsTriage?: boolean
}

interface UpdateEntryInput {
  readonly id: string
  readonly text?: string
  readonly occurredAt?: string | null
  readonly needsTriage?: boolean
}

interface EntryFilter {
  readonly dateRange?: { readonly start: Date; readonly end: Date }
  readonly needsTriage?: boolean
  readonly actor?: string
  readonly authoritySource?: string
  readonly authorityMode?: AuthorityMode
  readonly textQuery?: string
}

interface MachineWarning {
  readonly code: string
  readonly message: string
}

type Warning = MachineWarning
```

The `Warning` type is exported as `MachineWarning` with a `Warning` alias, making both names available to clients.

### Functions

```ts
function createEntry(
  input: CreateEntryInput
): Effect.Effect<{ readonly entry: Entry; readonly warnings: ReadonlyArray<Warning> }, SlogError>

function updateEntry(
  input: UpdateEntryInput
): Effect.Effect<{ readonly entry: Entry; readonly warnings: ReadonlyArray<Warning> }, SlogError>

function findEntryById(
  id: string
): Effect.Effect<Option.Option<Entry>, SlogError>

function listEntries(
  filter?: EntryFilter
): Effect.Effect<ReadonlyArray<Entry>, SlogError>

function deleteEntry(
  id: string
): Effect.Effect<void, SlogError>
```

`Entry` is the v1 core entry model from `001-establishment.md`.

**`direct` is structurally excluded** from the programmatic API. Only the human-at-keyboard `slog add` command creates `direct` entries. A harness plugin cannot create `direct` entries.

**`deleteEntry` is reserved/unstable for v1 harness plugins.** The core exposes it, but harness plugins should not call it in v1. Only the CLI client is an approved consumer.

### Return shape

All mutating core functions return `{ entry, warnings }` on success, even when `warnings` is empty. This keeps the return shape stable across guardrail firing and non-firing cases. Read functions return the queried data directly.

## Validation rules

### Core-enforced (structural)

The core validates on every call:

- `text` is non-empty after trimming
- `actor` is non-empty, no leading/trailing whitespace, no control characters
- `authorityMode` is one of the known authority modes
- `authoritySource`, if provided, passes the same string hygiene as `actor`
- `occurredAt`, if present, is an ISO 8601 timestamp with an explicit offset
- `id` and `created_at` are forbidden on create (caller must not supply them)
- `needs_triage=false` intent is guarded by the v1 triage policy

### Triage guardrails

The core applies the following hardcoded policy on create:

| `authorityMode` | Default `needs_triage` | Forced when `needsTriage=false` requested |
|---|---|---|
| `direct` | `false` | N/A (structurally excluded from API) |
| `delegated` | `false` | Not forced |
| `discretionary` | `true` | Yes, forced to `true` with `needs_triage_forced` warning |
| `observed` | `true` | Yes, forced to `true` with `needs_triage_forced` warning |
| `imported` | `true` | Yes, forced to `true` with `needs_triage_forced` warning |
| `derived` | `true` | Yes, forced to `true` with `needs_triage_forced` warning |

If a caller requests `needsTriage=false` for `discretionary`, `observed`, `imported`, or `derived`, the core persists the entry with `needs_triage=true` and returns a `needs_triage_forced` warning. It does not reject the write.

### Harness-enforced (semantic)

The core cannot enforce the `delegated` same-turn gate because it has no access to conversation history. Harness plugins are responsible for:

1. Detecting explicit log intent in the current user turn
2. Ensuring content fidelity (no agent embellishment beyond user intent)
3. Populating `authoritySource` with the resolved user identity (not the actor identity) when mode is `delegated`

A harness plugin that fails to apply the gate produces a mislabeled entry. The core's triage guardrail limits the blast radius but does not prevent the mislabeling.

## Error and retry contract

### Core error taxonomy

| Code | Category | Cause |
|---|---|---|
| `validation_failed` | Client error | Bad input: empty text, invalid mode, bad timestamp, forbidden field, etc. |
| `entry_not_found` | Client error | Update or show referenced a non-existent ID |
| `partition_locked` | Transient | Filesystem contention during write |
| `storage_corrupt` | Fatal | Duplicate IDs in a partition, internal inconsistency |

### Client retry guidance

| Error | Recommended action |
|---|---|
| `validation_failed` with `forbidden_field` (`id`, `created_at`) | Strip offending fields and retry once; if still fails, surface to user |
| `validation_failed` (other) | Surface to user; do not retry |
| `entry_not_found` | Surface to user; do not retry |
| `partition_locked` | Wait 500ms and retry once; if still fails, surface to user |
| `storage_corrupt` | Surface immediately; do not retry |

Clients should never dump raw error envelopes into the user's session.

## Relationship to establishment design

`001-establishment.md` defines the core entry model, storage doctrine, persistence invariants, and the CLI machine contract. This document defines the programmatic API that subsumes the CLI contract as one client among many.

The CLI remains supported: it parses arguments, imports from the slog core, and translates results to JSON envelopes, exit codes, and human-readable output. But it is not the canonical boundary. Future harnesses should prefer importing the core directly over shelling out to the CLI.

## Deferred / out of scope

- Harness-specific tool schemas (Hermes plugin doc, OpenCode plugin doc)
- Gated human-only command surface for `delegated`
- Adapter profiles, trust policy, or actor registry
- Configurable timezone overrides
- Soft deletes or mutation history
- Scope, tags, links, project references, generic metadata
- LLM-backed summarization or prose report generation
