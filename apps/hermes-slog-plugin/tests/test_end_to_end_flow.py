from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import hermes_slog_plugin


ENTRY_ID = "01JZFULLFLOW000000000000001"


@dataclass
class RegisteredTool:
    name: str
    handler: Any


class RecordingPluginContext:
    def __init__(self) -> None:
        self.tools: dict[str, RegisteredTool] = {}

    def register_tool(
        self,
        *,
        name: str,
        handler: Any,
        **_registration: Any,
    ) -> None:
        self.tools[name] = RegisteredTool(name=name, handler=handler)


def _install_stateful_fake_slog(
    tmp_path: Path,
    monkeypatch,
) -> Path:
    root = tmp_path / "fake-slog-flow"
    bin_dir = root / "bin"
    bin_dir.mkdir(parents=True)
    calls_path = root / "calls.jsonl"
    binary = bin_dir / "slog"

    binary.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "import json",
                "import os",
                "import sys",
                "from pathlib import Path",
                f"ENTRY_ID = {ENTRY_ID!r}",
                f"CALLS_PATH = Path({str(calls_path)!r})",
                "argv = sys.argv[1:]",
                "stdin_text = sys.stdin.read()",
                "slog_home = Path(os.environ['SLOG_HOME'])",
                "state_path = slog_home / 'entries.json'",
                "entries = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else []",
                "payload = json.loads(stdin_text) if stdin_text else None",
                "CALLS_PATH.parent.mkdir(parents=True, exist_ok=True)",
                "with CALLS_PATH.open('a', encoding='utf-8') as call_log:",
                "    call_log.write(json.dumps({",
                "        'argv': sys.argv,",
                "        'stdin': payload,",
                "        'home': os.environ.get('HOME'),",
                "        'slog_home': os.environ.get('SLOG_HOME'),",
                "    }, sort_keys=True) + '\\n')",
                "if argv == ['entry', 'create', '--json', '-']:",
                "    entry = {'id': ENTRY_ID, **payload}",
                "    entries = [entry]",
                "elif argv == ['entry', 'update', '--json', '-']:",
                "    entry = next(item for item in entries if item['id'] == payload['id'])",
                "    entry.update(payload['changes'])",
                "elif argv == ['entry', 'show', '--json', ENTRY_ID]:",
                "    entry = next(item for item in entries if item['id'] == ENTRY_ID)",
                "elif argv == ['entry', 'list', '--json']:",
                "    entry = None",
                "else:",
                "    print(json.dumps({'error': 'unexpected argv', 'argv': argv}), file=sys.stderr)",
                "    raise SystemExit(64)",
                "state_path.write_text(json.dumps(entries, sort_keys=True), encoding='utf-8')",
                "if argv == ['entry', 'list', '--json']:",
                "    print(json.dumps({'entries': entries, 'warnings': []}, sort_keys=True))",
                "else:",
                "    print(json.dumps({'entry': entry, 'warnings': []}, sort_keys=True))",
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
    return calls_path


def _registered_handlers() -> dict[str, Any]:
    ctx = RecordingPluginContext()
    hermes_slog_plugin.register(ctx)
    return {name: tool.handler for name, tool in ctx.tools.items()}


def _read_calls(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_registered_tool_flow_logs_finds_corrects_and_lists_with_provenance(
    isolated_slog_home: Path,
    hermes_session_env,
    monkeypatch,
    tmp_path: Path,
):
    calls_path = _install_stateful_fake_slog(tmp_path, monkeypatch)
    hermes_session_env.set(user_id="user-42", user_name="Ada Lovelace")
    handlers = _registered_handlers()
    dispatch_kwargs = {
        "profile_identity": "researcher",
        "user_task": "Exercise the Hermes slog full flow",
        "task_id": "task-11-full-flow",
        "get_session_env": lambda name, default="": os.environ.get(name, default),
    }

    created = handlers["slog_log"](
        {"text": "initial full-flow entry"}, **dispatch_kwargs
    )
    found_before_update = handlers["slog_find"]({"id": ENTRY_ID}, **dispatch_kwargs)
    corrected = handlers["slog_correct"](
        {"id": ENTRY_ID, "changes": {"text": "corrected full-flow entry"}},
        **dispatch_kwargs,
    )
    listed = handlers["slog_list"]({}, **dispatch_kwargs)

    assert created["ok"] is True
    assert found_before_update["metadata"]["entry"]["entry"]["text"] == (
        "initial full-flow entry"
    )
    assert corrected["ok"] is True
    assert corrected["metadata"]["entry"]["text"] == "corrected full-flow entry"
    listed_entries = listed["metadata"]["entries"]["entries"]
    assert listed_entries == [
        {
            "id": ENTRY_ID,
            "text": "corrected full-flow entry",
            "actor": "hermes:researcher",
            "authority": {
                "mode": "delegated",
                "source": "hermes-session-user:user-42:Ada Lovelace",
            },
            "metadata": {
                "user_task": "Exercise the Hermes slog full flow",
                "task_id": "task-11-full-flow",
                "session_user_id": "user-42",
                "session_user_name": "Ada Lovelace",
            },
        }
    ]

    calls = _read_calls(calls_path)
    assert [call["argv"][1:] for call in calls] == [
        ["entry", "create", "--json", "-"],
        ["entry", "show", "--json", ENTRY_ID],
        ["entry", "update", "--json", "-"],
        ["entry", "list", "--json"],
    ]
    assert all(Path(call["home"]).is_relative_to(tmp_path) for call in calls)
    assert all(Path(call["slog_home"]) == isolated_slog_home for call in calls)
    assert not (Path.home() / ".slog").exists()

    create_payload = calls[0]["stdin"]
    assert create_payload["actor"] == "hermes:researcher"
    assert create_payload["authority"] == {
        "mode": "delegated",
        "source": "hermes-session-user:user-42:Ada Lovelace",
    }
    assert create_payload["metadata"] == {
        "user_task": "Exercise the Hermes slog full flow",
        "task_id": "task-11-full-flow",
        "session_user_id": "user-42",
        "session_user_name": "Ada Lovelace",
    }

    update_payload = calls[2]["stdin"]
    assert update_payload["id"] == ENTRY_ID
    assert update_payload["changes"] == {"text": "corrected full-flow entry"}
    assert update_payload["actor"] == "hermes:researcher"
    assert update_payload["authority"] == create_payload["authority"]
    assert update_payload["metadata"] == create_payload["metadata"]
