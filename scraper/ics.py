"""Legge feed iCalendar (.ics). Dove esiste, è ancora meglio del JSON-LD."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from icalendar import Calendar

from common import Event, clean


def parse(raw: bytes, page_url: str, *, cat: str, default_venue: str, source: str) -> list[Event]:
    cal = Calendar.from_ical(raw)
    out: list[Event] = []
    for ev in cal.walk("VEVENT"):
        s = ev.decoded("DTSTART") if ev.get("DTSTART") else None
        if s is None:
            continue
        e = ev.decoded("DTEND") if ev.get("DTEND") else s
        t = None
        ROMA = ZoneInfo("Europe/Rome")
        if isinstance(s, datetime) and s.tzinfo:
            s = s.astimezone(ROMA)
            e = e.astimezone(ROMA) if isinstance(e, datetime) and e.tzinfo else e
        if isinstance(s, datetime):
            t = s.strftime("%H:%M") if (s.hour, s.minute) != (0, 0) else None
            start = s.date()
            end = e.date() if isinstance(e, datetime) else e
        else:  # evento "tutto il giorno": DTEND è esclusivo
            start = s
            end = (e - timedelta(days=1)) if isinstance(e, date) and e > s else s
        title = clean(str(ev.get("SUMMARY", "")), 160)
        if not title:
            continue
        out.append(Event(
            title=title, cat=cat, venue=clean(str(ev.get("LOCATION", "")), 120) or default_venue,
            start=start.isoformat(), end=end.isoformat(), time=t,
            description=clean(str(ev.get("DESCRIPTION", ""))),
            url=str(ev.get("URL", "") or page_url), source=source,
            kind="mostra" if (end > start and t is None) else "evento",
        ))
    return out
