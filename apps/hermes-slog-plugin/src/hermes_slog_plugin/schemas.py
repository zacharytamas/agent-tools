from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping

from .results import validation_error_result


def _function_schema(
    name: str, description: str, parameters: dict[str, Any]
) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "parameters": parameters,
    }


SLOG_LOG_SCHEMA = _function_schema(
    "slog_log",
    "Create a slog entry from non-empty text.",
    {
        "type": "object",
        "properties": {
            "text": {"type": "string", "minLength": 1},
            "authority_mode": {
                "type": "string",
                "enum": ["delegated", "discretionary"],
            },
            "occurred_at": {"type": "string"},
        },
        "required": ["text"],
        "additionalProperties": False,
    },
)

SLOG_LIST_SCHEMA = _function_schema(
    "slog_list",
    "List slog entries.",
    {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)

SLOG_FIND_SCHEMA = _function_schema(
    "slog_find",
    "Retrieve a slog entry by id.",
    {
        "type": "object",
        "properties": {
            "id": {"type": "string", "minLength": 1},
        },
        "required": ["id"],
        "additionalProperties": False,
    },
)

SLOG_CORRECT_SCHEMA = _function_schema(
    "slog_correct",
    "Correct an existing slog entry using one or more changes.",
    {
        "type": "object",
        "properties": {
            "id": {"type": "string", "minLength": 1},
            "changes": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "minLength": 1},
                    "authority_mode": {
                        "type": "string",
                        "enum": ["delegated", "discretionary"],
                    },
                    "occurred_at": {"type": "string"},
                    "needs_triage": {"type": "boolean"},
                },
                "minProperties": 1,
                "additionalProperties": False,
            },
        },
        "required": ["id", "changes"],
        "additionalProperties": False,
    },
)

TOOL_SCHEMAS = (
    SLOG_LOG_SCHEMA,
    SLOG_LIST_SCHEMA,
    SLOG_FIND_SCHEMA,
    SLOG_CORRECT_SCHEMA,
)


def get_tool_schemas() -> list[dict[str, Any]]:
    return deepcopy(list(TOOL_SCHEMAS))


def validate_slog_log_args(args: Mapping[str, Any]) -> dict[str, Any] | None:
    text = args.get("text")
    if not isinstance(text, str) or not text.strip():
        return validation_error_result("text", "text must be a non-empty string.")
    return None


def validate_slog_find_args(args: Mapping[str, Any]) -> dict[str, Any] | None:
    entry_id = args.get("id")
    if not isinstance(entry_id, str) or not entry_id.strip():
        return validation_error_result("id", "id is required.")
    return None


def validate_slog_correct_args(args: Mapping[str, Any]) -> dict[str, Any] | None:
    entry_id = args.get("id")
    if not isinstance(entry_id, str) or not entry_id.strip():
        return validation_error_result("id", "id is required.")

    changes = args.get("changes")
    if not isinstance(changes, Mapping) or len(changes) == 0:
        return validation_error_result(
            "changes", "changes must include at least one field."
        )

    return None
