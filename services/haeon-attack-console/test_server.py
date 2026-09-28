"""Focused tests for the filming-state reset; never call the live lab service."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("haeon_attack_console_server", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class ResetDemoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_data, self.old_state_file, self.old_state = server.DATA, server.STATE_FILE, server.STATE
        server.DATA = Path(self.temp.name)
        server.STATE_FILE = server.DATA / "console-state.json"
        server.STATE = {"runs": [{"runId": "HAEON-DEMO-1", "status": "ALERT"}],
                        "pendingResponseRunId": "HAEON-DEMO-1"}

    def tearDown(self):
        server.DATA, server.STATE_FILE, server.STATE = self.old_data, self.old_state_file, self.old_state
        self.temp.cleanup()

    def test_confirmation_required_without_upstream_call(self):
        with patch.object(server, "call") as upstream:
            status, _ = server.reset_demo("wrong")
        self.assertEqual(status, 400)
        upstream.assert_not_called()
        self.assertEqual(len(server.STATE["runs"]), 1)

    def test_running_run_is_not_reset(self):
        server.STATE["runs"][0]["status"] = "RUNNING"
        with patch.object(server, "call") as upstream:
            status, _ = server.reset_demo("RESET_HAEON_DEMO")
        self.assertEqual(status, 409)
        upstream.assert_not_called()

    def test_upstream_failure_keeps_console_history(self):
        with patch.object(server, "call", return_value=(502, {"errorCode": "UPSTREAM_UNAVAILABLE"})):
            status, _ = server.reset_demo("RESET_HAEON_DEMO")
        self.assertEqual(status, 502)
        self.assertEqual(len(server.STATE["runs"]), 1)
        self.assertEqual(server.STATE["pendingResponseRunId"], "HAEON-DEMO-1")

    def test_success_clears_console_history_and_pending_response(self):
        result = {"result": "RESET", "runsDeleted": 1, "protectionNoticesDeleted": 1}
        with patch.object(server, "call", return_value=(200, result)) as upstream:
            status, body = server.reset_demo("RESET_HAEON_DEMO")
        upstream.assert_called_once_with("POST", "/control/v1/reset", control=True)
        self.assertEqual(status, 200)
        self.assertEqual(body["consoleRunsDeleted"], 1)
        self.assertEqual(server.STATE, {"runs": [], "pendingResponseRunId": None})
        self.assertEqual(json.loads(server.STATE_FILE.read_text(encoding="utf-8")), server.STATE)

    def test_active_action_blocks_reset(self):
        server.ACTION_LOCK.acquire()
        try:
            with patch.object(server, "call") as upstream:
                status, _ = server.reset_demo("RESET_HAEON_DEMO")
            self.assertEqual(status, 409)
            upstream.assert_not_called()
        finally:
            server.ACTION_LOCK.release()


if __name__ == "__main__":
    unittest.main()
