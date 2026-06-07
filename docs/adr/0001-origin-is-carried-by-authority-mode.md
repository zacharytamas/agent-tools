# Origin (interactive vs. automated) is carried by `authority.mode`, not actor strings

**Status:** accepted — 2026-06-07

## Decision

slog classifies an entry's *origin* — interactive (captured live during a human session) vs. automated (written by a script, hook, or import) vs. synthetic (generated from other entries) — by partitioning the existing `authority.mode` enum, not by adding a new schema field and not by parsing `actor` identity strings.

Origin partition:

- **interactive:** `direct`, `delegated`, `discretionary`
- **automated:** `observed`, `imported`
- **synthetic:** `derived`

Downstream consumers (notably `003-reporting-and-summaries`) weight entries on this partition: interactive entries are the high-relevance, in-the-moment spine of a report; automated entries are low-narrative-weight but high-precision factual scaffolding (PR numbers, meetings) that the user is likely to forget and therefore must not be dropped; synthetic entries must not outrank their sources.

## Context

`001-establishment.md` froze the v1 core schema and deliberately excluded extra fields. It also defines `actor` / `authority.source` identity strings as **conventions, not validation rules** (only string hygiene is enforced), while `authority.mode` is a closed, CLI-validated enum.

The user's real reporting need is a daily/weekly update that draws from **both** origin classes but weights them differently. That makes origin a mechanically-read filter axis, not a thing eyeballed at read time. Of the available signals, only `authority.mode` is enforced; `actor` is not. Keying report-weighting off the unenforced field while the enforced field encoded a distinction (delegated vs. direct) the user did not value at read-time was backwards.

The delegated/direct distinction is genuinely weak **at read-time** — but it is weak only because it is a sub-split *within* the interactive class. The strong, report-bearing distinction (interactive vs. automated) is carried across class boundaries by the same enum. So no new field is needed.

## Considered and rejected

- **Add an `origin` field to the core schema.** Rejected: 001 froze the schema for good reasons; the enum already partitions origin.
- **Derive origin by parsing `actor` prefixes (`*-hook`, `hermes:*`) at report time.** Rejected: `actor` is convention-only and unenforced; this couples `003` to adapter naming and is fragile.
- **Collapse `delegated` into `direct`.** Rejected as incoherent: `direct` means the authority source authored the entry; an agent writing on instruction did not.

## Known limitation

Mode alone cannot express "automated origin **with** human authorship" — e.g. a user-owned cron that emits a pre-authored template on a schedule. No such case exists in v1. If it arises, the `actor` string (e.g. `*-cron`, `*-script`) remains available as a secondary handle to recover origin, and a dedicated field can be revisited then. We accept this gap rather than design for a hypothetical.

`actor` / `authority.source` remain useful as provenance and filtering handles per 001; they are simply **not** the mechanism for origin-based report weighting.
