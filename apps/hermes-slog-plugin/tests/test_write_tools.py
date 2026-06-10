from __future__ import annotations

from hermes_slog_plugin.cli_adapter import SlogCliError
from hermes_slog_plugin.write_tools import slog_correct, slog_log


class FakeWriteAdapter:
    def __init__(
        self,
        *,
        create_result=None,
        update_result=None,
        create_error=None,
        update_error=None,
    ):
        self.create_result = create_result
        self.update_result = update_result
        self.create_error = create_error
        self.update_error = update_error
        self.calls: list[tuple[str, object]] = []

    def create(self, payload):
        self.calls.append(("create", payload))
        if self.create_error is not None:
            raise self.create_error
        return self.create_result

    def update(self, payload):
        self.calls.append(("update", payload))
        if self.update_error is not None:
            raise self.update_error
        return self.update_result


def session_env(values):
    return lambda name, default="": values.get(name, default)


def test_slog_log_rejects_blank_text_before_shelling_out():
    adapter = FakeWriteAdapter(create_result={"entry": {"id": "01"}, "warnings": []})

    result = slog_log({"text": "   "}, adapter=adapter)

    assert adapter.calls == []
    assert result == {
        "ok": False,
        "code": "validation_failed",
        "message": "text must be a non-empty string.",
        "metadata": {"field": "text"},
    }


def test_slog_log_creates_entry_with_resolved_provenance_payload():
    adapter = FakeWriteAdapter(
        create_result={
            "entry": {
                "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "text": "capture this",
                "actor": "hermes:researcher",
                "authority": {
                    "mode": "delegated",
                    "source": "hermes-session-user:user-42:Ada Lovelace",
                },
                "needs_triage": False,
            },
            "warnings": [{"code": "adapter_note", "message": "stored with note"}],
        }
    )

    result = slog_log(
        {"text": "capture this", "occurred_at": "2026-06-09T12:00:00Z"},
        adapter=adapter,
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

    assert adapter.calls == [
        (
            "create",
            {
                "text": "capture this",
                "occurred_at": "2026-06-09T12:00:00Z",
                "actor": "hermes:researcher",
                "authority": {
                    "mode": "delegated",
                    "source": "hermes-session-user:user-42:Ada Lovelace",
                },
                "metadata": {
                    "user_task": "Log the human instruction",
                    "task_id": "task-session",
                    "session_user_id": "user-42",
                    "session_user_name": "Ada Lovelace",
                },
            },
        )
    ]
    assert result == {
        "ok": True,
        "code": "ok",
        "message": "slog entry created.",
        "metadata": {
            "entry": {
                "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "text": "capture this",
                "actor": "hermes:researcher",
                "authority": {
                    "mode": "delegated",
                    "source": "hermes-session-user:user-42:Ada Lovelace",
                },
                "needs_triage": False,
            },
            "warnings": [{"code": "adapter_note", "message": "stored with note"}],
        },
    }


def test_slog_log_includes_provenance_warnings_on_success():
    adapter = FakeWriteAdapter(
        create_result={"entry": {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"}, "warnings": []}
    )

    result = slog_log(
        {"text": "discretionary note"},
        adapter=adapter,
        soul_identity="field-agent",
        task_id="task-no-user-task",
        get_session_env=session_env({}),
    )

    assert adapter.calls == [
        (
            "create",
            {
                "text": "discretionary note",
                "actor": "hermes:field-agent",
                "authority": {
                    "mode": "discretionary",
                    "source": "hermes:field-agent",
                },
                "metadata": {"task_id": "task-no-user-task"},
            },
        )
    ]
    assert result["ok"] is True
    assert result["metadata"]["warnings"] == [
        {
            "code": "user_task_missing",
            "message": "Missing user_task; treating provenance as discretionary actor authority.",
        }
    ]


def test_slog_log_returns_structured_error_for_adapter_failure():
    adapter = FakeWriteAdapter(
        create_error=SlogCliError(
            code="slog_failed",
            message="slog command exited with status 1",
            argv=["slog", "entry", "create", "--json", "-"],
            stdout="",
            stderr="locked",
            returncode=1,
        )
    )

    result = slog_log(
        {"text": "capture this"},
        adapter=adapter,
        profile_identity="researcher",
        user_task="Capture this",
        get_session_env=session_env({}),
    )

    assert result == {
        "ok": False,
        "code": "slog_failed",
        "message": "slog command exited with status 1",
        "metadata": {
            "argv": ["slog", "entry", "create", "--json", "-"],
            "stdout": "",
            "stderr": "locked",
            "returncode": 1,
        },
    }


def test_slog_correct_rejects_missing_changes_before_shelling_out():
    adapter = FakeWriteAdapter(update_result={"entry": {"id": "01"}, "warnings": []})

    result = slog_correct(
        {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "changes": {}}, adapter=adapter
    )

    assert adapter.calls == []
    assert result == {
        "ok": False,
        "code": "validation_failed",
        "message": "changes must include at least one field.",
        "metadata": {"field": "changes"},
    }


def test_slog_correct_updates_entry_with_changes_and_provenance_payload():
    adapter = FakeWriteAdapter(
        update_result={
            "entry": {
                "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "text": "updated",
                "needs_triage": True,
            },
            "warnings": [{"code": "adapter_warning", "message": "needs review"}],
        }
    )

    result = slog_correct(
        {
            "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "changes": {"text": "updated", "needs_triage": True},
        },
        adapter=adapter,
        profile_identity="researcher",
        user_task="Correct the entry",
        task_id="task-correct",
        get_session_env=session_env({}),
    )

    assert adapter.calls == [
        (
            "update",
            {
                "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "changes": {"text": "updated", "needs_triage": True},
                "actor": "hermes:researcher",
                "authority": {
                    "mode": "delegated",
                    "source": "hermes-task:task-correct",
                },
                "metadata": {
                    "user_task": "Correct the entry",
                    "task_id": "task-correct",
                },
            },
        )
    ]
    assert result == {
        "ok": True,
        "code": "ok",
        "message": "slog entry updated.",
        "metadata": {
            "entry": {
                "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "text": "updated",
                "needs_triage": True,
            },
            "warnings": [{"code": "adapter_warning", "message": "needs review"}],
        },
    }


def test_slog_correct_returns_structured_error_for_adapter_failure():
    adapter = FakeWriteAdapter(
        update_error=SlogCliError(
            code="slog_bad_json",
            message="slog command returned malformed JSON",
            argv=["slog", "entry", "update", "--json", "-"],
            stdout="not-json",
            stderr="",
            returncode=0,
        )
    )

    result = slog_correct(
        {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "changes": {"text": "updated"}},
        adapter=adapter,
        profile_identity="researcher",
        user_task="Correct the entry",
        get_session_env=session_env({}),
    )

    assert result == {
        "ok": False,
        "code": "slog_bad_json",
        "message": "slog command returned malformed JSON",
        "metadata": {
            "argv": ["slog", "entry", "update", "--json", "-"],
            "stdout": "not-json",
            "stderr": "",
            "returncode": 0,
        },
    }
