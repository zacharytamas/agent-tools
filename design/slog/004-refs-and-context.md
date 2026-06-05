# References and context for slog entries

## Status

Future design stub. Do not implement from this document yet.

## Purpose

Define structured ways to associate slog entries with external context such as links, tasks, projects, repositories, issues, pull requests, and other references.

## Questions to resolve

- Should the first structured reference concept be `links`, `refs`, `tags`, `scope`, or something else?
- How should GitHub, Linear, Beads, repository paths, and URLs be represented without creating an adapter-specific metadata junk drawer?
- Which reference shapes are queryable, display-only, or report-only?
- How should structured refs coexist with plain `text`?
- What migration path exists from v1 text-only context to structured refs?

## Relationship to establishment design

`001-establishment.md` excludes scope, tags, links, task refs, project refs, and generic metadata from the v1 core schema. This design should pressure-test those concepts before adding durable fields.
