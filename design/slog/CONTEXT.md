# slog Design Context

## Glossary

- **slog** — A personal/work operational journal stored as durable, structured records and operated through a CLI and programmatic API.

- **entry** — The canonical domain unit: a thing a human, agent, automation, or import adds to the slog because it may matter later.

- **record** — The persistence representation of an entry on disk. Product language generally uses "entry"; implementation language may use "record" when precision is useful.

- **slog core** — The shared programmatic API inside `packages/slog`. All clients (CLI, harness plugins, hooks) import from it. It owns validation, guardrails, and storage orchestration.

- **slog client** — Any code that imports and calls the slog core. The CLI is a client. Hermes integration is a client. OpenCode integration is a client. A GitHub Actions hook script is a client.

- **harness plugin** — The harness-specific translation layer that maps a harness's native concepts (e.g., Hermes tool calls, OpenCode functions) into slog core calls. Also called "agent adapter" in casual conversation, but "harness plugin" is the canonical term.

- **adapter interface** — The exact function signatures and types exported by the slog core. Defined in `002-adapter-interface.md`.

- **human UX** — The terminal-facing CLI layer (`slog add`, `slog list`, etc.). It is one slog client among many.

- **machine contract** — The JSON-native process contract used by clients that shell out or pipe to the CLI. Still supported, but no longer the canonical boundary. See `001-establishment.md`.

- **origin** — The report-bearing classification of an entry: interactive, automated, or synthetic. Carried by `authority.mode`.

- **interactive** origin — Entries captured live during a human session. Authority modes: `direct`, `delegated`, `discretionary`.

- **automated** origin — Entries written by scripts, hooks, or imports. Authority modes: `observed`, `imported`.

- **synthetic** origin — Entries generated from other slog entries. Authority mode: `derived`.

- **authority** — Structured provenance describing why an entry should be treated as meaningful. Composed of `actor`, `authority.source`, and `authority.mode`.

- **actor** — The immediate writer of the entry.

- **authority.source** — The person, agent, system, or external source whose authority made the entry worth recording.

- **authority.mode** — How that authority was applied. One of: `direct`, `delegated`, `discretionary`, `observed`, `imported`, `derived`.

- **triage** — Whether an entry requires later classification, cleanup, routing, or review. Represented by `needs_triage`. Not derived from authority; a direct entry can need triage, and an observed entry can be settled.
