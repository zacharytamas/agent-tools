from __future__ import annotations

from typing import Any

from .schemas import get_tool_schemas
from .read_tools import slog_find, slog_list
from .write_tools import slog_correct, slog_log

TOOLSET = "plugin_hermes_slog"


def register(ctx: Any) -> None:
    for schema in get_tool_schemas():
        tool_name = schema["name"]
        handler = {
            "slog_log": slog_log,
            "slog_list": slog_list,
            "slog_find": slog_find,
            "slog_correct": slog_correct,
        }[tool_name]
        ctx.register_tool(
            name=tool_name,
            toolset=TOOLSET,
            schema=schema,
            handler=handler,
        )
