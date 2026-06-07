# Agent adapters for slog

## Status

In design. Partially resolved. Do not implement from this document yet; sections under "Open questions" are unresolved.

## Purpose

Define how Hermes, OpenCode, hooks, imports, and other harnesses translate native actions into stable slog machine commands.

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

The structural enforcement question — whether adapters should expose two distinct surfaces (a gated `delegated` path and a free `discretionary` path with the mode baked into the wrapper) versus one documented machine-write tool — is **open** (see below).

## Open questions

- How should adapters choose `actor` and `authority.source` identity strings? (They remain provenance/filter handles per `001`, but the adapter naming contract is not yet specified.)
- Structural enforcement: two distinct logging surfaces (gated delegated + free discretionary, mode baked into the wrapper) vs. one machine-write tool with a documented convention?
- How should adapter failures be reported without parsing human CLI output? (Adapters consume the machine error envelope on stderr + non-zero exit; the adapter-side handling and `needs_triage_forced` warning surfacing need specifying.)
- What, if any, adapter-level defaults are safe without introducing trust-policy configuration into v1?

## Relationship to establishment design

`001-establishment.md` defines the core entry model, machine contracts, and v1 guardrails. This design builds on those contracts rather than changing them. In particular, the adapter write path is the machine contract only (`slog entry create|update --json -`), since human `slog add` hardcodes `authority = direct`; non-`direct` provenance is reachable only through the machine contract.
