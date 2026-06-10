from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import hermes_slog_plugin
from hermes_slog_plugin.read_tools import slog_find, slog_list
from hermes_slog_plugin.write_tools import slog_log


class MatrixWriteAdapter:
    def __init__(self, *, create_result=None, create_error=None):
        self.create_result = create_result
        self.create_error = create_error
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def create(self, payload):
        self.calls.append(("create", payload))
        if self.create_error is not None:
            raise self.create_error
        return self.create_result


@dataclass
class MatrixRegisteredTool:
    name: str
    toolset: str
    schema: dict[str, Any]
    handler: Any


class MatrixPluginContext:
    def __init__(self) -> None:
        self.tools: list[MatrixRegisteredTool] = []

    def register_tool(
        self,
        *,
        name: str,
        toolset: str,
        schema: dict[str, Any],
        handler: Any,
        **_options: Any,
    ) -> None:
        self.tools.append(MatrixRegisteredTool(name, toolset, schema, handler))


def _assert_no_traceback(result: dict[str, Any]) -> None:
    rendered = json.dumps(result, ensure_ascii=False)
    assert "Traceback (most recent call last)" not in rendered
    assert "RuntimeError:" not in rendered


def test_missing_slog_returns_structured_not_found_without_traceback(
    isolated_slog_home, monkeypatch
):
    del isolated_slog_home
    monkeypatch.setenv("PATH", "/nonexistent")

    result = slog_list({})

    assert result["ok"] is False
    assert result["code"] == "slog_not_found"
    assert result["metadata"]["stdout"] == ""
    assert result["metadata"]["stderr"] == ""
    assert result["metadata"]["returncode"] is None
    _assert_no_traceback(result)


def test_wrong_version_and_lock_style_failures_return_slog_failed_metadata(
    isolated_slog_home, fake_slog_factory
):
    del isolated_slog_home
    fake_slog_factory(
        stdout="partial diagnostic before failure",
        stderr="database is locked; requires slog >= 2099.1",
        exit_code=73,
    )

    result = slog_log(
        {"text": "capture failed write"},
        profile_identity="researcher",
        user_task="Capture failed write",
        get_session_env=lambda _name, default="": default,
    )

    assert result["ok"] is False
    assert result["code"] == "slog_failed"
    assert result["metadata"]["stdout"] == "partial diagnostic before failure"
    assert result["metadata"]["stderr"] == "database is locked; requires slog >= 2099.1"
    assert result["metadata"]["returncode"] == 73
    _assert_no_traceback(result)


def test_bad_and_partial_json_stdout_returns_slog_bad_json_with_raw_stdout(
    isolated_slog_home, fake_slog_factory
):
    del isolated_slog_home
    fake_slog_factory(stdout='{"entry": {"id": "01PARTIAL"')

    result = slog_find({"id": "01PARTIAL"})

    assert result["ok"] is False
    assert result["code"] == "slog_bad_json"
    assert result["metadata"]["stdout"] == '{"entry": {"id": "01PARTIAL"'
    assert result["metadata"]["returncode"] == 0
    _assert_no_traceback(result)


def test_timeout_returns_structured_slog_timeout_without_sleep(
    isolated_slog_home, monkeypatch
):
    del isolated_slog_home

    def fake_run(*args, **kwargs):
        del kwargs
        raise subprocess.TimeoutExpired(
            cmd=args[0],
            timeout=5.0,
            output=b"started",
            stderr=b"still locked",
        )

    monkeypatch.setattr("hermes_slog_plugin.cli_adapter.subprocess.run", fake_run)

    result = slog_list({})

    assert result["ok"] is False
    assert result["code"] == "slog_timeout"
    assert result["metadata"]["stdout"] == "started"
    assert result["metadata"]["stderr"] == "still locked"
    assert result["metadata"]["returncode"] is None
    _assert_no_traceback(result)


def test_missing_identity_user_task_and_session_env_use_safe_warnings():
    adapter = MatrixWriteAdapter(create_result={"entry": {"id": "01SAFE"}, "warnings": []})

    def broken_session_env(name, default=""):
        del default
        raise RuntimeError(f"session unavailable while reading {name}")

    result = slog_log(
        {"text": "discretionary note"},
        adapter=adapter,
        task_id="task-discretionary",
        get_session_env=broken_session_env,
    )

    assert result["ok"] is True
    assert adapter.calls == [
        (
            "create",
            {
                "text": "discretionary note",
                "actor": "hermes:unknown",
                "authority": {
                    "mode": "discretionary",
                    "source": "hermes:unknown",
                },
                "metadata": {"task_id": "task-discretionary"},
            },
        )
    ]
    warning_codes = {warning["code"] for warning in result["metadata"]["warnings"]}
    assert warning_codes == {
        "actor_unresolved",
        "session_env_unavailable",
        "user_task_missing",
    }
    assert "hermes:hightower" not in json.dumps(result)
    _assert_no_traceback(result)


def test_unicode_text_and_paths_survive_json_payload_handling(
    tmp_path, isolated_slog_home, monkeypatch
):
    del isolated_slog_home
    unicode_slog_home = tmp_path / "slog-π-路径"
    unicode_slog_home.mkdir()
    monkeypatch.setenv("SLOG_HOME", str(unicode_slog_home))

    unicode_text = "Path café/東京/🧪 stayed intact"
    adapter = MatrixWriteAdapter(
        create_result={
            "entry": {
                "id": "01UNICODE",
                "text": unicode_text,
                "path": str(unicode_slog_home),
            },
            "warnings": [],
        }
    )

    result = slog_log(
        {"text": unicode_text},
        adapter=adapter,
        profile_identity="研究者",
        user_task="Preserve Unicode payload",
        get_session_env=lambda _name, default="": default,
    )

    payload = adapter.calls[0][1]
    json_round_trip = json.loads(json.dumps(payload))
    assert json_round_trip["text"] == unicode_text
    assert json_round_trip["actor"] == "hermes:研究者"
    assert result["metadata"]["entry"]["text"] == unicode_text
    assert result["metadata"]["entry"]["path"] == str(unicode_slog_home)


def test_duplicate_registration_keeps_exact_four_tool_surface():
    ctx = MatrixPluginContext()

    hermes_slog_plugin.register(ctx)
    hermes_slog_plugin.register(ctx)

    assert [tool.name for tool in ctx.tools] == [
        "slog_log",
        "slog_list",
        "slog_find",
        "slog_correct",
    ]
