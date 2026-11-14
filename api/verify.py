import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import policy  # noqa: E402
from qa.transcript import parse_text  # noqa: E402
from qa.web import read_json, send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    """POST {transcript, docs?: [{id, name, text}], doc_id?, use_llm?} -> policy-grounded findings with clause citations."""

    def do_POST(self):
        try:
            b = read_json(self)
            call = parse_text(b.get("transcript", ""))
            if not call.turns:
                return send(self, 400, {"error": "No turns found. Start each line with AGENT: or CUSTOMER:"})
            docs = [d for d in (b.get("docs") or []) if d.get("text")] or policy.seed_docs()
            turns = [dict(n=t.no, s=t.speaker, t=t.text) for t in call.turns]
            out = policy.verify(turns, docs, b.get("doc_id"), bool(b.get("use_llm")))
            out["turns"] = turns
            send(self, 200, out)
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
