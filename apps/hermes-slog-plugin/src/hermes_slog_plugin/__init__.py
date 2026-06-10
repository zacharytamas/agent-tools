from __future__ import annotations

from typing import Any

from .schemas import get_tool_schemas
from .read_tools import slog_find, slog_list
from .write_tools import slog_correct, slog_log

TOOLSET = "plugin_hermes_slog"
_REGISTERED_TOOLS_ATTR = "_hermes_slog_registered_tools"


def register(ctx: Any) -> None:
    registered_tools = _registered_tools_for(ctx)
    for schema in get_tool_schemas():
        tool_name = schema["name"]
        if tool_name in registered_tools:
            continue

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
        registered_tools.add(tool_name)


def _registered_tools_for(ctx: Any) -> set[str]:
    try:
        context_namespace = vars(ctx)
    except TypeError:
        return set()

    registered_tools = context_namespace.setdefault(_REGISTERED_TOOLS_ATTR, set())
    if not isinstance(registered_tools, set):
        registered_tools = set()
        context_namespace[_REGISTERED_TOOLS_ATTR] = registered_tools
    return registered_tools
