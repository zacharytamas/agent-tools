from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import hermes_slog_plugin
from hermes_slog_plugin.schemas import get_tool_schemas


@dataclass
class RegisteredTool:
    name: str
    toolset: str
    schema: dict[str, Any]
    handler: Any
    options: dict[str, Any]


class RecordingPluginContext:
    def __init__(self) -> None:
        self.tools: list[RegisteredTool] = []

    def register_tool(
        self,
        *,
        name: str,
        toolset: str,
        schema: dict[str, Any],
        handler: Any,
        **options: Any,
    ) -> None:
        self.tools.append(
            RegisteredTool(
                name=name,
                toolset=toolset,
                schema=schema,
                handler=handler,
                options=options,
            )
        )

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"unexpected registration surface: {name}")


class RegisteredReadAdapter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def find(self, entry_id: str):
        self.calls.append(("find", entry_id))
        return {"entry": {"id": entry_id}}

    def list(self):
        self.calls.append(("list", None))
        return {"entries": [{"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}], "warnings": []}


def test_package_exposes_callable_module_register():
    assert callable(hermes_slog_plugin.register)


def test_register_discovers_exact_slog_tool_surface_only():
    ctx = RecordingPluginContext()

    hermes_slog_plugin.register(ctx)

    registered_names = [tool.name for tool in ctx.tools]
    assert registered_names == [
        "slog_log",
        "slog_list",
        "slog_find",
        "slog_correct",
    ]
    assert [tool.schema for tool in ctx.tools] == get_tool_schemas()
    assert {tool.toolset for tool in ctx.tools} == {"plugin_hermes_slog"}
    assert all(tool.options == {} for tool in ctx.tools)


def test_registered_handlers_accept_hermes_dispatch_kwargs():
    ctx = RecordingPluginContext()

    hermes_slog_plugin.register(ctx)

    assert len(ctx.tools) == 4

    adapter = RegisteredReadAdapter()

    for tool in ctx.tools:
        call_kwargs = {
            "task_id": "task-1",
            "user_task": "capture this work",
            "future_unknown_kwarg": "ignored",
        }
        if tool.name == "slog_find":
            result = tool.handler(
                {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, adapter=adapter, **call_kwargs
            )
            assert result == {
                "ok": True,
                "code": "ok",
                "message": "slog entry found.",
                "metadata": {"entry": {"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}}},
            }
        elif tool.name == "slog_list":
            result = tool.handler({}, adapter=adapter, **call_kwargs)
            assert result == {
                "ok": True,
                "code": "ok",
                "message": "slog entries listed.",
                "metadata": {
                    "entries": {
                        "entries": [{"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}],
                        "warnings": [],
                    }
                },
            }
        else:
            result = tool.handler({}, **call_kwargs)
            assert set(result) == {"ok", "code", "message", "metadata"}
            assert result["ok"] is False
            assert result["code"] == "not_implemented"
            assert result["metadata"]["tool"] == tool.name
