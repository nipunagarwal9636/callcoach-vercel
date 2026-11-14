import os
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import buddy  # noqa: E402
from qa.web import read_json, send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    """POST {persona, turns: [{n, s, t}], use_llm, reply: bool, docs?} -> customer reply + live coaching."""

    def do_GET(self):
        send(self, 200, {"personas": {k: dict(name=v["name"], tag=v["tag"], plan=v["plan"], lang=v["lang"]) for k, v in buddy.PERSONAS.items()}})

    def do_POST(self):
        try:
            t0 = time.time()
            b = read_json(self)
            turns = [dict(n=i + 1, s=t.get("s", "AGENT"), t=str(t.get("t", ""))[:800]) for i, t in enumerate(b.get("turns", []))]
            pid = b.get("persona", "ramesh")
            docs = [d for d in (b.get("docs") or []) if d.get("text")] or None
            out = {}
            full = turns
            if b.get("reply", True):
                r, src = buddy.customer_reply(turns, pid, bool(b.get("use_llm")))
                out.update(reply=r, reply_source=src)
                full = turns + [dict(n=len(turns) + 1, s="CUSTOMER", t=r)]
            out["coach"] = buddy.coach(full, pid, docs, b.get("plan"))
            out["ms"] = round((time.time() - t0) * 1000)
            send(self, 200, out)
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
