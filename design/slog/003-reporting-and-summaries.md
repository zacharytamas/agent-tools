# Reporting and summaries for slog

## Status

Future design stub. Do not implement from this document yet.

## Purpose

Define how slog entries should be converted into daily reports, handoffs, summaries, and other human-facing synthesized outputs.

## Questions to resolve

- How should direct and delegated entries be preserved differently from discretionary observations?
- How should unresolved `needs_triage=true` entries affect report generation?
- Should reporting live inside slog, in a harness plugin, or in a separate command layer?
- What output formats matter first: Slack update, plain Markdown, terminal summary, or something else?
- How should source weighting and overclaiming prevention work?

## Relationship to establishment design

`001-establishment.md` intentionally excludes prose report generation and LLM-backed summarization from v1. The v1 report substrate is bounded machine `entry list --json` output.
