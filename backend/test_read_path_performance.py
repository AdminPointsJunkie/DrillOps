import unittest
from pathlib import Path


MAIN_SOURCE = (Path(__file__).resolve().parent / "main.py").read_text(encoding="utf-8")
SECURITY_SOURCE = (Path(__file__).resolve().parent / "security.py").read_text(encoding="utf-8")


class ReadPathPerformanceTests(unittest.TestCase):
    def test_activity_bundle_uses_the_single_round_trip_read_connection(self):
        start = MAIN_SOURCE.index("def get_activity_report_data(")
        end = MAIN_SOURCE.index("\n\n@app.get(\"/mcc/weekly-audit\")", start)
        body = MAIN_SOURCE[start:end]

        self.assertIn("with get_conn(read_only=True) as conn:", body)
        self.assertIn("conn.autocommit = True", MAIN_SOURCE)
        self.assertIn("if _pool_connection_recently_used(conn):", MAIN_SOURCE)
        self.assertIn("GZipMiddleware, minimum_size=1000", MAIN_SOURCE)

    def test_system_admin_lookup_is_reused_during_a_page_load(self):
        self.assertIn("self._is_system_admin_cached", SECURITY_SOURCE)
        self.assertIn("SYSTEM_ADMIN_CACHE_TTL", SECURITY_SOURCE)
        self.assertIn("now - cached[0] < self.admin_cache_ttl", SECURITY_SOURCE)
        self.assertIn("with self.get_conn(read_only=True) as conn:", SECURITY_SOURCE)


if __name__ == "__main__":
    unittest.main()
