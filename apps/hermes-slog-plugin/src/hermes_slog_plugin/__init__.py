from __future__ import annotations

from typing import Any, Mapping

from .results import error_result
from .schemas import get_tool_schemas

TOOLSET = "plugin_hermes_slog"


def _placeholder_handler(tool_name: str):
    def handler(args: Mapping[str, Any], **kwargs: Any) -> dict[str, Any]:
        del args, kwargs
        return error_result(
            "not_implemented",
            f"{tool_name} is registered but its slog persistence handler is not wired yet.",
            {"tool": tool_name},
        )

    return handler


def register(ctx: Any) -> None:
    for schema in get_tool_schemas():
        tool_name = schema["name"]
        ctx.register_tool(
            name=tool_name,
            toolset=TOOLSET,
            schema=schema,
            handler=_placeholder_handler(tool_name),
        )
