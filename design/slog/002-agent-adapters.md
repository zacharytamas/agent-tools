# Agent adapters for slog

## Status

Design resolved. Ready for implementation.

## Purpose

Define how interactive agents (e.g. Hermes, OpenCode), hooks, imports, and other harnesses translate native actions into stable slog machine commands.

## Boundary: the machine contract

The adapter write path is the machine contract only — `slog entry create|update --json -` via stdin. Human `slog add` hardcodes `authority = direct` and is not an adapter path. Non-`direct` provenance is reachable only through the machine contract. Adapters must not parse human-oriented CLI output for any purpose; they consume the machine JSON success envelope on stdout and the machine error envelope on stderr.

## Resolved decisions

### Origin is the report-bearing axis, carried by `authority.mode`

An entry's *origin* — interactive (captured live in a human session), automated (script/hook/import), or synthetic (generated from other entries) — is the axis downstream reporting weights on. It is derived from `authority.mode`, not from `actor` strings and not from a new field:

- **interactive:** `direct`, `delegated`, `discretionary`
- **automated:** `observed`, `imported`
- **synthetic:** `derived`

Reporting (`003`) treats interactive entries as the high-relevance spine and automated entries as low-narrative-weight but high-precision factual scaffolding that must not be dropped. Adapters are therefore responsible for stamping the *honest* mode, because the mode — not the actor label — is what carries origin to report time. See [ADR-0001](../../docs/adr/0001-origin-is-carried-by-authority-mode.md).

### `delegated` vs. `discretionary`: same-turn explicit log-intent

An adapter may stamp `delegated` only when all three hold:

1. **Explicit log intent** — the user's words in the current turn ask for an entry to be recorded ("log that…", "note…", "add to slog…"), not merely that the user did something loggable.
2. **Same-turn traceability** — the instruction is in the current user turn, not inferred from session history or a standing rule.
3. **Content fidelity** — the entry records what the user asked to log. Agent embellishment beyond that intent is `discretionary`, not `delegated`.

Anything failing the gate is `discretionary`. **On any ambiguity, the adapter must drop to `discretionary`.** A false `discretionary` costs one triage review; a false `delegated` permanently mislabels provenance and inflates an agent guess into human-weighted report signal.

Standing user rules (e.g. "always log my PR reviews") authorize an agent's *initiative*, not a specific entry's human authority, so entries written under a standing rule in a later turn are `discretionary`, not `delegated`. Promoting standing rules to `delegated` would require a trust-policy/identity design that `001` defers; it is out of scope here.

### Containment over verification

slog cannot verify adapter honesty at write time — there is no proof a human said "log this." The CLI boundary *is* enforceable and already contains the dangerous case: only `direct`/`delegated` may create settled (`needs_triage=false`) entries; `discretionary`/`observed`/`imported`/`derived` are forced to `needs_triage=true` with a `needs_triage_forced` warning. The design goal is therefore to make adapter dishonesty *cheap*, not impossible:

- Lying "down" (discretionary stamped where delegated was true) is harmless — an extra triage review.
- Lying "up" (delegated stamped where discretionary was true) is the only dangerous case, and the same-turn rule above is chosen specifically because it is the most *auditable* definition: an agent can answer "is there a log instruction in this turn?" near-deterministically, leaving little rationalization surface.

### Structural enforcement: one agent tool, default-to-discretionary

Agent-facing harnesses expose a single log-authoring tool. The tool's `authority.mode` parameter defaults to `discretionary` and accepts all modes except `direct`, which is structurally excluded — the agent is never the authority source. Setting `delegated` requires a conscious override away from the default; the path of least resistance produces a discretionary (triaged) entry.

`direct` is reserved for the human-at-keyboard `slog add` command and must not be available in agent-facing tools. A gated human-only command surface (a command the model cannot self-call) that would stamp `delegated` on the user's behalf is deferred. The reason is user-friction cost: requiring the user to phrase every log entry verbatim, when the agent already holds the relevant context in the turn, increases activation energy for capture — especially harmful for ADHD users who need to get information out of their head before it is lost. The small trust risk of an agent consciously overriding the default to `delegated` without cause is accepted in v1 over the capture friction a gated path would introduce.

