# Laying the groundwork for a Structured Log ("slog")

## Product

### What is a Structured Log?

A Structured Log ("slog") is a personal/work operational journal made of entries stored as durable, structured records and operated through an environment-agnostic CLI.

An entry is the canonical domain unit: the thing a human, agent, automation, or import adds to the slog because it may matter later. A record is the persistence representation of an entry on disk. Product language should generally use "entry"; implementation and storage language may use "record" when precision is useful.

The CLI is the product foundation. It is not primarily a Hermes feature, an OpenCode feature, or a feature of any other agent harness. Harness-specific integrations should behave as thin translation layers over the same CLI calls so that entries created from different environments share the same underlying log, conventions, and user experience.

A slog should answer: what happened, who or what recorded it, on whose authority it was recorded, when it happened, and how it can be queried later. Adjacent questions such as area of work, follow-up, references, and summarization are important future design areas, but they should not expand the v1 core schema.

### Authority and provenance

Slog entries may be created by humans, agents, automation, or imports. Every entry must preserve clear provenance: the actor that wrote the entry and the authority under which the entry was written.

The actor is the immediate writer. The authority expresses why the entry should be treated as meaningful. These are related but not identical. For example, an agent may write an entry because Zachary explicitly instructed it to do so; in that case the actor is the agent, but the entry is recorded on Zachary's authority. Conversely, an agent may write an entry on its own initiative because it predicts the entry may be useful later; that entry should be distinguishable from an explicit human-authorized log entry.

Explicit human-authored or human-authorized entries are more authoritative than opportunistic agent-authored observations because they carry an implicit signal: "this is important for later."

Authority should be represented as structured provenance rather than a single flat label. The initial model should distinguish:

- `actor`: the immediate writer of the entry.
- `authority.source`: the person, agent, system, or external source whose authority made the entry worth recording.
- `authority.mode`: how that authority was applied.

Initial authority modes:

- `direct`: the authority source directly authored the entry.
- `delegated`: the authority source explicitly instructed another actor to write the entry.
- `discretionary`: the actor chose to write the entry without an explicit request because it predicted the entry may be useful later.
- `observed`: the entry records an externally observed fact or system event.
- `imported`: the entry was brought in from another system.
- `derived`: the entry was generated from other slog entries.

Identity fields such as `actor` and `authority.source` should be stable non-empty strings. The system should enforce basic string hygiene rather than a namespaced identity schema: trim and reject empty values, reject control characters, and reject leading or trailing whitespace. It should not require a structured identity object or enforce identity namespaces in v1.

Recommended identity conventions:

- Humans use simple stable names, such as `zachary`.
- Harness agents use `<harness>:<agent-name>`, such as `hermes:hightower`.
- External systems use `external:<system>`, such as `external:github`.
- Hooks and imports may use operational identities such as `github-hook` or `github-import`.
- Derived generators may use tool identities such as `slog-summary`.

These are conventions, not validation rules. Authority mode carries the trust semantics; identity strings provide provenance and filtering handles.

This distinction is intentionally part of the foundation. It allows later filtering, sorting, and summarization behavior to treat entries differently. For example, daily report generation should preserve the wording and specificity of direct or delegated human-authority entries more closely, while summarizing or generalizing discretionary agent-authored observations more aggressively.

Example combinations:

| Scenario | Actor | Authority source | Authority mode | Implication |
| --- | --- | --- | --- | --- |
| Zachary runs `slog add "Reviewed Laila's PR; requested changes around tenant config fallback"` | `zachary` | `zachary` | `direct` | Strong human-authored signal; preserve wording closely in summaries. |
| Zachary tells Hermes, "Log that I reviewed Spencer's PR and left feedback on the deployment check" | `hermes:hightower` | `zachary` | `delegated` | Strong human-authorized signal even though an agent wrote the entry. |
| Hermes notices from the current work session that Zachary reviewed a PR and proactively records it | `hermes:hightower` | `hermes:hightower` | `discretionary` | Useful but weaker signal; summarize cautiously and avoid overclaiming. |
| A GitHub hook records that Zachary merged PR #123 | `github-hook` | `external:github` | `observed` | Concrete external fact; useful for timelines, but not necessarily a human statement of importance. |
| A daily import records all merged PRs from a repository | `github-import` | `external:github` | `imported` | Bulk external context; may need filtering before inclusion in human-facing summaries. |
| A summarizer writes "Reviewed and merged several deployment-related PRs" from multiple source entries | `slog-summary` | `slog-summary` | `derived` | Generated synthesis; should link back to source entries when possible and should not outrank direct/delegated entries. |

## Design

### Goals for this design

