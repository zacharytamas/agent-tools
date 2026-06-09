from pathlib import Path
import sys


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
