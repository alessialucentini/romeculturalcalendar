"""Estrae eventi schema.org (JSON-LD) da una pagina HTML. È il metodo più robusto: non dipende dal layout."""
from __future__ import annotations

import json
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import Event, clean, parse_iso

EVENT_TYPES = {
    "Event", "ExhibitionEvent", "TheaterEvent", "MusicEvent", "DanceEvent", "ScreeningEvent",
    "Festival", "LiteraryEvent", "VisualArtsEvent", "EducationEvent", "SocialEvent", "ComedyEvent",
}


def _walk(node):
    """Itera ricorsivamente su tutti i dict di un blob JSON-LD (gestisce @graph, liste, itemListElement)."""
    if isinstance(node, list):
        for x in node:
            yield from _walk(x)
    elif isinstance(node, dict):
        yield node
        for v in node.values():
            if isinstance(v, (list, dict)):
                yield from _walk(v)


def _is_event(d: dict) -> bool:
    t = d.get("@type")
    types = t if isinstance(t, list) else [t]
    return any(x in EVENT_TYPES for x in types if isinstance(x, str))


def _location(d: dict) -> tuple[str, str]:
    loc = d.get("location")
    if isinstance(loc, list) and loc:
        loc = loc[0]
    if isinstance(loc, str):
        return loc, ""
    if isinstance(loc, dict):
        name = loc.get("name", "") or ""
        addr = loc.get("address", "")
        if isinstance(addr, dict):
            addr = ", ".join(str(addr.get(k, "")) for k in ("streetAddress", "postalCode", "addressLocality") if addr.get(k))
        return name, str(addr or "")
    return "", ""


def parse(html: str, page_url: str, *, cat: str, default_venue: str, source: str) -> list[Event]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[Event] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for d in _walk(data):
            if not isinstance(d, dict) or not _is_event(d):
                continue
            title = clean(d.get("name"), 160)
            start, t = parse_iso(d.get("startDate"))
            if not title or not start:
                continue
            end, _ = parse_iso(d.get("endDate"))
            venue, address = _location(d)
            kind = "mostra" if d.get("@type") == "ExhibitionEvent" or (end and end != start and t is None) else "evento"
            out.append(Event(
                title=title, cat=cat, venue=venue or default_venue, start=start, end=end or start,
                time=t, address=address, description=clean(d.get("description")),
                url=urljoin(page_url, d.get("url") or page_url), source=source, kind=kind,
            ))
    return out