- Establish slog as a CLI-first, harness-agnostic structured journal.
- Define the minimum entry model needed for durable capture, provenance, triage, and later summarization.
- Keep the foundation small enough that logging remains low-friction.
- Preserve enough structure that integrations can share one underlying log without each inventing incompatible semantics.
- Separate human command ergonomics from machine/integration contracts.

### CLI interface layers

The CLI should provide two layers over the same underlying model:

1. A human UX layer for fast manual operation.
2. A JSON-native machine contract for harnesses, agents, hooks, imports, and automation.

Human-facing commands should optimize for low-friction capture and review, such as:

```sh
slog add "Reviewed Spencer's PR"
slog add --triage "Ask Laila about tenant fallback"
slog list
slog triage
slog show <full-ulid>
```

Machine-facing commands should optimize for explicit structured input and stable output, such as:

```sh
slog entry create --json '{...}'
slog entry update --json '{...}'
slog entry list --json
slog entry show <full-ulid> --json
```

Harness integrations must not parse human-oriented CLI output. Hermes, OpenCode, hooks, imports, and future adapters should use JSON-native machine commands so the human CLI remains free to improve its display without breaking integrations.

Machine writers should provide `actor` and `authority` explicitly on create. Integration profiles may help identify the calling integration, locate config, or set safe defaults for the actor, but they should not silently imply human-delegated authority for arbitrary agent writes. A harness adapter is responsible for translating each native action into the correct authority mode: delegated when the user explicitly asked for the log write, discretionary when the agent chose to record something on its own, observed/imported for external system facts, and derived for generated synthesis.

Human UX commands may use local defaults because their operating context is narrower and interactive. Machine contracts should favor explicit provenance over convenience.

### Human entry creation defaults

Human `slog add` should infer safe local defaults rather than requiring the user to provide provenance on every write.

For v1, `slog add "..."` should create an entry with:

- `actor`: the configured local user identity, falling back to the OS username if no local user is configured.
- `authority.source`: the same value as `actor`.
- `authority.mode`: `direct`.
- `needs_triage`: `false`, unless the user passes an explicit triage flag.
- `created_at`: the current time in the system local timezone.
- `occurred_at`: omitted unless the user explicitly provides it.

Examples:

```sh
slog add "Reviewed Spencer's PR"
slog add --triage "Ask Laila about that config thing"
slog add --occurred-at "2026-06-05T10:42:00-04:00" "Merged PR #123 this morning"
```

Human `slog add` should not expose casual actor or authority override flags in v1. If a caller needs non-default provenance, it should use the JSON-native machine creation command.

### Machine entry creation contract

Machine entry creation should be explicit about provenance but should not be authoritative over identity or record-time.

Machine callers should provide:

- `text`
- `actor`
- `authority.source`
- `authority.mode`
- optional `needs_triage` intent, subject to central triage policy and guardrails
- optional `occurred_at`

The CLI should generate:

- `id`
- `created_at`

V1 machine create should reject caller-supplied `id` and `created_at`. The CLI owns those fields so the ULID timestamp, creation time, and daily partition invariant remain aligned. Imports and backfills should use `occurred_at` to describe historical event time rather than forging record creation time.

Machine create validation should require:

- non-empty `text` after trimming
- non-empty stable identity strings for `actor` and `authority.source`
- `authority.mode` to be one of the known authority modes
- `occurred_at`, if present, to be an ISO 8601 timestamp with an explicit offset
- `needs_triage=false`, if requested, to pass the central v1 triage guardrails

V1 triage guardrails should be hardcoded rather than configurable. As a transitional policy, only `direct` and `delegated` authority modes may create settled entries with `needs_triage=false`. All other authority modes should default to `needs_triage=true` and remain triaged even if the caller requests `needs_triage=false`.

If a caller requests `needs_triage=false` for `discretionary`, `observed`, `imported`, or `derived`, machine create should persist the entry with `needs_triage=true` and return a warning rather than rejecting the write. This keeps ingestion robust while preventing non-human-authorized entries from silently bypassing review.

Successful machine create should return the persisted current state of the entry, not merely an acknowledgement. The response should include the generated `id`, generated `created_at`, final `needs_triage` value after policy, and any other persisted fields.

Successful machine create output should have a stable JSON envelope:

```json
{
  "entry": {
    "id": "01J...",
    "created_at": "2026-06-05T14:54:00-04:00",
    "text": "Zachary reviewed Spencer's PR and asked for deployment check changes.",
    "actor": "hermes:hightower",
    "authority": {
      "source": "zachary",
      "mode": "delegated"
    },
    "needs_triage": false
  },
  "warnings": []
}
```

If central policy adjusts caller intent, the command should still return the persisted entry plus a warning explaining the adjustment:

