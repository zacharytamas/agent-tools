# Laying the groundwork for a Structured Log ("slog")

## Product

### What is a Structured Log?

A Structured Log ("slog") is a personal/work operational journal stored as durable, structured records and operated through an environment-agnostic CLI.

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

### Non-goals for this design

## Implementation

While the intention of this design is to be as implementation-agnostic as possible, the following sections include some desired implementation details to provide context for the design decisions.

### Data Model
