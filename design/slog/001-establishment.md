# Laying the groundwork for a Structured Log ("slog")

## Product

### What is a Structured Log?

A Structured Log ("slog") is a personal/work operational journal made of entries stored as durable, structured records and operated through an environment-agnostic CLI.

An entry is the canonical domain unit: the thing a human, agent, automation, or import adds to the slog because it may matter later. A record is the persistence representation of an entry on disk. Product language should generally use "entry"; implementation and storage language may use "record" when precision is useful.

The CLI is the product foundation. It is not primarily a Hermes feature, an OpenCode feature, or a feature of any other agent harness. Harness-specific integrations should behave as thin translation layers over the same CLI calls so that entries created from different environments share the same underlying log, conventions, and user experience.

A slog should answer: what happened, who or what recorded it, on whose authority it was recorded, when it happened, what area of work it belongs to, what follow-up it implies, and how it can be summarized or queried later.

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
slog show <id>
```

Machine-facing commands should optimize for explicit structured input and stable output, such as:

```sh
slog entry create --json '{...}'
slog entry update --json '{...}'
slog entry list --json
slog entry show <id> --json
```

Harness integrations must not parse human-oriented CLI output. Hermes, OpenCode, hooks, imports, and future adapters should use JSON-native machine commands so the human CLI remains free to improve its display without breaking integrations.

Machine writers should provide `actor` and `authority` explicitly on create. Integration profiles may help identify the calling integration, locate config, or set safe defaults for the actor, but they should not silently imply human-delegated authority for arbitrary agent writes. A harness adapter is responsible for translating each native action into the correct authority mode: delegated when the user explicitly asked for the log write, discretionary when the agent chose to record something on its own, observed/imported for external system facts, and derived for generated synthesis.

Human UX commands may use local defaults because their operating context is narrower and interactive. Machine contracts should favor explicit provenance over convenience.

### Read and query surface

V1 read/query operations should be limited to fields that are part of the core entry model.

Human-facing read commands should include:

```sh
slog list
slog today
slog triage
slog show <id>
slog search <query>
```

Machine-facing read commands should provide JSON-native output and explicit filters:

```sh
slog entry list --json
slog entry show <id> --json
```

V1 filters should include:

- date range
- `needs_triage`
- `actor`
- `authority.source`
- `authority.mode`
- text search over `text`

Scope, tag, link, project, task, and summary filters should be deferred until those concepts have canonical shapes.

Human `slog list` should default to a bounded view, likely today's entries in reverse chronological order. Machine `slog entry list --json` should also default to a bounded date range unless an explicit broader range or `--all` is supplied. `slog triage` should list unresolved entries, likely bounded to today by default with an explicit `--all` option.

V1 should require full ULIDs everywhere. Human and machine commands should both store, emit, and accept full IDs only. Prefix matching is intentionally out of scope for v1 because it would require either archive scans, an index/cache, or additional bounded-lookup semantics that are not necessary for the foundation.

Because records are stored in daily JSONL partitions, commands that address an entry by ID still need an efficient way to find the owning partition. ULIDs encode their creation timestamp in the first 48 bits, so an implementation can decode the timestamp from a full ULID in O(1), convert that instant into the configured slog timezone, and inspect the corresponding daily partition first.

V1 lookup by ID should therefore:

1. Require a syntactically valid full ULID.
2. Decode the ULID timestamp to derive the expected daily partition in the configured slog timezone.
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

### Persistence Model

The v1 source of truth should be newline-delimited JSON (JSONL) current-state records.

Although YAML daily files would be more hand-readable and produce more pleasant git diffs, the design should optimize for the path most likely to be used in practice: operating through the CLI and machine integrations. JSONL is simpler to implement, append, parse, validate, stream, and recover than YAML, and it better matches the JSON-native machine contract. Human-readable storage can be revisited later if real usage shows that hand-editing or git-diff review matters more than expected.

The initial persistence model should be deliberately swappable. The CLI and machine API should expose entries, not storage files, so a future implementation can migrate from JSONL to YAML, SQLite, or a hybrid model without changing harness integrations.

V1 storage doctrine:

- Store records as JSONL.
- Partition records into daily files.
- Treat each line as the current-state record for one entry.
- Store each entry exactly once in its owning daily partition.
- Update entries by rewriting the relevant daily partition file atomically.
- Use file locking around writes to avoid concurrent write corruption.
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

Timestamps should be stored as ISO 8601 strings with explicit offsets, such as `2026-06-05T13:08:00-04:00`. The slog is day/report oriented, so daily partitions and date-based queries should use the configured slog timezone rather than UTC day boundaries. The default timezone should be the system local timezone, with room for a later config override such as `timezone = "America/New_York"`.

Implementations should parse timestamps into instants for comparison and sorting, but preserve offset-bearing ISO strings in records and machine JSON. The stored timestamp should remain human-inspectable while still being unambiguous.

Because the implementation is expected to use TypeScript with Effect, ID generation should sit behind a small service boundary rather than being called directly throughout the domain. Production can use ULID generation while tests can provide deterministic IDs.

The minimum useful entry shape should be intentionally small. A slog entry must be cheap to create, but still carry enough structure for later trust, sorting, triage, and summarization.

Required v1 fields:

- `id`: stable unique identifier for the entry.
- `created_at`: timestamp for when the entry was recorded.
- `occurred_at`: optional timestamp for when the described thing happened, if known and materially different from when it was recorded.
- `text`: the human-readable content of the entry.
- `actor`: the immediate writer of the entry.
- `authority.source`: the person, agent, system, or external source whose authority made the entry worth recording.
- `authority.mode`: how that authority was applied.
- `needs_triage`: whether the entry requires later classification, cleanup, routing, or review.

The initial design should avoid prematurely committing to detailed shapes for adjacent concepts such as scopes, tags, links, metadata, projects, tasks, or summaries. Those concepts are likely important, but their schemas need separate pressure-testing. If included in an early implementation, they should be represented in an amendable way that does not force irreversible semantics into the foundation.

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
| `observed` | `needs_triage=false` or policy-defined | Concrete external observations may be settled if the observing integration is trusted and the event shape is narrow. |
| `imported` | `needs_triage=true` or policy-defined | Bulk imported context is likely noisy and may require filtering or routing before normal use. |
| `derived` | policy-defined | Generated synthesis may be settled if source-backed, but should not outrank its source entries. |

Creation should support explicit triage intent. A caller should be able to force `needs_triage=true` for fast, ambiguous, or intentionally unresolved capture. Forcing `needs_triage=false` should be guarded: it should be allowed for direct or delegated authority, allowed for configured trusted integrations, or require an explicit sharp-edged override. Arbitrary discretionary agent-created entries should not be allowed to silently create settled entries by default.