```json
{
  "entry": {
    "id": "01J...",
    "created_at": "2026-06-05T14:54:00-04:00",
    "text": "Zachary appeared to review Spencer's PR during the session.",
    "actor": "hermes:hightower",
    "authority": {
      "source": "hermes:hightower",
      "mode": "discretionary"
    },
    "needs_triage": true
  },
  "warnings": [
    {
      "code": "needs_triage_forced",
      "message": "Only direct and delegated entries may be created as settled."
    }
  ]
}
```

Machine command success JSON should be written to stdout. Validation failures should exit non-zero and return structured error JSON on stderr.

Machine error output should use a stable JSON envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Entry create payload failed validation.",
    "details": []
  }
}
```

`error.code` should be machine-readable. `error.message` should be human-readable. `error.details` should be present and may be an empty array. When populated, each detail should include:

- `path`: the input field or logical target associated with the error.
- `code`: a machine-readable detail code.
- `message`: a human-readable explanation.

Example validation error:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Entry create payload failed validation.",
    "details": [
      {
        "path": "authority.mode",
        "code": "invalid_enum_value",
        "message": "Expected one of: direct, delegated, discretionary, observed, imported, derived."
      }
    ]
  }
}
```

Example forbidden-field error:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Entry create payload failed validation.",
    "details": [
      {
        "path": "id",
        "code": "forbidden_field",
        "message": "id is generated by slog and cannot be supplied on create."
      }
    ]
  }
}
```

Example not-found error:

```json
{
  "error": {
    "code": "entry_not_found",
    "message": "No entry exists with the supplied id.",
    "details": []
  }
}
```

Machine commands should return exactly one JSON object on success or failure. Human commands may render friendlier text, but machine commands should preserve the stable envelope.

### Machine entry update contract

Machine entry update should use a patch-style object with an `id` and a `changes` object.

Example:

```json
{
  "id": "01J...",
  "changes": {
    "text": "Ask Laila about tenant config fallback.",
    "occurred_at": "2026-06-05T10:42:00-04:00",
    "needs_triage": false
  }
}
```

Machine update validation should require:

- `id` to be present and to be a syntactically valid full ULID.
- `changes` to be present and to be a non-empty object.
- `changes` to contain only fields mutable in normal v1 operation: `text`, `occurred_at`, and `needs_triage`.
- `text`, if present, to be non-empty after trimming.
- `occurred_at`, if present, to be an ISO 8601 timestamp with an explicit offset.
- `needs_triage`, if present, to be a boolean.

Machine update should reject immutable fields such as `id`, `created_at`, `actor`, `authority.source`, or `authority.mode` if they appear inside `changes`. It should also reject unknown fields rather than silently ignoring them.

Successful machine update should return the persisted current state of the updated entry using the same success envelope as machine create:

```json
{
  "entry": {
    "id": "01J...",
    "created_at": "2026-06-05T14:54:00-04:00",
    "text": "Ask Laila about tenant config fallback.",
    "actor": "zachary",
    "authority": {
      "source": "zachary",
      "mode": "direct"
    },
    "needs_triage": false
  },
  "warnings": []
}
```

The update operation should locate the entry by full ULID, apply allowed changes, rewrite the relevant daily JSONL partition atomically, and return structured errors using the machine error envelope when validation fails or the entry is not found.

### Human edit workflow

Human edit should remain scriptable and explicit in v1. The best-class experience for correcting or refining entries is expected to come through an agent adapter using the machine update contract. The direct human CLI should still be usable for scripting and simple manual corrections, but it should not grow an editor-driven workflow in v1.

V1 human edit commands should use inline flags:

```sh
slog edit <full-ulid> --text "Ask Laila about tenant config fallback."
slog edit <full-ulid> --occurred-at "2026-06-05T10:42:00-04:00"
```

Human `slog edit` should not open `$EDITOR` in v1. `$EDITOR` support adds interactive failure modes, testing complexity, and UX surface area that are not necessary for the foundation and may never be needed if agents provide the primary high-quality editing experience.

Triage state should remain under the triage workflow rather than being duplicated as edit flags:

```sh
slog triage resolve <full-ulid>
slog triage reopen <full-ulid>
```

### Machine JSON input

Machine commands that accept structured input should support `--json <payload-or->`:

```sh
slog entry create --json '{"text":"..."}'
slog entry create --json - < payload.json
```

`--json <payload>` accepts inline JSON. `--json -` reads JSON from stdin. Machine integrations should prefer `--json -` to avoid shell quoting problems and to support multiline text cleanly.

V1 should define strict input semantics:

- `--json` requires an explicit value.
- `--json -` reads exactly one JSON payload from stdin.
- `--json` without a value should fail with structured error JSON rather than implicitly blocking on stdin.
- The payload must be a single JSON object, not an array, string, number, boolean, or null.
- Callers must not provide multiple payload sources for the same command.

### Read and query surface

V1 read/query operations should be limited to fields that are part of the core entry model.

Human-facing read commands should include:

```sh
slog list
slog today
slog triage
slog show <full-ulid>
slog search <query>
```

Machine-facing read commands should provide JSON-native output and explicit filters:

```sh
slog entry list --json
slog entry show <full-ulid> --json
```

V1 filters should include:

- date range
- `needs_triage`
- `actor`
- `authority.source`
- `authority.mode`
- simple text search over `text`

V1 text search should be intentionally basic. `slog search <query>` should perform a case-insensitive substring search over entry `text` only. It should not support regex syntax, fuzzy matching, stemming, ranking, or indexed full-text search. Search should default to the same bounded date behavior as `slog list`, likely today, unless a date range or `--all` is supplied.

Searching is not expected to be important in the first version. The primary v1 recall path is listing entries, usually one day at a time. Search exists as a small convenience over the current JSONL partitions, not as a separate search product.

Scope, tag, link, project, task, and summary filters should be deferred until those concepts have canonical shapes.

Human `slog list` should default to a bounded view, likely today's entries in reverse chronological order. Machine `slog entry list --json` should also default to a bounded date range unless an explicit broader range or `--all` is supplied. `slog triage` should list unresolved entries, likely bounded to today by default with an explicit `--all` option.

Human `slog list` should use a simple single-line display that always includes local time, the full ULID, and entry text. The only v1 status marker should be `TRIAGE` when `needs_triage=true`. Provenance markers such as agent/delegated/observed should not appear in the default list; those details belong in `slog show`, verbose output, or machine JSON.

Example:

```text
2026-06-05

