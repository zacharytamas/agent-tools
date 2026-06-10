from collections.abc import Callable
from dataclasses import dataclass, field
from importlib import import_module


SessionEnvGetter = Callable[[str, str], str]


@dataclass(frozen=True)
class Provenance:
    actor: str
    authority_mode: str
    authority_source: str
    warnings: list[dict[str, str]] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)


def resolve_provenance(
    *,
    profile_identity: str | None = None,
    soul_identity: str | None = None,
    user_task: str | None = None,
    task_id: str | None = None,
    get_session_env: SessionEnvGetter | None = None,
) -> Provenance:
    identity = _normalize(profile_identity) or _normalize(soul_identity)
    warnings: list[dict[str, str]] = []

    if identity is None:
        actor = "hermes:unknown"
        warnings.append(
            {
                "code": "actor_unresolved",
                "message": "Hermes profile/SOUL identity was not resolved; using safe fallback actor.",
            }
        )
    else:
        actor = f"hermes:{identity}"

    normalized_user_task = _normalize(user_task)
    metadata = _metadata_for_task(normalized_user_task, task_id)

    session_env = get_session_env or _get_session_env
    user_id = _session_env_value(
        session_env, "HERMES_SESSION_USER_ID", warnings
    )
    user_name = _session_env_value(
        session_env, "HERMES_SESSION_USER_NAME", warnings
    )
    if user_id is not None:
        metadata["session_user_id"] = user_id
    if user_name is not None:
        metadata["session_user_name"] = user_name

    if normalized_user_task is None:
        warnings.append(
            {
                "code": "user_task_missing",
                "message": "Missing user_task; treating provenance as discretionary actor authority.",
            }
        )
        return Provenance(
            actor=actor,
            authority_mode="discretionary",
            authority_source=actor,
            warnings=warnings,
            metadata=metadata,
        )

    authority_source = _authority_source(user_id, user_name, task_id)
    return Provenance(
        actor=actor,
        authority_mode="delegated",
        authority_source=authority_source,
        warnings=warnings,
        metadata=metadata,
    )


def _session_env_value(
    get_session_env: SessionEnvGetter,
    name: str,
    warnings: list[dict[str, str]],
) -> str | None:
    try:
        return _normalize(get_session_env(name, ""))
    except Exception:
        if not any(
            warning["code"] == "session_env_unavailable" for warning in warnings
        ):
            warnings.append(
                {
                    "code": "session_env_unavailable",
                    "message": "Hermes session context was not readable; continuing without session user fields.",
                }
            )
        return None


def _metadata_for_task(user_task: str | None, task_id: str | None) -> dict[str, str]:
    metadata: dict[str, str] = {}
    if user_task is not None:
        metadata["user_task"] = user_task
    normalized_task_id = _normalize(task_id)
    if normalized_task_id is not None:
        metadata["task_id"] = normalized_task_id
    return metadata


def _authority_source(
    user_id: str | None, user_name: str | None, task_id: str | None
) -> str:
    if user_id is not None and user_name is not None:
        return f"hermes-session-user:{user_id}:{user_name}"
    if user_id is not None:
        return f"hermes-session-user:{user_id}"
    if user_name is not None:
        return f"hermes-session-user:{user_name}"
    normalized_task_id = _normalize(task_id)
    if normalized_task_id is not None:
        return f"hermes-task:{normalized_task_id}"
    return "hermes-task:unknown"


def _get_session_env(name: str, default: str = "") -> str:
    try:
        get_session_env = import_module("gateway.session_context").get_session_env
    except (ModuleNotFoundError, ImportError, AttributeError):
        return default
    return get_session_env(name, default)


def _normalize(value: str | None) -> str | None:
    normalized = value.strip() if value is not None else ""
    return normalized or None
