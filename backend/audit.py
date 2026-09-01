"""Helpers for concise import and administrative audit events."""

import json
import uuid
from typing import Optional

from request_context import current_request_audit_context


def _request_id(value: str):
    try:
        return uuid.UUID(str(value)) if value else None
    except (TypeError, ValueError):
        return None


def record_audit_event(
    cur,
    *,
    action: str,
    entity_type: str,
    entity_key: str,
    details: Optional[dict] = None,
    project_id: Optional[int] = None,
    actor_user_id: Optional[str] = None,
):
    context = current_request_audit_context()
    cur.execute(
        """
        INSERT INTO audit_events
          (actor_user_id, project_id, action, entity_type, entity_key, details,
           request_id, request_method, request_path)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        """,
        (
            actor_user_id or context.user_id or None,
            project_id,
            action,
            entity_type,
            str(entity_key),
            json.dumps(details or {}),
            _request_id(context.request_id),
            context.method or None,
            context.path or None,
        ),
    )


def record_import_batch(
    cur,
    *,
    filename: str,
    import_kind: str,
    contractor: str = "",
    client: str = "",
    project: str = "",
    status: str = "imported",
    row_counts: Optional[dict] = None,
    details: Optional[dict] = None,
):
    context = current_request_audit_context()
    request_id = _request_id(context.request_id)
    cur.execute(
        """
        INSERT INTO import_batches
          (actor_user_id, filename, import_kind, contractor, client, project,
           status, row_counts, details, request_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
        RETURNING id
        """,
        (
            context.user_id or None,
            str(filename or ""),
            import_kind,
            str(contractor or ""),
            str(client or ""),
            str(project or ""),
            status,
            json.dumps(row_counts or {}),
            json.dumps(details or {}),
            request_id,
        ),
    )
    batch_id = cur.fetchone()["id"]
    record_audit_event(
        cur,
        action=f"import.{status}",
        entity_type="import_batch",
        entity_key=str(batch_id),
        details={
            "filename": filename,
            "import_kind": import_kind,
            "contractor": contractor,
            "client": client,
            "project": project,
            "row_counts": row_counts or {},
            **(details or {}),
        },
    )
    return batch_id