14:52  01JY8E7MZKZ7R2N94R9Y3CZ5QX  Reviewed Spencer's PR
14:55  TRIAGE  01JY8E8K2B8V8F3F6Q0M1N2P3R  Ask Laila about that config thing
```

V1 should require full ULIDs everywhere. Human and machine commands should both store, emit, and accept full IDs only. Prefix matching is intentionally out of scope for v1 because it would require either archive scans, an index/cache, or additional bounded-lookup semantics that are not necessary for the foundation.

Because records are stored in daily JSONL partitions, commands that address an entry by ID still need an efficient way to find the owning partition. ULIDs encode their creation timestamp in the first 48 bits, so an implementation can decode the timestamp from a full ULID in O(1), convert that instant into the system local timezone, and inspect the corresponding daily partition first.

V1 lookup by ID should therefore:

1. Require a syntactically valid full ULID.
2. Decode the ULID timestamp to derive the expected daily partition in the system local timezone.
3. Load that daily partition and search for the full ID.
4. Report not found if the record is absent from the expected partition.

This lookup strategy relies on the v1 invariant that newly created slog entries use ULIDs generated at record creation time and are stored in the daily partition corresponding to `created_at`. Future backfill/import designs that create entries for historical `occurred_at` values should still generate IDs at insertion time and partition by `created_at`, or they must introduce an explicit index/backreference design before violating that invariant.

### Mutation surface

V1 mutation should be limited to settling and correcting entry content, not rewriting provenance.

Mutable fields in normal operation:

- `text`
- `occurred_at`
- `needs_triage`

Immutable fields in normal operation:

- `id`
- `created_at`
- `actor`
- `authority.source`
- `authority.mode`

`actor` and `authority` are provenance fields. They should not be casually editable through ordinary human UX commands or normal machine update calls. If a provenance mistake must be corrected later, that should be handled by an explicit repair/admin design rather than hidden inside generic update behavior.

The v1 update operation should rewrite the relevant daily JSONL partition atomically after applying allowed field changes.

### Triage workflow

V1 triage should be a set of explicit commands over `needs_triage`, not an interactive review UI. Interactive triage can be added later over the same primitives if needed.

Human-facing triage commands should include:

```sh
slog triage
slog triage --all
slog triage resolve <full-ulid>
slog triage reopen <full-ulid>
```

`slog triage` lists entries where `needs_triage=true`, bounded to today by default. `slog triage --all` lists unresolved triage entries across all partitions.

`resolve` sets `needs_triage=false`. Resolving triage means the entry no longer requires triage review; it does not mean the underlying work, action, or subject of the entry is complete.

`reopen` sets `needs_triage=true`, returning the entry to the triage queue.

Editing entry text should use the normal edit/update path rather than triage-specific behavior.

### Human show output

Human `slog show <full-ulid>` should display all core fields in a readable detail view. It should include:

- full ID
- `created_at`
- `occurred_at`, only when present
- `actor`
- `authority.source` and `authority.mode`
- `needs_triage`
- entry text

The metadata block should be separated from the entry text by a blank line.

Example:

```text
ID:        01JY8E7MZKZ7R2N94R9Y3CZ5QX
Created:   2026-06-05T14:52:00-04:00
Occurred:  2026-06-05T10:42:00-04:00
Actor:     zachary
Authority: zachary / direct
Triage:    no

