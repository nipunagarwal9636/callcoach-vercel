"""Transcript parsing and loading."""
import re
from dataclasses import dataclass, field


@dataclass
class Turn:
    no: int
    speaker: str  # AGENT | CUSTOMER
    text: str


@dataclass
class Call:
    turns: list
    meta: dict = field(default_factory=dict)

    def agent(self):
        return [t for t in self.turns if t.speaker == "AGENT"]

    def customer(self):
        return [t for t in self.turns if t.speaker == "CUSTOMER"]

    def as_text(self):
        return "\n".join(f"[{t.no}] {t.speaker}: {t.text}" for t in self.turns)


_SPK = re.compile(r"^\s*(?:\[?\d+\]?[.)]?\s*)?(agent|customer|a|c|caller|client|sales|rep)\s*[:\-–]\s*(.*)$", re.I)


def parse_text(raw: str) -> Call:
    """Accepts lines like 'AGENT: ...' / 'CUSTOMER: ...' (or 'A:'/'C:'). Lines without a speaker continue the previous turn."""
    turns = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        m = _SPK.match(line)
        if m:
            who = m.group(1).lower()
            spk = "AGENT" if who in ("agent", "a", "sales", "rep") else "CUSTOMER"
            turns.append(Turn(len(turns) + 1, spk, m.group(2).strip()))
        elif turns:
            turns[-1].text += " " + line.strip()
    return Call(turns)


def load_labelled(path):
    import pandas as pd
    t = pd.read_excel(path, "transcripts")
    m = pd.read_excel(path, "transcript_meta")
    v = pd.read_excel(path, "violation_labels")
    calls = {}
    for tid, g in t.groupby("transcript_id"):
        g = g.sort_values("turn_no")
        calls[tid] = Call([Turn(int(r.turn_no), r.speaker, str(r.text)) for r in g.itertuples()])
    for r in m.to_dict("records"):
        calls[r["transcript_id"]].meta = r
    labels = {}
    for r in v.to_dict("records"):
        labels.setdefault(r["transcript_id"], {})[r["parameter_id"]] = r
    return calls, labels, m
