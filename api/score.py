from http.server import BaseHTTPRequestHandler

from _util import read_json, send  # noqa: F401  (sets sys.path)
from qa.engine import score_call
from qa.privacy import mask_call
from qa.transcript import parse_text


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            call = parse_text(body.get("transcript", ""))
            if not call.turns:
                return send(self, 400, {"error": "No turns found. Start each line with AGENT: or CUSTOMER:"})
            res = score_call(call, use_llm=bool(body.get("use_llm")))
            send(self, 200, {"result": res, "turns": [dict(n=t.no, s=t.speaker, t=t.text) for t in call.turns],
                             "masked": mask_call(call).as_text()})
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
