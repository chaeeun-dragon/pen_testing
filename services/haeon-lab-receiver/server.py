"""Internal receiver with durable, idempotent receipts for synthetic records."""
import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get('RECEIVER_DATA_DIR', '/data'))
PORT = int(os.environ.get('RECEIVER_PORT', '8093'))
LOCK = threading.Lock()

def receipt(record):
    payload = record['payload']
    return dict(transferId=payload['transferId'], runId=payload['runId'],
                recordCount=len(payload['records']), sha256=record['sha256'],
                receivedAt=record['receivedAt'], status='RECEIVED')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/health':
            return self.send_json(200, {'status':'UP'})
        match = re.fullmatch(r'/v1/receipts/([A-Za-z0-9-]{1,80})', self.path)
        if match:
            try:
                with LOCK:
                    record = json.loads((DATA / (match[1] + '.json')).read_text())
                return self.send_json(200, receipt(record))
            except FileNotFoundError:
                pass
        self.send_json(404, {'errorCode':'NOT_FOUND'})

    def do_POST(self):
        if self.path != '/v1/ingest':
            return self.send_json(404, {'errorCode':'NOT_FOUND'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 262144:
                raise ValueError()
            raw = self.rfile.read(length)
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not isinstance(payload.get('records'), list):
                raise ValueError()
            for key in ('transferId', 'runId'):
                if not isinstance(payload.get(key), str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', payload[key]):
                    raise ValueError()
            digest = hashlib.sha256(raw).hexdigest()
            with LOCK:
                DATA.mkdir(parents=True, exist_ok=True)
                path = DATA / (payload['transferId'] + '.json')
                if path.exists():
                    record = json.loads(path.read_text())
                    if record['sha256'] != digest or record['payload']['runId'] != payload['runId']:
                        return self.send_json(409, {'errorCode':'TRANSFER_ID_CONFLICT'})
                else:
                    record = dict(receivedAt=datetime.now(timezone.utc).isoformat(), sha256=digest, payload=payload)
                    temporary = path.with_suffix('.tmp')
                    with temporary.open('w', encoding='utf-8') as handle:
                        json.dump(record, handle, ensure_ascii=False)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(temporary, path)
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'errorCode':'INVALID_RECEIVER_PAYLOAD'})
        except OSError:
            return self.send_json(500, {'errorCode':'RECEIPT_WRITE_FAILED'})
        self.send_json(200, receipt(record))

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            # The caller has already disconnected. The receipt itself was either
            # durably written or the handler returned the persistence error above.
            return

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
