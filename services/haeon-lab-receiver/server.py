import hashlib
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA_DIR = os.environ.get("RECEIVER_DATA_DIR", "/data")
PORT = int(os.environ.get("RECEIVER_PORT", "8093"))

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "UP", "simulation": True})
        else:
            self.send_json(404, {"errorCode": "NOT_FOUND"})

    def do_POST(self):
        if self.path != "/v1/ingest":
            self.send_json(404, {"errorCode": "NOT_FOUND"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            payload = json.loads(body)
            transfer_id = str(payload.get("transferId", ""))
            if not transfer_id or not isinstance(payload.get("records"), list):
                self.send_json(400, {"errorCode": "INVALID_RECEIVER_PAYLOAD"})
                return
            digest = hashlib.sha256(body).hexdigest()
            os.makedirs(DATA_DIR, exist_ok=True)
            path = os.path.join(DATA_DIR, transfer_id + ".json")
            if not os.path.exists(path):
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump({"receivedAt": datetime.now(timezone.utc).isoformat(), "sha256": digest, "payload": payload}, handle, ensure_ascii=False)
            self.send_json(200, {"transferId": transfer_id, "recordCount": len(payload["records"]), "sha256": digest, "status": "RECEIVED", "simulation": True})
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"errorCode": "INVALID_RECEIVER_PAYLOAD"})

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
