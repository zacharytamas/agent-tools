from __future__ import annotations

from typing import Any, Mapping


def tool_result(
    ok: bool, code: str, message: str, metadata: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "ok": ok,
        "code": code,
        "message": message,
        "metadata": dict(metadata or {}),
    }


def ok_result(
    message: str, metadata: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    return tool_result(True, "ok", message, metadata)


def error_result(
    code: str, message: str, metadata: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    return tool_result(False, code, message, metadata)


def validation_error_result(
    field: str,
    message: str,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    combined_metadata = {"field": field}
    if metadata:
        combined_metadata.update(metadata)
    return error_result("validation_failed", message, combined_metadata)
