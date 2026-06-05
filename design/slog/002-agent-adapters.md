# Agent adapters for slog

## Status

Future design stub. Do not implement from this document yet.

## Purpose

Define how Hermes, OpenCode, hooks, imports, and other harnesses translate native actions into stable slog machine commands.

## Questions to resolve

- When should an adapter record `delegated` versus `discretionary` authority?
- How should adapters choose `actor` and `authority.source` identity strings?
- What prompts or tool wrappers should agents use to avoid laundering discretionary observations as human-authorized entries?
- How should adapter failures be reported without parsing human CLI output?
- What, if any, adapter-level defaults are safe without introducing trust-policy configuration into v1?

## Relationship to establishment design

`001-establishment.md` defines the core entry model, machine contracts, and v1 guardrails. This design should build on those contracts rather than changing them casually.
