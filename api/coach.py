from http.server import BaseHTTPRequestHandler

from _util import read_json, send
from qa import llm
from qa.coaching import BETTER, _llm_personalise, guardrail


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            m = read_json(self).get("module") or {}
            if not llm.available():
                return send(self, 400, {"error": "LLM not configured on the server"})
            m = _llm_personalise(m)
            m["guardrail"] = guardrail(" ".join([m.get("better", ""), m.get("practice", ""), m.get("feedback", "")]))
            if m["guardrail"]:
                lang = (m.get("excerpts") or [{}])[0].get("lang", "en")
                m["better"] = BETTER[m["param"]][1 if lang == "hi" else 0]
                m["feedback"] = ""
                m["generated_by"] = "template (LLM output blocked by guardrail)"
            send(self, 200, {"module": m})
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