Reviewed Spencer's PR and left feedback on deployment checks.
```

If `occurred_at` is absent, the `Occurred` line should be omitted rather than displayed empty.

The machine equivalent, `slog entry show <full-ulid> --json`, should return the same stable success envelope used by machine create and update:

```json
{
  "entry": { "...": "..." },
  "warnings": []
}
```

### Deletion

V1 should support hard delete through the human UX, but should not expose ordinary machine/API delete by default.

This is a personal/work operational journal rather than a regulated audit ledger. If a user accidentally records something sensitive, wrong, or unwanted, they should be able to remove it without carrying soft-delete complexity in the core schema.

V1 deletion doctrine:

- Human UX may provide `slog delete <full-ulid>`.
- Deletion requires a full ULID.
- Deletion should require confirmation unless an explicit sharp-edged flag such as `--yes` is supplied.
- Deletion rewrites the relevant daily JSONL partition atomically.
- Machine-facing delete is deferred or reserved for a later explicit admin/repair design.
- V1 should not add tombstones, `deleted_at`, soft-delete filtering, or deletion audit records.

### Non-goals for this design

This establishment design should not include prose report generation or LLM-backed summarization.

Reporting and summarization are downstream consumers of the core entry model. V1 should make entries queryable enough that agents or later commands can build daily reports externally, but slog itself should not include LLM summarization, prose daily-update generation, or report-format policy in the foundation.

The v1 report substrate is the machine read/query surface, especially bounded `slog entry list --json` calls over a date range. A future design may define dedicated report commands, summarization rules, source weighting, or daily update formats once the core entry model and query contract are stable.

This establishment design should also exclude scope, tags, links, project references, task references, and generic metadata from the v1 core entry model.

Those concepts are expected future design areas, but adding them prematurely would create durable schema commitments without enough pressure-testing. V1 should not include a generic `metadata` escape hatch because it would become an unstructured dumping ground for adapter-specific shapes. Machine callers should encode essential context in `text` until a future design defines canonical structures for references, classification, or routing.

## Implementation

While the intention of this design is to be as implementation-agnostic as possible, the following sections include some desired implementation details to provide context for the design decisions.

### File Layout

The default slog home should be `~/.slog`.

```text
~/.slog/
  config.toml
  entries/
    2026/
      06/
        05.jsonl
  locks/
