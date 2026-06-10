from pathlib import Path
import sys
import types


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hermes_slog_plugin.provenance import resolve_provenance


def session_env(values):
    return lambda name, default="": values.get(name, default)


def test_profile_identity_becomes_hermes_actor_without_warnings():
    provenance = resolve_provenance(
        profile_identity="researcher",
        user_task="Summarize the trial results",
        task_id="task-123",
        get_session_env=session_env({}),
    )

    assert provenance.actor == "hermes:researcher"
    assert provenance.authority_mode == "delegated"
    assert provenance.authority_source == "hermes-task:task-123"
    assert provenance.metadata["user_task"] == "Summarize the trial results"
    assert provenance.warnings == []


def test_soul_identity_becomes_actor_when_profile_identity_is_missing():
    provenance = resolve_provenance(
        soul_identity="researcher",
        user_task="Review the methodology",
        task_id="task-456",
        get_session_env=session_env({}),
    )

    assert provenance.actor == "hermes:researcher"
    assert provenance.warnings == []


def test_fallback_actor_has_warning_and_is_not_hightower_by_default():
    provenance = resolve_provenance(
        user_task="Capture a field note",
        task_id="task-789",
        get_session_env=session_env({}),
    )

    assert provenance.actor.startswith("hermes:")
    assert provenance.actor != "hermes:hightower"
    assert provenance.actor == "hermes:unknown"
    assert {warning["code"] for warning in provenance.warnings} == {"actor_unresolved"}


def test_missing_user_task_is_discretionary_with_conservative_warning():
    provenance = resolve_provenance(
        profile_identity="researcher",
        task_id="task-no-user-task",
        get_session_env=session_env(
            {
                "HERMES_SESSION_USER_ID": "user-42",
                "HERMES_SESSION_USER_NAME": "Ada Lovelace",
            }
        ),
    )

    assert provenance.actor == "hermes:researcher"
    assert provenance.authority_mode == "discretionary"
    assert provenance.authority_source == "hermes:researcher"
    assert "user_task" not in provenance.metadata
    assert {warning["code"] for warning in provenance.warnings} == {"user_task_missing"}


def test_session_env_user_fields_are_preserved_as_delegated_source():
    provenance = resolve_provenance(
        profile_identity="researcher",
        user_task="Log the human instruction",
        task_id="task-session",
        get_session_env=session_env(
            {
                "HERMES_SESSION_USER_ID": "user-42",
                "HERMES_SESSION_USER_NAME": "Ada Lovelace",
            }
        ),
    )

    assert provenance.authority_mode == "delegated"
    assert provenance.authority_source == "hermes-session-user:user-42:Ada Lovelace"
    assert provenance.metadata["session_user_id"] == "user-42"
    assert provenance.metadata["session_user_name"] == "Ada Lovelace"
    assert provenance.metadata["user_task"] == "Log the human instruction"
    assert provenance.warnings == []


def test_literal_hightower_identity_is_preserved_without_being_default():
    provenance = resolve_provenance(
        profile_identity="hightower",
        user_task="Record a direct Hightower action",
        task_id="task-hightower",
        get_session_env=session_env({}),
    )

    assert provenance.actor == "hermes:hightower"
    assert provenance.warnings == []


def test_default_session_env_reader_uses_gateway_session_context(monkeypatch):
    gateway_module = types.ModuleType("gateway")
    session_context_module = types.ModuleType("gateway.session_context")

    def fake_get_session_env(name, default=""):
        values = {
            "HERMES_SESSION_USER_ID": "user-99",
            "HERMES_SESSION_USER_NAME": "Grace Hopper",
        }
        return values.get(name, default)

    setattr(session_context_module, "get_session_env", fake_get_session_env)
    monkeypatch.setitem(sys.modules, "gateway", gateway_module)
    monkeypatch.setitem(sys.modules, "gateway.session_context", session_context_module)

    provenance = resolve_provenance(
        profile_identity="researcher",
        user_task="Use active gateway context",
        task_id="task-gateway",
    )

    assert provenance.authority_source == "hermes-session-user:user-99:Grace Hopper"
    assert provenance.metadata["session_user_id"] == "user-99"
    assert provenance.metadata["session_user_name"] == "Grace Hopper"
    assert provenance.warnings == []


def test_session_env_reader_failure_falls_back_without_crashing():
    def broken_session_env(name, _default=""):
        raise RuntimeError(f"context exploded while reading {name}")

    provenance = resolve_provenance(
        soul_identity="field-agent",
        user_task="Continue without live gateway context",
        task_id="task-broken-env",
        get_session_env=broken_session_env,
    )

    assert provenance.actor == "hermes:field-agent"
    assert provenance.authority_mode == "delegated"
    assert provenance.authority_source == "hermes-task:task-broken-env"
    assert provenance.metadata["user_task"] == "Continue without live gateway context"
    assert provenance.metadata["task_id"] == "task-broken-env"
    assert {warning["code"] for warning in provenance.warnings} == {
        "session_env_unavailable"
    }

