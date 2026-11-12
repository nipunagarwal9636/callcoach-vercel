import json
import os
import sys



def send(h, code, obj):
    body = json.dumps(obj, ensure_ascii=False, default=str).encode()
    h.send_response(code)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Cache-Control", "no-store")
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


def read_json(h):
    n = int(h.headers.get("Content-Length") or 0)
    return json.loads(h.rfile.read(n) or b"{}")
