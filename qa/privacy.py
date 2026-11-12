"""DPDP-minded masking: names, phone numbers, emails, ID-like numbers and health conditions are replaced with tokens
before any text leaves our system (LLM calls) or appears in coaching material."""
import re
from copy import deepcopy

HEALTH = re.compile(r"\b(sugar|diabet\w*|bp|blood pressure|hypertension|thyroid|asthma|heart (problem|disease|condition)|cardiac|"
                    r"cholesterol|kidney (problem|disease|stone)|cancer|arthritis|migraine|cataract|hernia)\b", re.I)
PHONE = re.compile(r"(?<!\d)(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
IDNUM = re.compile(r"\b[A-Z]{2,5}[-/]?\d{5,}\b")
NAME_PATTERNS = [
    r"speaking with ([A-Z][a-z]+)", r"baat ([A-Z][a-z]+) ji", r"\b(?:I'm|I am|this is|my name is) ([A-Z][a-z]+)",
    r"\bMain ([A-Z][a-z]+),", r"mera naam ([A-Z][a-z]+)", r"\b([A-Z][a-z]+) ji\b",
]
NOT_NAMES = {"Insurer", "Health", "Policy", "PolicyNest", "Sir", "Ma", "Okay", "Hello", "Haan", "Theek", "Main", "Premium", "Summary", "Car"}


def find_names(call):
    names = set()
    for t in call.turns:
        for pat in NAME_PATTERNS:
            for m in re.finditer(pat, t.text):
                n = m.group(1)
                if n not in NOT_NAMES:
                    names.add(n)
    return names


def mask_text(text, names=(), health=True):
    for n in names:
        text = re.sub(rf"\b{re.escape(n)}\b", "[NAME]", text)
    text = PHONE.sub("[PHONE]", text)
    text = EMAIL.sub("[EMAIL]", text)
    text = IDNUM.sub("[ID]", text)
    if health:
        text = HEALTH.sub("[HEALTH CONDITION]", text)
    return text


def mask_call(call, health=True):
    names = find_names(call)
    c = deepcopy(call)
    for t in c.turns:
        t.text = mask_text(t.text, names, health)
    return c
