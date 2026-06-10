from __future__ import annotations

import importlib
import importlib.metadata
import json
import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import hermes_slog_plugin


EXPECTED_TOOLS = ["slog_log", "slog_list", "slog_find", "slog_correct"]
ENTRY_POINT_NAME = "hermes-slog"
ENTRY_POINT_VALUE = "hermes_slog_plugin"
ENTRY_POINTS_GROUP = "hermes_agent.plugins"
HERMES_REPO = Path("/Users/zachary/.hermes/hermes-agent")


@dataclass
class HermesHost:
    mode: str
    manager_cls: Any
    registry: Any
    dispatch: Any


class CompatibleRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, SimpleNamespace] = {}

    def register(
        self,
        *,
        name: str,
        toolset: str,
        schema: dict[str, Any],
        handler: Any,
        **options: Any,
    ) -> None:
        self._tools[name] = SimpleNamespace(
            name=name,
            toolset=toolset,
            schema=schema,
            handler=handler,
            options=options,
        )

    def deregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get_entry(self, name: str) -> SimpleNamespace | None:
        return self._tools.get(name)

    def dispatch(self, name: str, args: dict[str, Any], **kwargs: Any) -> Any:
        entry = self.get_entry(name)
        if entry is None:
            return {"error": f"Unknown tool: {name}"}
        return entry.handler(args, **kwargs)


class CompatiblePluginContext:
    def __init__(self, manifest: SimpleNamespace, registry: CompatibleRegistry) -> None:
        self.manifest = manifest
        self._registry = registry

    def register_tool(self, **kwargs: Any) -> None:
        self._registry.register(**kwargs)


class CompatiblePluginManager:
    def __init__(self, registry: CompatibleRegistry) -> None:
        self.registry = registry
        self.loaded_plugins: dict[str, SimpleNamespace] = {}

    def discover_and_load(self, force: bool = False) -> None:
        del force
        enabled = _enabled_plugins_from_config(Path(os.environ["HERMES_HOME"]))
        entry_points = importlib.metadata.entry_points()
        group_entry_points = entry_points.select(group=ENTRY_POINTS_GROUP)
        for entry_point in group_entry_points:
            manifest = SimpleNamespace(
                name=entry_point.name,
                key=entry_point.name,
                source="entrypoint",
                path=entry_point.value,
            )
            if entry_point.name not in enabled:
                self.loaded_plugins[entry_point.name] = SimpleNamespace(
                    manifest=manifest,
                    enabled=False,
                    tools_registered=[],
                )
                continue
            module = entry_point.load()
            ctx = CompatiblePluginContext(manifest, self.registry)
            module.register(ctx)
            self.loaded_plugins[entry_point.name] = SimpleNamespace(
                manifest=manifest,
                enabled=True,
                tools_registered=list(self.registry._tools),
            )


