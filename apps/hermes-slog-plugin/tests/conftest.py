from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import pytest


SESSION_ENV_NAMES = (
    "HERMES_SESSION_PLATFORM",
    "HERMES_SESSION_CHAT_ID",
    "HERMES_SESSION_CHAT_NAME",
    "HERMES_SESSION_USER_ID",
    "HERMES_SESSION_USER_NAME",
    "HERMES_SESSION_THREAD_ID",
    "HERMES_SESSION_KEY",
)


@dataclass(frozen=True)
class FakeSlogHarness:
    root: Path
    bin_dir: Path
    binary: Path
    argv_file: Path
    stdin_file: Path


class HermesSessionEnvHarness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch):
        self._monkeypatch = monkeypatch

    def clear(self) -> None:
        for name in SESSION_ENV_NAMES:
            self._monkeypatch.delenv(name, raising=False)

    def set(self, **values: str | None) -> None:
        self.clear()
        for name, value in values.items():
            if value is None:
                continue
            env_name = (
                name
                if name.startswith("HERMES_SESSION_")
                else f"HERMES_SESSION_{name.upper()}"
            )
            self._monkeypatch.setenv(env_name, value)


@pytest.fixture(autouse=True)
def _clear_hermes_session_env(monkeypatch: pytest.MonkeyPatch):
    for name in SESSION_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def isolated_slog_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home_dir = tmp_path / "home"
    slog_home = tmp_path / "slog-home"
    home_dir.mkdir()
    slog_home.mkdir()

    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setenv("SLOG_HOME", str(slog_home))
    return slog_home


@pytest.fixture
def isolated_hermes_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home_dir = tmp_path / "home"
    hermes_home = tmp_path / "hermes-home"
    home_dir.mkdir()
    hermes_home.mkdir()

    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    return hermes_home


@pytest.fixture
def fake_slog_factory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def create(
        *,
        stdout: str = "",
        stderr: str = "",
        exit_code: int = 0,
    ) -> FakeSlogHarness:
        root = tmp_path / "fake-slog"
        bin_dir = root / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)

        argv_file = root / "argv.json"
        stdin_file = root / "stdin.bin"
        binary = bin_dir / "slog"

        binary.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env python3",
                    "from pathlib import Path",
                    "import json",
                    "import sys",
                    f"Path({str(argv_file)!r}).write_text(json.dumps(sys.argv), encoding='utf-8')",
                    f"Path({str(stdin_file)!r}).write_bytes(sys.stdin.buffer.read())",
                    f"sys.stdout.write({stdout!r})",
                    f"sys.stderr.write({stderr!r})",
                    f"raise SystemExit({exit_code})",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        binary.chmod(0o755)

        current_path = os.environ.get("PATH", "")
        monkeypatch.setenv(
            "PATH",
            f"{bin_dir}{os.pathsep}{current_path}" if current_path else str(bin_dir),
        )

        return FakeSlogHarness(
            root=root,
            bin_dir=bin_dir,
            binary=binary,
            argv_file=argv_file,
            stdin_file=stdin_file,
        )

    return create


@pytest.fixture
def hermes_session_env(monkeypatch: pytest.MonkeyPatch) -> HermesSessionEnvHarness:
    harness = HermesSessionEnvHarness(monkeypatch)
    harness.clear()
    return harness
