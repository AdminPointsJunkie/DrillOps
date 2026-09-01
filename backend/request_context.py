"""Per-request actor metadata shared by authentication and database auditing."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestAuditContext:
    user_id: str = ""
    request_id: str = ""
    method: str = ""
    path: str = ""


request_audit_context: ContextVar[RequestAuditContext] = ContextVar(
    "drillops_request_audit_context",
    default=RequestAuditContext(),
)


def current_request_audit_context() -> RequestAuditContext:
    """Return immutable actor/request metadata for database audit triggers."""
    return request_audit_context.get()
