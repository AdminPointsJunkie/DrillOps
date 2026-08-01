"""DAR schema, in-app notification fan-out, and retryable email delivery."""

import html
import json
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Callable, Iterable

import httpx


MIGRATION_PATH = Path(__file__).parent / "migrations" / "002_dar_notifications.sql"
WEB_URL = os.environ.get("DRILLOPS_WEB_URL", "https://www.drillops.com.au").rstrip("/")


def ensure_dar_schema(get_conn: Callable) -> None:
    """Apply the idempotent DAR migration during service startup."""
    migration = MIGRATION_PATH.read_text(encoding="utf-8")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(migration)


def email_delivery_provider() -> str:
    sender = os.environ.get("EMAIL_FROM", "").strip()
    if sender and os.environ.get("RESEND_API_KEY", "").strip():
        return "resend"
    if sender and os.environ.get("SMTP_HOST", "").strip():
        return "smtp"
    return "unconfigured"


def queue_notifications(
    cur,
    recipients: Iterable[dict],
    *,
    project_id: int,
    dar_id: str,
    event_type: str,
    event_version: int,
    title: str,
    body: str,
) -> int:
    """Create idempotent in-app notifications and matching email outbox rows."""
    action_url = f"{WEB_URL}/field.html?project={project_id}&dar={dar_id}"
    queued = 0
    seen = set()
    for recipient in recipients:
        user_id = str(recipient.get("user_id") or "")
        email = str(recipient.get("email") or "").strip().lower()
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        cur.execute(
            """
            INSERT INTO user_notifications
              (user_id, project_id, dar_id, event_type, event_version,
               title, body, action_url, data)
            SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
            WHERE COALESCE((
                SELECT in_app_enabled FROM notification_preferences WHERE user_id=%s
            ), TRUE)
            ON CONFLICT (user_id, dar_id, event_type, event_version)
            DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body,
                          action_url=EXCLUDED.action_url, data=EXCLUDED.data
            RETURNING id
            """,
            (
                user_id,
                project_id,
                dar_id,
                event_type,
                event_version,
                title,
                body,
                action_url,
                json.dumps({"dar_id": dar_id, "project_id": project_id}),
                user_id,
            ),
        )
        notification = cur.fetchone()
        if not notification or not email:
            continue
        cur.execute(
            """
            INSERT INTO email_outbox
              (notification_id, recipient, subject, html_body, text_body)
            SELECT %s, %s, %s, %s, %s
            WHERE COALESCE((
                SELECT email_enabled FROM notification_preferences WHERE user_id=%s
            ), TRUE)
            ON CONFLICT (notification_id) DO NOTHING
            """,
            (
                notification["id"],
                email,
                title,
                _email_html(title, body, action_url),
                f"{title}\n\n{body}\n\nOpen DrillOps: {action_url}",
                user_id,
            ),
        )
        queued += cur.rowcount
    return queued


def _email_html(title: str, body: str, action_url: str) -> str:
    return f"""<!doctype html>
<html><body style="margin:0;background:#f3f5f7;font-family:Arial,sans-serif;color:#162435">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dfe5ea">
    <div style="background:#0d2945;color:#fff;padding:22px 28px;font-size:22px;font-weight:700">Drill<span style="color:#f0641b">Ops</span></div>
    <div style="padding:28px">
      <h1 style="font-size:22px;margin:0 0 14px">{html.escape(title)}</h1>
      <p style="line-height:1.6;color:#4e5e6d">{html.escape(body)}</p>
      <a href="{html.escape(action_url, quote=True)}" style="display:inline-block;margin-top:12px;background:#e95f1d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open in DrillOps</a>
    </div>
  </div>
</body></html>"""


def deliver_pending_emails(get_conn: Callable, limit: int = 20) -> dict:
    """Deliver queued email using Resend or SMTP with bounded retries."""
    provider = email_delivery_provider()
    if provider == "unconfigured":
        return {"provider": provider, "sent": 0, "failed": 0}

    sent = 0
    failed = 0
    for _ in range(max(1, min(limit, 100))):
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE email_outbox
                    SET status='sending', attempts=attempts+1, last_error='',
                        next_attempt_at=NOW() + INTERVAL '10 minutes'
                    WHERE id=(
                        SELECT id FROM email_outbox
                        WHERE status IN ('pending', 'failed', 'sending')
                          AND attempts < 5 AND next_attempt_at <= NOW()
                        ORDER BY created_at
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                    )
                    RETURNING *
                    """
                )
                message = cur.fetchone()
        if not message:
            break

        try:
            provider_id = _send_email(provider, dict(message))
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE email_outbox
                        SET status='sent', sent_at=NOW(), provider_message_id=%s,
                            last_error=''
                        WHERE id=%s
                        """,
                        (provider_id, message["id"]),
                    )
            sent += 1
        except Exception as exc:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE email_outbox
                        SET status='failed', last_error=%s,
                            next_attempt_at=NOW() + (LEAST(60, attempts * attempts) || ' minutes')::interval
                        WHERE id=%s
                        """,
                        (str(exc)[:1000], message["id"]),
                    )
            failed += 1
    return {"provider": provider, "sent": sent, "failed": failed}


def _send_email(provider: str, message: dict) -> str:
    if provider == "resend":
        payload = {
            "from": os.environ["EMAIL_FROM"],
            "to": [message["recipient"]],
            "subject": message["subject"],
            "html": message["html_body"],
            "text": message["text_body"],
        }
        reply_to = os.environ.get("EMAIL_REPLY_TO", "").strip()
        if reply_to:
            payload["reply_to"] = reply_to
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
                "Content-Type": "application/json",
                "Idempotency-Key": f"drillops-{message['id']}",
            },
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        return str(response.json().get("id") or "")

    email = EmailMessage()
    email["From"] = os.environ["EMAIL_FROM"]
    email["To"] = message["recipient"]
    email["Subject"] = message["subject"]
    if os.environ.get("EMAIL_REPLY_TO", "").strip():
        email["Reply-To"] = os.environ["EMAIL_REPLY_TO"]
    email.set_content(message["text_body"])
    email.add_alternative(message["html_body"], subtype="html")
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    if os.environ.get("SMTP_USE_SSL", "false").lower() == "true":
        client = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        client = smtplib.SMTP(host, port, timeout=20)
        client.starttls()
    try:
        if username:
            client.login(username, password)
        client.send_message(email)
    finally:
        client.quit()
    return f"smtp:{message['id']}"
