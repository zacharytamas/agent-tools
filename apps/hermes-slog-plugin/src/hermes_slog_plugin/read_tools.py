from __future__ import annotations

from typing import Any, Mapping

from .cli_adapter import SlogCliAdapter, SlogCliError
from .results import error_result, ok_result
from .schemas import validate_slog_find_args


def _adapter_from_kwargs(kwargs: Mapping[str, Any]) -> SlogCliAdapter:
    adapter = kwargs.get("adapter")
    if adapter is not None:
        return adapter
    return SlogCliAdapter()


def _structured_cli_failure(error: SlogCliError) -> dict[str, Any]:
    return error_result(
        error.code,
        error.message,
        {
            "argv": error.argv,
            "stdout": error.stdout,
            "stderr": error.stderr,
            "returncode": error.returncode,
        },
    )


def slog_find(args: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
    validation_error = validate_slog_find_args(args)
    if validation_error is not None:
        return validation_error

    entry_id = args["id"]
    adapter = _adapter_from_kwargs(kwargs)

    try:
        entry = adapter.find(entry_id)
    except SlogCliError as error:
        return _structured_cli_failure(error)

    return ok_result("slog entry found.", {"entry": entry})


def slog_list(args: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
    if len(args) > 0:
        return error_result(
            "unsupported_filter",
            "slog_list only supports listing without filters.",
            {"filters": list(args.keys())},
        )

    adapter = _adapter_from_kwargs(kwargs)

    try:
        entries = adapter.list()
    except SlogCliError as error:
        return _structured_cli_failure(error)

    return ok_result("slog entries listed.", {"entries": entries})
