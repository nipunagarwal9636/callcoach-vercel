"""Audio -> transcript with speakers. Whisper via Groq or OpenAI, then LLM speaker labelling (diarization by role)."""
from . import llm
from .transcript import Call, Turn


def transcribe(file_bytes, filename):
    cfg = llm.stt_config()
    if not cfg:
        raise RuntimeError("Set STT_PROVIDER (groq or openai) and STT_API_KEY to transcribe audio.")
    from openai import OpenAI
    cl = OpenAI(api_key=cfg["key"], base_url=cfg["base"]) if cfg["base"] else OpenAI(api_key=cfg["key"])
    resp = cl.audio.transcriptions.create(model=cfg["model"], file=(filename, file_bytes), response_format="verbose_json")
    segs = getattr(resp, "segments", None) or []
    texts, times = [], []
    for s in segs:
        txt = (s.get("text") if isinstance(s, dict) else getattr(s, "text", "")).strip()
        st = s.get("start") if isinstance(s, dict) else getattr(s, "start", 0)
        if txt:
            texts.append(txt); times.append(st)
    if not texts:
        texts = [resp.text]; times = [0]
    labels = llm.label_speakers(texts) if llm.available() else ["AGENT" if i % 2 == 0 else "CUSTOMER" for i in range(len(texts))]
    turns = []
    for txt, lab in zip(texts, labels):  # merge consecutive segments from the same speaker
        if turns and turns[-1].speaker == lab:
            turns[-1].text += " " + txt
        else:
            turns.append(Turn(len(turns) + 1, lab, txt))
    return Call(turns, {"source": "audio", "duration_s": round(times[-1], 1) if times else None})
