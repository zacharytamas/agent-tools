# Indexing, lookup, and sync for slog

## Status

Future design stub. Do not implement from this document yet.

## Purpose

Define future performance, lookup, indexing, export/import, and cross-machine synchronization behavior for slog.

## Questions to resolve

- When is a rebuildable SQLite index/cache justified over direct JSONL partition reads?
- Should prefix ID lookup ever be supported, and if so what exact lookup semantics make it safe?
- How should imports/backfills behave if they need historical event time without violating the v1 `created_at` partition invariant?
- What export/import formats should exist?
- Is cross-machine sync needed, and what conflict model would be acceptable?

## Relationship to establishment design

`001-establishment.md` requires full ULIDs everywhere in v1 and uses ULID timestamp decoding for O(1) expected-partition lookup. It intentionally defers prefix lookup, secondary indexes, mutation history, and sync.
