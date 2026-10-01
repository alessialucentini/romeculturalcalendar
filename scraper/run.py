"""Scraper settimanale.

Per ogni fonte abilitata in data/sources.csv:
  1. scarica la pagina (robots.txt rispettato, pausa tra richieste)
  2. cerca eventi JSON-LD; se non ne trova, cerca un link a un feed .ics e lo legge
  3. aggiunge gli eventi al database

Regole di sicurezza:
  - una fonte che fallisce NON cancella i suoi eventi precedenti (restano finché non scadono)
  - gli eventi già finiti da più di 7 giorni vengono rimossi
  - gli eventi inseriti a mano in data/eventi_manuali.json vengono sempre inclusi (modificali lì)
Uso:  python scraper/run.py [--only ID,ID] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
import ics as ics_mod  # noqa: E402
import jsonld  # noqa: E402
from common import CATEGORIES, Event, polite_get  # noqa: E402
from sites import SITES  # noqa: E402
import icsgen  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "sources.csv"
EVENTS = ROOT / "web" / "data" / "events.json"
LOG = ROOT / "data" / "scrape_log.json"
MANUAL = ROOT / "data" / "eventi_manuali.json"
KEEP_DAYS_AFTER_END = 7


def load_sources(only: set[str] | None) -> list[dict]:
    with open(SOURCES, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f)]
    return [r for r in rows if (r["id"] in only if only else r["enabled"] == "si" and r["link"])]


def scrape_source(src: dict) -> list[Event]:
    if src["id"] in SITES:  # parser dedicato
        return SITES[src["id"]](src)
    kw = dict(cat=src["cat"], default_venue=src["nome"], source=src["id"])
    resp = polite_get(src["link"])
    events = jsonld.parse(resp.text, src["link"], **kw)
    if events:
        return events
    # nessun JSON-LD: prova un feed iCal linkato dalla pagina
    soup = BeautifulSoup(resp.text, "html.parser")
    seen = set()
    for a in soup.find_all("a", href=True):
        h = a["href"].lower()
        if not (h.split("?")[0].endswith(".ics") or "ical=1" in h or "/ical" in h or "outlook-ical" in h):
            continue
        link = urljoin(src["link"], a["href"])
        if link in seen:
            continue
        seen.add(link)
        try:
            feed = polite_get(link)
        except Exception:
            continue
        if not feed.content.lstrip().upper().startswith(b"BEGIN:VCALENDAR"):
            continue  # non è un vero calendario (es. pagina HTML)
        try:
            evs = ics_mod.parse(feed.content, src["link"], **kw)
        except Exception:
            continue
        if evs:
            return evs
    return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="id fonti separati da virgola")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    today = date.today()
    db = json.loads(EVENTS.read_text(encoding="utf-8")) if EVENTS.exists() else {"events": []}
    old = {e["id"]: e for e in db["events"]}

    log, new_by_source = [], {}
    for src in load_sources(set(args.only.split(",")) if args.only else None):
        entry = {"source": src["id"], "url": src["link"], "status": "ok", "events": 0}
        try:
            evs = scrape_source(src)
            for e in evs:  # "Titolo - 01/10/2026 09:00" -> "Titolo"
                e.title = re.sub(r"\s*[-–]\s*\d{1,2}/\d{1,2}/\d{4}(\s+\d{1,2}:\d{2})?\s*$", "", e.title)
            # aggregatori nazionali: tieni solo eventi con indirizzo a Roma
            # rassegne "tutto l'anno" (oltre 200 giorni) riempirebbero ogni giorno: escluse
            evs = [e for e in evs if (date.fromisoformat(e.end) - date.fromisoformat(e.start)).days <= 200]
            evs = [e for e in evs if not e.address or re.search(r"\broma\b|\(rm\)", e.address, re.I)]
            # tieni solo eventi non ancora finiti
            evs = [e for e in evs if e.end >= (today - timedelta(days=1)).isoformat() and e.cat in CATEGORIES]
            new_by_source[src["id"]] = evs
            entry["events"] = len(evs)
            if not evs:
                entry["status"] = "vuoto (nessun JSON-LD/ICS: serve un parser dedicato)"
        except PermissionError as ex:
            entry["status"] = f"bloccato da robots.txt: {ex}"
        except Exception as ex:  # una fonte rotta non deve fermare le altre
            entry["status"] = f"errore: {type(ex).__name__}: {ex}"
        log.append(entry)
        print(f"[{entry['status'][:40]:<40}] {src['id']} ({entry['events']})")

    # unione: per le fonti andate a buon fine sostituisco i loro eventi, per le altre conservo i vecchi
    merged = {}
    refreshed = {sid for sid, evs in new_by_source.items() if evs}
    for eid, e in old.items():
        if e["source"] in refreshed or e["source"].startswith("manuale:"):
            continue  # i manuali vengono riletti dal file sotto
        merged[eid] = e
    for evs in new_by_source.values():
        for e in evs:
            merged[e.id] = e.to_dict()

    if MANUAL.exists():
        for m in json.loads(MANUAL.read_text(encoding="utf-8")):
            m.setdefault("checked", today.isoformat())
            ev = Event(**{k: v for k, v in m.items() if k != "id"})
            merged[ev.id] = ev.to_dict()

    cutoff = (today - timedelta(days=KEEP_DAYS_AFTER_END)).isoformat()
    final = [e for e in merged.values() if e["end"] >= cutoff]
    final.sort(key=lambda e: (e["start"], e.get("time") or "99:99", e["title"]))

    out = {
        "meta": {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "count": len(final)},
        "events": final,
    }
    if args.dry_run:
        print(json.dumps(out["meta"]), "(dry-run: nulla scritto)")
        return 0
    EVENTS.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    LOG.write_text(json.dumps({"run": out["meta"]["generated"], "sources": log}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"scritti {len(final)} eventi in {EVENTS}")
    print(f"scritti {icsgen.write_all(final)} file .ics (per Apple Calendar)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