If future experience shows the agent overrides to `delegated` too freely, a gated command surface can be added later; the tool design does not preclude it.

### Actor identity conventions

Adapters choose identity strings per the conventions from `001-establishment.md`:

| Context | `actor` | `authority.source` (when mode = discretionary) |
| --- | --- | --- |
| Interactive agent | `<harness>:<agent-name>` (e.g. `hermes:hightower`) | Same as `actor` (agent acting on own initiative) |
| Hook | `<system>-hook` (e.g. `github-hook`) | `external:<system>` |
| Import | `<system>-import` (e.g. `github-import`) | `external:<system>` |
| Derived generator | `slog-<tool>` (e.g. `slog-summary`) | `slog-<tool>` |
| Human CLI | configured user name or OS username fallback | Same as `actor` |

When an agent overrides to `delegated`, `authority.source` must be the user's identity while `actor` remains the harness identity — this preserves the provenance distinction: the agent wrote it on the user's authority.

These are conventions enforced at the adapter level. The slog CLI only validates string hygiene (non-empty, no leading/trailing whitespace, no control characters). An adapter that stamps non-standard strings will produce entries that are technically valid but will not sort cleanly with other entries at filter time.

### Safe adapter defaults

The following defaults apply to agent-facing log-authoring tools:

- `authority.mode`: **`discretionary`** — the actor chose to record this on its own initiative.
- `occurred_at`: **omitted** — the entry describes something happening at or near creation time. Set only when a reliable external event time is available (e.g. a hook timestamp, a PR merge time meaningfully different from now).
- `needs_triage`: **omitted (let CLI apply default policy)** — non-`direct`/`delegated` modes are forced to `true` by the CLI guardrail regardless of caller intent.
- `actor` and `authority.source`: populated per the identity conventions above.

No trust-policy configuration, timezone overrides, or adapter-profile configuration is introduced in v1. These are deferred to a future design per `001`.

### Adapter failure reporting

The slog CLI returns three possible outcomes at the process level. The adapter captures and interprets them:

| Outcome | Adapter action |
| --- | --- |
| Exit 0, warnings empty (\(`{entry, warnings: []}`\)) | Entry persisted as requested. Silent. |
| Exit 0, warnings non-empty (\(`{entry, warnings: [...]}`\)) | Guardrail promoted the entry to triage (the `needs_triage_forced` warning). This is the expected behavior for any \(`discretionary`\)/\(`observed`\)/\(`imported`\)/\(`derived`\) write. Silently absorb the warning — it is not a problem to surface to the user. |
| Exit non-zero, error envelope on stderr | Entry was not persisted. Adapter dispatches by error code: |

| Error code | Likely cause | Adapter action |
| --- | --- | --- |
| `validation_failed` with details on `text`, `actor`, `authority.source`, or `authority.mode` | Agent composed structurally bad input (empty text, invalid mode, etc.). | Surface a readable error to the user: "couldn't log that — [specific reason from error details]" |
| `validation_failed` with `forbidden_field` details on `id` or `created_at` | Agent included system-managed fields it should not. These are artifacts of an incorrectly composed tool call, not user input problems. | Retry silently after stripping the offending fields. |
| `entry_not_found` | An update operation referenced a non-existent entry ID. | Surface a readable error to the user: the referenced entry does not exist. |
| `partition_locked` | Transient filesystem contention. | Retry silently once. If it fails again, surface a readable error: "the slog is busy, try again." |
| Unknown or unexpected code | Infrastructure or logic failure. | Surface a readable error with the code and message without dumping raw JSON. |

The table distinguishes errors the adapter can *recover from silently* (forbidden fields, partition lock) from errors the user needs to *know about* (bad input, wrong ID). The adapter should never dump raw error envelopes into the user's session.

## Relationship to establishment design

`001-establishment.md` defines the core entry model, machine contracts, and v1 guardrails. This design builds on those contracts rather than changing them.
