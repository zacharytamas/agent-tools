import json

from hermes_slog_plugin.results import error_result, ok_result, validation_error_result
from hermes_slog_plugin.schemas import (
    get_tool_schemas,
    validate_slog_correct_args,
    validate_slog_find_args,
    validate_slog_log_args,
)


def test_tool_schemas_are_exactly_four_function_schemas():
    tool_schemas = get_tool_schemas()

    assert [schema["name"] for schema in tool_schemas] == [
        "slog_log",
        "slog_list",
        "slog_find",
        "slog_correct",
    ]
    assert all(
        set(schema) == {"name", "description", "parameters"} for schema in tool_schemas
    )
    assert all(schema["parameters"]["type"] == "object" for schema in tool_schemas)
    json.dumps(tool_schemas)


def test_result_helpers_expose_stable_fields():
    success = ok_result("saved", {"entry_id": "01"})
    failure = error_result("validation_failed", "bad input", {"field": "text"})
    validation = validation_error_result("text", "must be non-empty")

    assert set(success) == {"ok", "code", "message", "metadata"}
    assert set(failure) == {"ok", "code", "message", "metadata"}
    assert success == {
        "ok": True,
        "code": "ok",
        "message": "saved",
        "metadata": {"entry_id": "01"},
    }
    assert failure == {
        "ok": False,
        "code": "validation_failed",
        "message": "bad input",
        "metadata": {"field": "text"},
    }
    assert validation == {
        "ok": False,
        "code": "validation_failed",
        "message": "must be non-empty",
        "metadata": {"field": "text"},
    }


def test_validation_helpers_return_structured_errors():
    assert validate_slog_log_args({"text": "   "}) == validation_error_result(
        "text",
        "text must be a non-empty string.",
    )
    assert validate_slog_find_args({}) == validation_error_result(
        "id",
        "id is required.",
    )
    assert validate_slog_correct_args(
        {"id": "entry-1", "changes": {}}
    ) == validation_error_result(
        "changes",
        "changes must include at least one field.",
    )
