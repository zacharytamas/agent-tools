from __future__ import annotations

import subprocess
from dataclasses import dataclass
import json
from typing import Any, Mapping, Sequence


@dataclass(slots=True)
class SlogCliError(Exception):
    code: str
    message: str
    argv: list[str] | None = None
    stdout: str = ""
    stderr: str = ""
    returncode: int | None = None

    def __post_init__(self) -> None:
        super().__init__(self.message)


class SlogCliAdapter:
    def __init__(self, *, binary: str = "slog", timeout_seconds: float = 5.0):
        self.binary = binary
        self.timeout_seconds = timeout_seconds

    def create(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._run_json(["entry", "create", "--json", "-"], payload=payload)

    def update(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._run_json(["entry", "update", "--json", "-"], payload=payload)

    def find(self, entry_id: str) -> dict[str, Any]:
        return self._run_json(["entry", "show", "--json", entry_id])

    def list(self) -> dict[str, Any]:
        return self._run_json(["entry", "list", "--json"])

    def _run_json(
        self,
        arguments: Sequence[str],
        *,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        argv = [self.binary, *arguments]
        stdin = json.dumps(payload) if payload is not None else None

        try:
            completed = subprocess.run(
                argv,
                input=stdin,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.timeout_seconds,
                check=False,
            )
        except FileNotFoundError as error:
            raise SlogCliError(
                code="slog_not_found",
                message=f"slog binary not found: {self.binary}",
                argv=argv,
                stdout="",
                stderr="",
                returncode=None,
            ) from error
        except subprocess.TimeoutExpired as error:
            raise SlogCliError(
                code="slog_timeout",
                message=f"slog command timed out after {self.timeout_seconds} seconds",
                argv=argv,
                stdout=_string_output(error.stdout),
                stderr=_string_output(error.stderr),
                returncode=None,
            ) from error

        if completed.returncode != 0:
            raise SlogCliError(
                code="slog_failed",
                message=f"slog command exited with status {completed.returncode}",
                argv=argv,
                stdout=completed.stdout,
                stderr=completed.stderr,
                returncode=completed.returncode,
            )

        try:
            parsed = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise SlogCliError(
                code="slog_bad_json",
                message="slog command returned malformed JSON",
                argv=argv,
                stdout=completed.stdout,
                stderr=completed.stderr,
                returncode=completed.returncode,
            ) from error

        if not isinstance(parsed, dict):
            raise SlogCliError(
                code="slog_bad_json",
                message="slog command returned JSON that was not an object",
                argv=argv,
                stdout=completed.stdout,
                stderr=completed.stderr,
                returncode=completed.returncode,
            )

        return parsed


def _string_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value
