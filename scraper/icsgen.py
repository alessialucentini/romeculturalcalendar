"""Genera un file .ics per ogni evento (web/ics/<id>.ics).
iPhone/iPad aprono il Calendario solo da un vero file https servito come text/calendar, non da link creati al volo.
Uso:  python scraper/icsgen.py        (rigenera da web/data/events.json)
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "web" / "data" / "events.json"
OUT = ROOT / "web" / "ics"
ROME = ZoneInfo("Europe/Rome")
DEFAULT_HOURS = 2


def _esc(t: str) -> str:
    return str(t or "").replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,").replace("\r\n", "\n").replace("\n", "\\n")


def _fold(line: str) -> str:
    out, cur = [], ""
    for ch in line:  # 75 ottetti per riga, a capo con spazio
        if len((cur + ch).encode()) > 73:
            out.append(cur); cur = ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n ".join(out)


def _utc(day: str, time: str) -> str:
    h, m = map(int, time.split(":"))
    d = datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=ROME)
    return d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M00Z")


def ics_for(e: dict, stamp: str) -> str:
    where = ", ".join(x for x in [e.get("venue"), e.get("address")] if x)
    details = "\n\n".join(x for x in [e.get("description", ""), f"Info: {e['url']}" if e.get("url") else "", "Da Linceo"] if x)
    L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Linceo//Roma//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
         "BEGIN:VEVENT", f"UID:{e['id']}@linceo", f"DTSTAMP:{stamp}"]
    ranged = e.get("kind") in ("festival", "mostra") or e["start"] != e["end"]
    if e.get("time") and not ranged:
        start = datetime.fromisoformat(e["start"]).replace(hour=int(e["time"][:2]), minute=int(e["time"][3:]), tzinfo=ROME)
        end = start + timedelta(hours=DEFAULT_HOURS)
        L += [f"DTSTART:{start.astimezone(timezone.utc):%Y%m%dT%H%M00Z}", f"DTEND:{end.astimezone(timezone.utc):%Y%m%dT%H%M00Z}"]
    else:
        last = date.fromisoformat(e["end"]) + timedelta(days=1)
        L += [f"DTSTART;VALUE=DATE:{e['start'].replace('-', '')}", f"DTEND;VALUE=DATE:{last:%Y%m%d}"]
    L += [f"SUMMARY:{_esc(e['title'])}", f"LOCATION:{_esc(where)}", f"DESCRIPTION:{_esc(details)}"]
    if re.match(r"https?://", e.get("url") or ""):
        L.append(f"URL:{e['url']}")
    L += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(x) for x in L) + "\r\n"


def write_all(events: list[dict]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.ics"):
        f.unlink()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for e in events:
        (OUT / f"{e['id']}.ics").write_text(ics_for(e, stamp), encoding="utf-8", newline="")
    return len(events)


if __name__ == "__main__":
    n = write_all(json.loads(EVENTS.read_text(encoding="utf-8"))["events"])
    print(f"scritti {n} file .ics in {OUT}", file=sys.stderr)