```

The default should be shared across harnesses so entries created from a shell, Hermes, OpenCode, hooks, or other adapters land in the same underlying journal unless explicitly isolated.

The slog home may be overridden with `SLOG_HOME`. V1 does not need a separate `--home` flag; an environment variable is enough for tests, temporary runs, alternate stores, and adapter-level isolation without adding another precedence surface.

Project-local slog homes should not be the default because they would fragment the personal/work operational journal. They may be supported later through explicit `SLOG_HOME` usage or a separate project-log design.

### Configuration

V1 should support an optional `config.toml` in the slog home.

```toml
user = "zachary"
```

The only v1 configuration field should be `user`, which supplies the local human identity used by human UX commands such as `slog add`. If `config.toml` is missing, human commands should fall back to the OS username. If `config.toml` is present, `user` must be a non-empty string; invalid config should fail clearly rather than silently falling back.

Because the implementation is expected to use Bun, TOML does not add a dependency burden: Bun has built-in TOML import/parsing support. The design should still keep the config surface intentionally tiny.

V1 config should not include timezone, profiles, trust policy, adapter defaults, storage backend selection, or report preferences. Those may become future design areas, but they should not be smuggled into the establishment design as speculative knobs.

V1 should not require or include `slog init`. Commands should lazily create the slog home and required subdirectories when they first need them. The optional `config.toml` may be created manually by the user if they want to override the OS username. A future `init` command may improve onboarding, but it should not be necessary for normal operation or part of the v1 foundation.

### Incremental implementation approach

The first implementation should proceed in small, test-driven vertical slices. This section is guidance for implementation order, not a complete task backlog. Each slice should be chosen from the current code state, implemented with a focused failing test first, and committed as a logical unit after verification.

Implementation guidelines:

- Use TypeScript with Effect.
- Use Bun for package management, scripts, and tests according to this repository's conventions.
- Use strict TDD: one failing behavior test, minimal implementation, refactor, then repeat.
- Prefer small vertical slices over horizontal scaffolding or a prewritten full test backlog.
- Keep storage behind a narrow repository/service seam so JSONL can be replaced later without changing command contracts.
- Keep clock, ID generation, filesystem, and process environment access behind testable seams.
- Encode product invariants directly rather than turning them into premature configuration knobs.
- Keep the human CLI and machine JSON contract separate in both tests and implementation.
- Commit focused, working increments using the repository's existing commit-message style.

Effect-specific guidance:

- Model entries, authority modes, command inputs, and machine envelopes with `Schema` so parsing and validation produce typed domain values rather than loose objects.
- Use branded string types for important identifiers such as entry IDs and identity strings when doing so improves boundary safety without adding ceremony to the CLI contract.
- Represent domain and infrastructure failures as tagged errors that can be translated into the stable machine error envelope at the command boundary.
- Define Effect services for filesystem/storage, config, clock, ID generation, environment access, and console/process output. Service methods should return Effects and keep dependencies in layers rather than method signatures.
- Use `Effect.fn` for named service operations where tracing would clarify command execution or storage failures.
- Provide layers once at the CLI entrypoint; avoid scattering `Effect.provide` through domain or command logic.
- Use `@effect/platform-bun` services for the live CLI runtime where practical.
- Test Effect code with `@effect/vitest` and test layers. Use deterministic test services for clock, ID generation, filesystem roots, and environment values.
- Keep pure domain validation separate from live layers so basic schema and triage-policy tests can run without touching the filesystem.

Implementation layout guidance:

The initial implementation should use a flat, seam-oriented module layout rather than a deeply nested architecture. The exact file names may evolve, but the first pass should keep concerns separated along these lines:

```text
src/
  cli.ts
  domain.ts
  config.ts
  environment.ts
  storage.ts
  machine.ts
  human.ts
  commands.ts
