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

## Design

### Goals for this design

### Non-goals for this design

## Implementation

While the intention of this design is to be as implementation-agnostic as possible, the following sections include some desired implementation details to provide context for the design decisions.

### Data Model