def test_hermes_loader_discovers_entry_point_registers_tools_and_dispatches_context(
    isolated_hermes_home: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _assert_pyproject_entry_point_is_module_only()
    calls_path = _install_recording_slog(tmp_path, monkeypatch)
    slog_home = _isolate_hermes_loader_state(
        isolated_hermes_home, tmp_path, monkeypatch
    )
    host = _load_hermes_host(monkeypatch)
    entry_point = importlib.metadata.EntryPoint(
        name=ENTRY_POINT_NAME,
        value=ENTRY_POINT_VALUE,
        group=ENTRY_POINTS_GROUP,
    )
    monkeypatch.setattr(
        importlib.metadata,
        "entry_points",
        lambda: importlib.metadata.EntryPoints([entry_point]),
    )

    registration_calls: list[tuple[str, str]] = []
    original_register = host.registry.register

    def recording_register(**kwargs: Any) -> Any:
        if kwargs.get("toolset") == hermes_slog_plugin.TOOLSET:
            registration_calls.append((kwargs["name"], kwargs["toolset"]))
        return original_register(**kwargs)

    register_calls: list[str] = []
    original_plugin_register = hermes_slog_plugin.register

    def recording_plugin_register(ctx: Any) -> None:
        register_calls.append(type(ctx).__name__)
        original_plugin_register(ctx)

    monkeypatch.setattr(host.registry, "register", recording_register)
    monkeypatch.setattr(hermes_slog_plugin, "register", recording_plugin_register)

    try:
        manager = _new_manager(host)
        manager.discover_and_load(force=True)

        assert entry_point.load() is hermes_slog_plugin
        assert callable(getattr(entry_point.load(), "register", None))
        assert register_calls == [
            "PluginContext" if host.mode == "real" else "CompatiblePluginContext"
        ]
        assert registration_calls == [
            ("slog_log", hermes_slog_plugin.TOOLSET),
            ("slog_list", hermes_slog_plugin.TOOLSET),
            ("slog_find", hermes_slog_plugin.TOOLSET),
            ("slog_correct", hermes_slog_plugin.TOOLSET),
        ]

        registered_entries = [host.registry.get_entry(name) for name in EXPECTED_TOOLS]
        assert all(entry is not None for entry in registered_entries)
        assert [
            entry.name for entry in registered_entries if entry is not None
        ] == EXPECTED_TOOLS
        assert {entry.toolset for entry in registered_entries if entry is not None} == {
            hermes_slog_plugin.TOOLSET
        }

        result = host.dispatch(
            "slog_log",
            {"text": "QA loader dispatch entry"},
            task_id="qa-task-1",
            user_task="Please log QA evidence",
        )

        assert result["ok"] is True
        assert result["metadata"]["entry"]["id"] == "01QA0000000000000000000000"
        calls = _read_calls(calls_path)
        assert len(calls) == 1
        assert calls[0]["argv"][1:] == ["entry", "create", "--json", "-"]
        assert Path(calls[0]["home"]).is_relative_to(tmp_path)
        assert Path(calls[0]["hermes_home"]) == isolated_hermes_home
        assert Path(calls[0]["slog_home"]) == slog_home

        create_payload = calls[0]["stdin"]
        assert create_payload["text"] == "QA loader dispatch entry"
        assert create_payload["actor"] == "hermes:unknown"
        assert create_payload["authority"] == {
            "mode": "delegated",
            "source": "hermes-task:qa-task-1",
        }
        assert create_payload["metadata"] == {
            "task_id": "qa-task-1",
            "user_task": "Please log QA evidence",
        }
        assert not (Path.home() / ".slog").exists()
    finally:
        for tool_name in EXPECTED_TOOLS:
            host.registry.deregister(tool_name)


def _assert_pyproject_entry_point_is_module_only() -> None:
    pyproject = Path(__file__).parents[1] / "pyproject.toml"
    config = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    entry_points = config["project"]["entry-points"][ENTRY_POINTS_GROUP]
    assert entry_points == {ENTRY_POINT_NAME: ENTRY_POINT_VALUE}
    assert ":" not in entry_points[ENTRY_POINT_NAME]


def _isolate_hermes_loader_state(
    hermes_home: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    slog_home = tmp_path / "slog-home"
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setenv("SLOG_HOME", str(slog_home))
    monkeypatch.setenv(
        "HERMES_BUNDLED_PLUGINS", str(tmp_path / "empty-bundled-plugins")
    )
    monkeypatch.delenv("HERMES_ENABLE_PROJECT_PLUGINS", raising=False)
    Path(os.environ["HOME"]).mkdir(exist_ok=True)
    slog_home.mkdir(exist_ok=True)
    Path(os.environ["HERMES_BUNDLED_PLUGINS"]).mkdir(exist_ok=True)
    (hermes_home / "config.yaml").write_text(
        "plugins:\n  enabled:\n    - hermes-slog\n",
        encoding="utf-8",
    )
    return slog_home


def _load_hermes_host(monkeypatch: pytest.MonkeyPatch) -> HermesHost:
    monkeypatch.syspath_prepend(str(HERMES_REPO))
    try:
        plugins = importlib.import_module("hermes_cli.plugins")
        registry_module = importlib.import_module("tools.registry")
    except Exception:
        registry = CompatibleRegistry()
        return HermesHost(
            mode="compatible",
            manager_cls=lambda: CompatiblePluginManager(registry),
            registry=registry,
            dispatch=lambda name, args, **kwargs: registry.dispatch(
                name, args, **kwargs
            ),
        )

    return HermesHost(
        mode="real",
        manager_cls=plugins.PluginManager,
        registry=registry_module.registry,
        dispatch=_real_dispatch,
    )


def _real_dispatch(name: str, args: dict[str, Any], **kwargs: Any) -> Any:
    model_tools = importlib.import_module("model_tools")
    return model_tools.handle_function_call(
        name,
        args,
        skip_pre_tool_call_hook=True,
        skip_tool_request_middleware=True,
        **kwargs,
    )


def _new_manager(host: HermesHost) -> Any:
    return host.manager_cls()


def _enabled_plugins_from_config(hermes_home: Path) -> set[str]:
    config_text = (hermes_home / "config.yaml").read_text(encoding="utf-8")
    return {
        line.strip().removeprefix("- ").strip()
        for line in config_text.splitlines()
        if line.strip().startswith("- ")
    }


def _install_recording_slog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "fake-slog-loader"
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
                f"CALLS_PATH = Path({str(calls_path)!r})",
                "stdin_text = sys.stdin.read()",
                "payload = json.loads(stdin_text) if stdin_text else None",
                "CALLS_PATH.parent.mkdir(parents=True, exist_ok=True)",
                "with CALLS_PATH.open('a', encoding='utf-8') as call_log:",
                "    call_log.write(json.dumps({",
                "        'argv': sys.argv,",
                "        'stdin': payload,",
                "        'home': os.environ.get('HOME'),",
                "        'hermes_home': os.environ.get('HERMES_HOME'),",
                "        'slog_home': os.environ.get('SLOG_HOME'),",
                "    }, sort_keys=True) + '\\n')",
                "if sys.argv[1:] != ['entry', 'create', '--json', '-']:",
                "    print(json.dumps({'error': 'unexpected argv', 'argv': sys.argv[1:]}), file=sys.stderr)",
                "    raise SystemExit(64)",
                "entry = {'id': '01QA0000000000000000000000', **payload}",
                "print(json.dumps({'entry': entry, 'warnings': []}, sort_keys=True))",
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


def _read_calls(calls_path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line) for line in calls_path.read_text(encoding="utf-8").splitlines()
    ]