```

Suggested responsibilities:

- `cli.ts`: thin entrypoint that parses arguments, dispatches commands, wires live layers, and runs the Effect program.
- `domain.ts`: pure schemas, branded types, authority modes, triage guardrails, input validation, and domain errors.
- `config.ts`: slog home resolution, optional `config.toml` loading, local user identity resolution, and config validation.
- `environment.ts`: service definitions or live helpers for clock, ID generation, OS username, environment variables, and process IO.
- `storage.ts`: JSONL repository, daily partition paths, full-ULID lookup, atomic rewrites, and file locking.
- `machine.ts`: machine JSON input parsing, success envelopes, error envelopes, and machine output rendering.
- `human.ts`: human list/show formatting, confirmation prompts, and other human-readable rendering.
- `commands.ts`: command handlers that orchestrate domain, storage, config, and output seams.

Command parsing should stay thin. Domain validation should remain pure. Storage should stay behind a repository/service seam. Modules may be split later when real size or cohesion pressure justifies it, but the v1 implementation should avoid a premature folder hierarchy.

Suggested implementation phases:

1. **Core storage and human recall loop**
   - Establish `SLOG_HOME` resolution and default `~/.slog` layout.
   - Generate ULID IDs and system-local ISO 8601 timestamps through injectable services.
   - Write daily JSONL current-state records.
   - Implement human `slog add`, `slog list`, and `slog show <full-ulid>`.
   - Verify full-ULID lookup by decoding the ULID timestamp to the expected daily partition.

2. **Machine create/list/show contract**
   - Implement `slog entry create --json <payload-or->`.
   - Implement machine success and error envelopes.
   - Enforce explicit machine provenance and reject caller-supplied `id` or `created_at`.
   - Implement `slog entry list --json` and `slog entry show <full-ulid> --json` with bounded defaults.

3. **Mutation and triage**
   - Implement machine patch-style update as `slog entry update --json <payload-or->` with top-level shape `{ id, changes }`. `changes` must include at least one of `text`, `occurred_at`, or `needs_triage` and must not include unknown or immutable fields. `text` is trimmed and must remain non-empty; `occurred_at` accepts an offset timestamp string or `null`; `needs_triage` must be boolean. `occurred_at: null` clears the optional field from the persisted entry. No-op machine updates are successful and return the unchanged entry without warning so adapter retries remain idempotent. Machine commands that take JSON payloads, currently `entry create` and `entry update`, must reject duplicate `--json` payload sources as ambiguous input before dispatching the command.
   - Implement human `slog edit` inline flags for `text` and `occurred_at`, including `--clear-occurred-at` as the human equivalent of machine `occurred_at: null`. Human edit does not change triage state; `needs_triage` changes are handled through `slog triage resolve/reopen`. No-op human edit/triage commands succeed but report that no changes were made.
   - Implement `slog triage`, `slog triage --all`, `slog triage resolve <full-ulid>`, and `slog triage reopen <full-ulid>`. `slog triage` defaults to today-only; `--all` is the explicit full unresolved backlog sweep. Phase 3 does not need backlog counts in the default triage output. `slog triage --all` discovers entries by recursively scanning valid daily JSONL partition paths under `~/.slog/entries/`; Phase 3 does not introduce an index/cache, but storage discovery stays behind the repository service so a later faster layer can replace JSONL scanning without changing command handlers. Phase 3 edit/update/triage commands continue requiring full ULIDs only; triage output should print full IDs for copy/paste.
   - Harden atomic daily-partition rewrites and file locking. Implement Phase 3 in separate reviewable packets: storage mutation foundation first, then machine update, then human edit, then human triage.

4. **Deletion, search, and polish**
   - Implement human hard delete with confirmation and full-ULID lookup.
   - Implement simple case-insensitive substring `slog search` over `text`.
   - Polish human output formatting.
   - Add edge-case tests for malformed JSON, invalid timestamps, invalid authority modes, forbidden fields, not-found IDs, and concurrent writes where practical.

The phases should not introduce deferred concepts such as reports, scopes, tags, links, generic metadata, prefix IDs, configurable timezones, `$EDITOR` workflows, soft deletes, mutation history, or machine delete.

### Persistence Model

The v1 source of truth should be newline-delimited JSON (JSONL) current-state records.

Although YAML daily files would be more hand-readable and produce more pleasant git diffs, the design should optimize for the path most likely to be used in practice: operating through the CLI and machine integrations. JSONL is simpler to implement, append, parse, validate, stream, and recover than YAML, and it better matches the JSON-native machine contract. Human-readable storage can be revisited later if real usage shows that hand-editing or git-diff review matters more than expected.

The initial persistence model should be deliberately swappable. The CLI and machine API should expose entries, not storage files, so a future implementation can migrate from JSONL to YAML, SQLite, or a hybrid model without changing harness integrations.

V1 storage doctrine:

- Store records as JSONL.
- Partition records into daily files.
- Treat each line as the current-state record for one entry.
- Store each entry exactly once in its owning daily partition.
- Partition rewrites must match exactly one record by full ULID: zero matches is `entry_not_found`, one match may be updated, and multiple matches is `storage_corrupt` / `duplicate_entry_id` with no rewrite.
- Any full-ULID lookup, including human and machine `show`, expects zero or one matching record in the owning partition. Multiple matches fail with `storage_corrupt` / `duplicate_entry_id` rather than returning an arbitrary record.
- List and triage commands should fail with `storage_corrupt` / `duplicate_entry_id` if any scanned partition contains duplicate entry IDs. This validation is scoped to partitions the command already reads; Phase 3 does not introduce a separate global corruption audit.
- Update entries by rewriting the relevant daily partition under the partition lock using a temp-file-and-rename strategy.
- Write rewrite temp files in the same directory as the target partition so the final rename stays on the same filesystem.
- V1 does not require explicit file fsync or parent-directory fsync for partition rewrites; the storage service can add stronger durability later if real use demands it.
- Use centralized per-partition locks around writes to avoid concurrent write corruption.
- Represent locking behind an Effect service so tests can provide deterministic lock behavior and production can manage acquisition/release safely.
- Store write locks under `~/.slog/locks/YYYY-MM-DD.lock`, where `YYYY-MM-DD` is the target daily partition in system local time.
- Phase 3 operations may acquire at most one partition lock. Multi-partition operations are deferred and require a separate design decision.
- Lock acquisition should wait briefly with a hardcoded bounded timeout rather than failing immediately or waiting indefinitely. V1 should assume contention is rare and normally involves at most two writers.
- On lock timeout, commands should fail with a structured `partition_locked` error rather than continuing without the lock.
- Keep machine input/output JSON-native regardless of storage details.
- Prefer implementation simplicity over speculative hand-editability.
- Do not introduce append-only mutation history, last-write-wins reduction, or compaction in v1.
- Leave room for a future rebuildable SQLite index/cache if query performance requires it.
- Leave room for YAML export or an alternate persistence backend if human file review becomes important.

### Data Model

#### Entry IDs

Entry IDs should be generated as ULIDs.

Stored records should keep the full ULID. Human-facing and machine-facing commands should both use full IDs in v1. Prefix matching is intentionally deferred until a later design introduces explicit lookup semantics or an index/cache.

IDs must be stable and independent of storage location so entries can survive repartitioning, export, import, or backend migration. The ID is an identity, not the semantic source of time truth. Even though ULIDs are time-sortable, `created_at` remains the authoritative timestamp for when the entry was recorded. Future concepts such as backfilled imports or `occurred_at` should not be constrained by the ULID timestamp.

#### Entry timestamps

`created_at` is required and records when the entry was written into slog. `occurred_at` is optional and records when the described thing happened, if known and materially different from the creation time.

If `occurred_at` is omitted, consumers may treat it as equivalent to `created_at` for ordinary ordering and reporting. Human `slog add` commands normally only set `created_at`. Hooks, imports, and backfill flows should set `occurred_at` when an external system provides a reliable event time or when the user is explicitly recording something that happened earlier.

Timestamps should be stored as ISO 8601 strings with explicit offsets, such as `2026-06-05T13:08:00-04:00`. The slog is day/report oriented, so daily partitions and date-based queries should use the system local timezone rather than UTC day boundaries. V1 should not introduce a configurable timezone; a timezone override can be considered later if real use demands it.

Implementations should parse timestamps into instants for comparison and sorting, but preserve offset-bearing ISO strings in records and machine JSON. The stored timestamp should remain human-inspectable while still being unambiguous.

Because the implementation is expected to use TypeScript with Effect, ID generation should sit behind a small service boundary rather than being called directly throughout the domain. Production can use ULID generation while tests can provide deterministic IDs.

The minimum useful entry shape should be intentionally small. A slog entry must be cheap to create, but still carry enough structure for later trust, sorting, triage, and summarization.

Core v1 fields:

- `id`: stable unique identifier for the entry.
- `created_at`: timestamp for when the entry was recorded.
- `occurred_at`: optional timestamp for when the described thing happened, if known and materially different from when it was recorded.
- `text`: the human-readable content of the entry.
- `actor`: the immediate writer of the entry.
- `authority.source`: the person, agent, system, or external source whose authority made the entry worth recording.
- `authority.mode`: how that authority was applied.
- `needs_triage`: whether the entry requires later classification, cleanup, routing, or review.

The initial design should avoid prematurely committing to detailed shapes for adjacent concepts such as scopes, tags, links, metadata, projects, tasks, or summaries. Those concepts are likely important, but their schemas need separate pressure-testing. They should not be included in the v1 core entry model.

`needs_triage` is part of the core rather than an optional add-on because triage is a fundamental operating mode of the system. The slog should allow fast capture without forcing perfect classification at write time, while still making ambiguity visible and recoverable later.

`needs_triage` means the entry was intentionally captured but is not yet operationally settled. Triage may be needed because the entry requires classification, clarification, trust review, action extraction, or routing into another system. It does not mean the entry is invalid or unimportant; it means the entry was captured under some form of uncertainty.

Triage state must not be derived solely from authority. Authority describes why the entry should be treated as meaningful; triage describes whether the entry is settled enough for normal recall and summarization. A direct human-authored entry can still need triage if it was intentionally captured quickly or ambiguously for later cleanup. Conversely, some non-human-authority entries may be settled enough not to require triage.

The initial `needs_triage` value should be computed by the CLI from central policy rather than left entirely to each caller or adapter. Callers may express intent, but the CLI remains responsible for applying guardrails consistently across harnesses.

Default triage policy should be based primarily on `authority.mode`:

| Authority mode | Default triage state | Rationale |
| --- | --- | --- |
| `direct` | `needs_triage=false` | The authority source directly authored the entry, so it is normally settled unless intentionally marked otherwise. |
| `delegated` | `needs_triage=false` | The authority source explicitly instructed another actor to write the entry, so it carries explicit intent. |
| `discretionary` | `needs_triage=true` | The actor decided the entry may be useful without explicit instruction, so it should not silently bypass review by default. |
| `observed` | `needs_triage=true` | External observations may be factual, but v1 has no trust-policy configuration and should not let them silently bypass review. |
| `imported` | `needs_triage=true` | Bulk imported context is likely noisy and may require filtering or routing before normal use. |
| `derived` | `needs_triage=true` | Generated synthesis should not outrank or silently settle itself ahead of its source entries. |

Creation should support explicit triage intent. A caller should be able to force `needs_triage=true` for fast, ambiguous, or intentionally unresolved capture. Forcing `needs_triage=false` should be guarded by the hardcoded v1 policy: only `direct` and `delegated` entries may be created as settled. If a caller requests `needs_triage=false` for `discretionary`, `observed`, `imported`, or `derived`, the CLI should persist the entry as `needs_triage=true` and return a warning rather than rejecting ingestion.
