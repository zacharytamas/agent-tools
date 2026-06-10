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


class RegisteredAdapter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def create(self, payload):
        self.calls.append(("create", payload))
        return {"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, "warnings": []}

    def update(self, payload):
        self.calls.append(("update", payload))
        return {"entry": {"id": payload["id"]}, "warnings": []}

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

    adapter = RegisteredAdapter()

    for tool in ctx.tools:
        call_kwargs = {
            "task_id": "task-1",
            "user_task": "capture this work",
            "profile_identity": "researcher",
            "get_session_env": lambda _name, default="": default,
            "future_unknown_kwarg": "ignored",
        }
        if tool.name == "slog_log":
            result = tool.handler({"text": "hello"}, adapter=adapter, **call_kwargs)
            assert result == {
                "ok": True,
                "code": "ok",
                "message": "slog entry created.",
                "metadata": {
                    "entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"},
                    "warnings": [],
                },
            }
        elif tool.name == "slog_find":
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
        elif tool.name == "slog_correct":
            result = tool.handler(
                {
                    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                    "changes": {"text": "updated"},
                },
                adapter=adapter,
                **call_kwargs,
            )
            assert result == {
                "ok": True,
                "code": "ok",
                "message": "slog entry updated.",
                "metadata": {
                    "entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"},
                    "warnings": [],
                },
            }
