from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def test_isolated_slog_home_points_at_tmp_dir(isolated_slog_home: Path, tmp_path: Path):
    assert Path(os.environ["SLOG_HOME"]) == isolated_slog_home
    assert Path(os.environ["HOME"]).is_relative_to(tmp_path)
    assert Path.home().is_relative_to(tmp_path)


def test_isolated_hermes_home_points_at_tmp_dir(
    isolated_hermes_home: Path, tmp_path: Path
):
    assert Path(os.environ["HERMES_HOME"]) == isolated_hermes_home
    assert Path(os.environ["HOME"]).is_relative_to(tmp_path)
    assert Path.home().is_relative_to(tmp_path)


def test_fake_slog_is_prepended_to_path_and_captures_argv_and_stdin(
    fake_slog_factory,
):
    fake_slog = fake_slog_factory()

    completed = subprocess.run(
        ["slog", "entry", "list"],
        input=b"payload-bytes",
        capture_output=True,
        check=True,
    )

    assert shutil.which("slog") == str(fake_slog.binary)
    assert completed.returncode == 0
    assert fake_slog.argv_file.read_text(encoding="utf-8") == (
        f'["{fake_slog.binary}", "entry", "list"]'
    )
    assert fake_slog.stdin_file.read_bytes() == b"payload-bytes"


def test_hermes_session_env_fixture_sets_and_clears_values(hermes_session_env):
    assert os.getenv("HERMES_SESSION_USER_ID") is None
    assert os.getenv("HERMES_SESSION_USER_NAME") is None

    hermes_session_env.set(user_id="u123", user_name="Zach")

    assert os.getenv("HERMES_SESSION_USER_ID") == "u123"
    assert os.getenv("HERMES_SESSION_USER_NAME") == "Zach"

    hermes_session_env.clear()

    assert os.getenv("HERMES_SESSION_USER_ID") is None
    assert os.getenv("HERMES_SESSION_USER_NAME") is None
