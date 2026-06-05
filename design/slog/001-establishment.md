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

### Non-goals for this design

## Implementation

While the intention of this design is to be as implementation-agnostic as possible, the following sections include some desired implementation details to provide context for the design decisions.

### Data Model

The minimum useful entry shape should be intentionally small. A slog entry must be cheap to create, but still carry enough structure for later trust, sorting, triage, and summarization.

Required v1 fields:

- `id`: stable unique identifier for the entry.
- `created_at`: timestamp for when the entry was recorded.
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
