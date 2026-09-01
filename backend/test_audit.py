import unittest

from audit import record_audit_event, record_import_batch
from request_context import RequestAuditContext, request_audit_context


class FakeCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((" ".join(sql.split()), params))

    def fetchone(self):
        return {"id": 42}


class AuditHelpersTests(unittest.TestCase):
    def setUp(self):
        self.context_token = request_audit_context.set(
            RequestAuditContext(
                user_id="11111111-1111-1111-1111-111111111111",
                request_id="22222222-2222-2222-2222-222222222222",
                method="POST",
                path="/import",
            )
        )

    def tearDown(self):
        request_audit_context.reset(self.context_token)

    def test_records_verified_request_metadata(self):
        cursor = FakeCursor()
        record_audit_event(
            cursor,
            action="activities.update",
            entity_type="activities",
            entity_key="7",
            details={"changes": {"notes": {"from": "a", "to": "b"}}},
        )

        self.assertEqual(len(cursor.calls), 1)
        params = cursor.calls[0][1]
        self.assertEqual(params[0], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(str(params[6]), "22222222-2222-2222-2222-222222222222")
        self.assertEqual(params[7:], ("POST", "/import"))

    def test_import_batch_also_writes_summary_event(self):
        cursor = FakeCursor()
        batch_id = record_import_batch(
            cursor,
            filename="shift.pdf",
            import_kind="eos",
            contractor="Allianz Drilling",
            project="Ironbark",
            row_counts={"activities": 12, "crew": 3},
        )

        self.assertEqual(batch_id, 42)
        self.assertEqual(len(cursor.calls), 2)
        self.assertIn("INSERT INTO import_batches", cursor.calls[0][0])
        self.assertEqual(cursor.calls[0][1][1:3], ("shift.pdf", "eos"))
        self.assertEqual(cursor.calls[1][1][2], "import.imported")


if __name__ == "__main__":
    unittest.main()
