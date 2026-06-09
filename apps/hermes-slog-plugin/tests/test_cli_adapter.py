from __future__ import annotations

import json
import subprocess

import pytest

from hermes_slog_plugin.cli_adapter import SlogCliAdapter, SlogCliError


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("method_name", "arguments", "expected_argv_tail", "stdout_payload"),
    [
        (
            "create",
            (
                {
                    "text": "hello",
                    "actor": "test-actor",
                    "authority": {"source": "test-task", "mode": "delegated"},
                },
            ),
            ["entry", "create", "--json", "-"],
            {"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, "warnings": []},
        ),
        (
            "update",
            (
                {
                    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                    "changes": {"text": "updated"},
                },
            ),
            ["entry", "update", "--json", "-"],
            {"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, "warnings": []},
        ),
        (
            "find",
            ("01ARZ3NDEKTSV4RRFFQ69G5FAV",),
            ["entry", "show", "--json", "01ARZ3NDEKTSV4RRFFQ69G5FAV"],
            {"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, "warnings": []},
        ),
        (
            "list",
            tuple(),
            ["entry", "list", "--json"],
            {"entries": [], "warnings": []},
        ),
    ],
)
def test_cli_adapter_uses_exact_slog_command_and_parses_json(
    method_name,
    arguments,
    expected_argv_tail,
    stdout_payload,
    isolated_slog_home,
    fake_slog_factory,
):
    del isolated_slog_home
    fake_slog = fake_slog_factory(stdout=json.dumps(stdout_payload))
    adapter = SlogCliAdapter()

    method = getattr(adapter, method_name)
    result = method(*arguments)

    assert result == stdout_payload
    assert _read_json(fake_slog.argv_file)[1:] == expected_argv_tail
    assert _read_json(fake_slog.argv_file)[0] == str(fake_slog.binary)

    if method_name in {"create", "update"}:
        assert _read_json(fake_slog.stdin_file) == arguments[0]
    else:
        assert fake_slog.stdin_file.read_bytes() == b""


def test_missing_binary_raises_structured_error(isolated_slog_home, monkeypatch):
    del isolated_slog_home
    monkeypatch.setenv("PATH", "/nonexistent")
    adapter = SlogCliAdapter()

    with pytest.raises(SlogCliError) as exc_info:
        adapter.find("01ARZ3NDEKTSV4RRFFQ69G5FAV")

    error = exc_info.value
    assert error.code == "slog_not_found"
    assert error.stdout == ""
    assert error.stderr == ""
    assert error.returncode is None


def test_non_zero_exit_captures_stderr(isolated_slog_home, fake_slog_factory):
    del isolated_slog_home
    fake_slog_factory(stderr="slog exploded", exit_code=17)
    adapter = SlogCliAdapter()

    with pytest.raises(SlogCliError) as exc_info:
        adapter.list()

    error = exc_info.value
    assert error.code == "slog_non_zero_exit"
    assert error.returncode == 17
    assert error.stderr == "slog exploded"


def test_malformed_json_is_structured_parse_failure(
    isolated_slog_home, fake_slog_factory
):
    del isolated_slog_home
    fake_slog_factory(stdout="not-json")
    adapter = SlogCliAdapter()

    with pytest.raises(SlogCliError) as exc_info:
        adapter.list()

    error = exc_info.value
    assert error.code == "slog_invalid_json"
    assert error.stdout == "not-json"


def test_timeout_is_structured_without_sleep(isolated_slog_home, monkeypatch):
    del isolated_slog_home
    adapter = SlogCliAdapter(timeout_seconds=0.01)

    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=kwargs.get("args", args[0]), timeout=0.01)

    monkeypatch.setattr("hermes_slog_plugin.cli_adapter.subprocess.run", fake_run)

    with pytest.raises(SlogCliError) as exc_info:
        adapter.list()

    error = exc_info.value
    assert error.code == "slog_timeout"
    assert error.returncode is None
