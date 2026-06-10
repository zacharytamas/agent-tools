# Hermes Slog Plugin

This package integrates the `slog` CLI tool with the Hermes agent. It registers tools that allow Hermes to log, list, find, and correct structured entries.

## Installation

Install the plugin in editable mode from the repository root:

```bash
pip install -e packages/hermes-slog-plugin/
```

## Runtime Dependencies

This plugin relies on the `slog` binary. It does not install or reimplement `slog`. You must install `slog` separately and ensure it is available on your `PATH`.

If the `slog` binary is missing or cannot be executed, the plugin reports a structured failure with the error code `slog_not_found`.

### Configuration

You can optionally set the `SLOG_HOME` environment variable to isolate the slog state directory. If you don't set it, `slog` defaults to its standard location.

## Plugin Discovery

Hermes automatically discovers this plugin using Python entry points. The package defines this entry point in `pyproject.toml`:

```toml
[project.entry-points."hermes_agent.plugins"]
hermes-slog = "hermes_slog_plugin"
```

Hermes loads the `hermes_slog_plugin` module and calls its `register(ctx)` function.

## Unsupported Scope

This plugin has a strictly defined scope. The following features are unsupported:

* No MCP bridge support.
* No Python-native slog storage or domain port implementation.
* No daemon, background sync, or indexing services.
* No custom UI, chat commands, or interactive prompts.
* No extra tools beyond the four registered tools.

## Registered Tools

The plugin registers exactly four tools:

1. `slog_log` - Create a new structured log entry.
2. `slog_list` - List existing log entries.
3. `slog_find` - Retrieve a specific log entry by ID.
4. `slog_correct` - Update or correct an existing log entry.

## Smoke Test

You can verify entry-point discovery and tool registration with this command:

```bash
python -c "
import hermes_slog_plugin
class MockContext:
    def __init__(self):
        self.tools = []
    def register_tool(self, name, **_):
        self.tools.append(name)

ctx = MockContext()
hermes_slog_plugin.register(ctx)
print('Registered tools:', ctx.tools)
assert len(ctx.tools) == 4
assert set(ctx.tools) == {'slog_log', 'slog_list', 'slog_find', 'slog_correct'}
"
```
