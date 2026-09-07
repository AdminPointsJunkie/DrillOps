import ast
import asyncio
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "docs" / "index.html"
MAIN_PY = ROOT / "backend" / "main.py"


class _DummyApp:
    def post(self, _path):
        return lambda function: function


class _HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _DatabaseError(Exception):
    pass


class _OperationalError(_DatabaseError):
    pass


class _InterfaceError(_DatabaseError):
    pass


class _Psycopg2:
    Error = _DatabaseError
    OperationalError = _OperationalError
    InterfaceError = _InterfaceError


class _Upload:
    filename = "5623-260824D.csv"

    async def read(self):
        return b"Details\nid,plod,date\n1,5623-260824D,2026-08-24\n"


def _load_import_endpoint(namespace):
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    node = next(
        item
        for item in tree.body
        if isinstance(item, ast.AsyncFunctionDef) and item.name == "import_pdf"
    )
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(MAIN_PY), "exec"), namespace)
    return namespace["import_pdf"]


class ReportImportResilienceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = INDEX_HTML.read_text(encoding="utf-8")

    def test_portal_retries_transient_upload_failures(self):
        self.assertIn("async function postOperationalReport(url,formData,retries=2)", self.html)
        self.assertIn("signal:AbortSignal.timeout(60000)", self.html)
        self.assertIn("await postOperationalReport(`${API}/import`,fd)", self.html)
        self.assertIn("const apiReady=await apiFetch(API+'/'", self.html)

    def test_failed_files_remain_available_for_retry(self):
        self.assertIn("const failedFiles=[]", self.html)
        self.assertIn("pendingFiles=failedFiles", self.html)
        self.assertIn("Retry ${failedFiles.length} failed report(s)", self.html)
        self.assertIn("if(!failedFiles.length)fileInput.value=''", self.html)

    def test_coreplan_database_failure_is_returned_as_http_error(self):
        parser_calls = []

        def parse_coreplan(content, filename, contractor):
            parser_calls.append((content, filename, contractor))
            return {}, [], [], [], content.decode("utf-8")

        class FailingConnection:
            def __enter__(self):
                raise _OperationalError("database unavailable")

            def __exit__(self, *_args):
                return False

        namespace = {
            "app": _DummyApp(),
            "UploadFile": object,
            "File": lambda *_args, **_kwargs: None,
            "Form": lambda default="": default,
            "HTTPException": _HTTPException,
            "psycopg2": _Psycopg2,
            "looks_like_site_log_csv": lambda *_args: False,
            "parse_coreplan_plod_csv": parse_coreplan,
            "get_conn": lambda: FailingConnection(),
        }
        endpoint = _load_import_endpoint(namespace)

        with redirect_stdout(io.StringIO()), self.assertRaises(_HTTPException) as raised:
            asyncio.run(endpoint(_Upload(), client="Argo NR", project="Ironbark"))

        self.assertEqual(raised.exception.status_code, 503)
        self.assertIn("parsed successfully", raised.exception.detail)
        self.assertEqual(len(parser_calls), 1)


if __name__ == "__main__":
    unittest.main()
