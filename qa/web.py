import json
import os
import sys



def send(h, code, obj):
    body = json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":")).encode()
    h.send_response(code)
    if len(body) > 20000 and "gzip" in (h.headers.get("Accept-Encoding") or ""):
        import gzip
        body = gzip.compress(body, 6)
        h.send_header("Content-Encoding", "gzip")
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Cache-Control", "no-store")
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


def read_json(h):
    n = int(h.headers.get("Content-Length") or 0)
    return json.loads(h.rfile.read(n) or b"{}")


def need_user(h, roles=None):
    """Return the signed-in user or send 401/403 and return None."""
    from .auth import from_header
    u = from_header(h)
    if not u:
        send(h, 401, {"error": "Sign in again: your session has expired."})
        return None
    if roles and u["role"] not in roles:
        send(h, 403, {"error": "Your account can't see this."})
        return None
    return u
