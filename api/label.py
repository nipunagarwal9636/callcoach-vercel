import os
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import buddy  # noqa: E402
from qa.web import read_json, send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    """POST {text, context: [{s, t}], use_llm} -> {speaker: AGENT|CUSTOMER, source}. For live calls on one microphone."""

    def do_POST(self):
        try:
            t0 = time.time()
            b = read_json(self)
            ctx = [dict(s=c.get("s", "AGENT"), t=str(c.get("t", ""))[:400]) for c in (b.get("context") or [])][-8:]
            sp, src = buddy.label_segment(str(b.get("text", ""))[:600], ctx, bool(b.get("use_llm", True)))
            send(self, 200, {"speaker": sp, "source": src, "ms": round((time.time() - t0) * 1000)})
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
