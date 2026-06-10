from __future__ import annotations

from hermes_slog_plugin.read_tools import slog_find, slog_list


class FakeReadAdapter:
    def __init__(
        self, *, find_result=None, list_result=None, find_error=None, list_error=None
    ):
        self.find_result = find_result
        self.list_result = list_result
        self.find_error = find_error
        self.list_error = list_error
        self.calls: list[tuple[str, object]] = []

    def find(self, entry_id: str):
        self.calls.append(("find", entry_id))
        if self.find_error is not None:
            raise self.find_error
        return self.find_result

    def list(self):
        self.calls.append(("list", None))
        if self.list_error is not None:
            raise self.list_error
        return self.list_result


def test_slog_find_rejects_missing_id_with_structured_validation_error():
    result = slog_find({})

    assert result == {
        "ok": False,
        "code": "validation_failed",
        "message": "id is required.",
        "metadata": {"field": "id"},
    }


def test_slog_find_returns_structured_success_for_existing_id():
    adapter = FakeReadAdapter(find_result={"entry": {"id": "01ABC", "text": "hello"}})

    result = slog_find({"id": "01ABC"}, adapter=adapter)

    assert adapter.calls == [("find", "01ABC")]
    assert result == {
        "ok": True,
        "code": "ok",
        "message": "slog entry found.",
        "metadata": {"entry": {"entry": {"id": "01ABC", "text": "hello"}}},
    }


def test_slog_find_returns_structured_error_for_adapter_failure():
    from hermes_slog_plugin.cli_adapter import SlogCliError

    adapter = FakeReadAdapter(
        find_error=SlogCliError(
            code="slog_not_found",
            message="slog entry not found",
            argv=["slog", "entry", "show", "--json", "01ABC"],
            stdout="",
            stderr="missing",
            returncode=1,
        )
    )

    result = slog_find({"id": "01ABC"}, adapter=adapter)

    assert adapter.calls == [("find", "01ABC")]
    assert result == {
        "ok": False,
        "code": "slog_not_found",
        "message": "slog entry not found",
        "metadata": {
            "argv": ["slog", "entry", "show", "--json", "01ABC"],
            "stdout": "",
            "stderr": "missing",
            "returncode": 1,
        },
    }


def test_slog_list_returns_structured_success_without_filters():
    adapter = FakeReadAdapter(
        list_result={"entries": [{"id": "01ABC"}], "warnings": []}
    )

    result = slog_list({}, adapter=adapter)

    assert adapter.calls == [("list", None)]
    assert result == {
        "ok": True,
        "code": "ok",
        "message": "slog entries listed.",
        "metadata": {"entries": {"entries": [{"id": "01ABC"}], "warnings": []}},
    }


def test_slog_list_rejects_filters_before_shelling_out():
    adapter = FakeReadAdapter(list_result={"entries": []})

    result = slog_list({"text_query": "hello"}, adapter=adapter)

    assert adapter.calls == []
    assert result == {
        "ok": False,
        "code": "unsupported_filter",
        "message": "slog_list only supports listing without filters.",
        "metadata": {"filters": ["text_query"]},
    }
