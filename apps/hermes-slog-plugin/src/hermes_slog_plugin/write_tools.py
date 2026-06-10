from __future__ import annotations

from typing import Any, Mapping

from .cli_adapter import SlogCliError
from .provenance import Provenance, resolve_provenance
from .read_tools import _adapter_from_kwargs, _structured_cli_failure
from .results import ok_result
from .schemas import validate_slog_correct_args, validate_slog_log_args


def slog_log(args: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
    validation_error = validate_slog_log_args(args)
    if validation_error is not None:
        return validation_error

    adapter = _adapter_from_kwargs(kwargs)
    provenance = _provenance_from_kwargs(kwargs)
    payload = _with_provenance(
        {
            "text": args["text"],
            **_optional_arg(args, "occurred_at"),
        },
        provenance,
    )

    try:
        envelope = adapter.create(payload)
    except SlogCliError as error:
        return _structured_cli_failure(error)

    return ok_result(
        "slog entry created.",
        _entry_metadata(envelope, provenance),
    )


def slog_correct(args: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
    validation_error = validate_slog_correct_args(args)
    if validation_error is not None:
        return validation_error

    adapter = _adapter_from_kwargs(kwargs)
    provenance = _provenance_from_kwargs(kwargs)
    payload = _with_provenance(
        {
            "id": args["id"],
            "changes": dict(args["changes"]),
        },
        provenance,
    )

    try:
        envelope = adapter.update(payload)
    except SlogCliError as error:
        return _structured_cli_failure(error)

    return ok_result(
        "slog entry updated.",
        _entry_metadata(envelope, provenance),
    )


def _provenance_from_kwargs(kwargs: Mapping[str, Any]) -> Provenance:
    return resolve_provenance(
        profile_identity=kwargs.get("profile_identity"),
        soul_identity=kwargs.get("soul_identity"),
        user_task=kwargs.get("user_task"),
        task_id=kwargs.get("task_id"),
        get_session_env=kwargs.get("get_session_env"),
    )


def _with_provenance(
    payload: Mapping[str, Any], provenance: Provenance
) -> dict[str, Any]:
    return {
        **payload,
        "actor": provenance.actor,
        "authority": {
            "mode": provenance.authority_mode,
            "source": provenance.authority_source,
        },
        "metadata": dict(provenance.metadata),
    }


def _optional_arg(args: Mapping[str, Any], key: str) -> dict[str, Any]:
    if key not in args:
        return {}
    return {key: args[key]}


def _entry_metadata(
    envelope: Mapping[str, Any], provenance: Provenance
) -> dict[str, Any]:
    metadata: dict[str, Any] = {"entry": envelope.get("entry")}
    warnings = [*provenance.warnings, *_adapter_warnings(envelope)]
    if warnings:
        metadata["warnings"] = warnings
    else:
        metadata["warnings"] = []
    return metadata


def _adapter_warnings(envelope: Mapping[str, Any]) -> list[dict[str, Any]]:
    warnings = envelope.get("warnings", [])
    if not isinstance(warnings, list):
        return []
    return [warning for warning in warnings if isinstance(warning, dict)]
