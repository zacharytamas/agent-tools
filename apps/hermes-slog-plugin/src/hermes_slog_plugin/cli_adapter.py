from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Any, Mapping


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
        del payload
        raise NotImplementedError

    def update(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        del payload
        raise NotImplementedError

    def find(self, entry_id: str) -> dict[str, Any]:
        del entry_id
        raise NotImplementedError

    def list(self) -> dict[str, Any]:
        raise NotImplementedError
