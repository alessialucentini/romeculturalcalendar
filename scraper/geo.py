"""Coordinate degli eventi per la mappa: cache in data/geocache.json + Nominatim (OpenStreetMap) per i luoghi nuovi.

Ordine: 1) data/venue_coords.json (a mano, per sottostringa del nome del luogo), 2) cache, 3) Nominatim.
Nominatim chiede max 1 richiesta/secondo e uno User-Agent che identifichi l'app: rispettato.
Se non trova nulla l'evento resta senza pallino sulla mappa (ma compare nell'elenco).
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "geocache.json"
OVERRIDES = ROOT / "data" / "venue_coords.json"
UA = "Linceo/1.0 (https://github.com/alessialucentini/romeculturalcalendar)"
BOX = (12.20, 41.65, 12.75, 42.05)  # ovest, sud, est, nord: Roma con Ostia
PAUSE = 1.1
BUDGET_SECONDS = 420  # il resto alla prossima esecuzione: la cache si accumula
GENERIC = {"", "roma", "online", "vari luoghi", "varie sedi"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def place_key(e: dict) -> tuple[str, str]:
    venue = re.split(r"\s[·|]\s", e.get("venue") or "")[0].strip()
    return venue, (e.get("address") or "").strip()


MULTI = re.compile(r"^(vari|varie|diversi|diverse)\b|\(|\b(vari luoghi|varie sedi)\b", re.I)


def queries(venue: str, address: str) -> list[str]:
    if MULTI.search(venue or ""):  # "Vari spazi di Roma (A, B, C)": non è un luogo solo
        return []
    qs = []
    if address and re.search(r"\d", address):
        qs.append(address if re.search(r"roma", address, re.I) else f"{address}, Roma")
    if _norm(venue) not in GENERIC:
        qs.append(f"{venue}, Roma")
    return qs


def _lookup(q: str) -> tuple[float, float] | None:
    r = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "it", "bounded": 1,
                "viewbox": f"{BOX[0]},{BOX[3]},{BOX[2]},{BOX[1]}"},
        headers={"User-Agent": UA, "Accept-Language": "it"}, timeout=20)
    r.raise_for_status()
    for hit in r.json():
        lat, lon = float(hit["lat"]), float(hit["lon"])
        if BOX[1] <= lat <= BOX[3] and BOX[0] <= lon <= BOX[2]:
            return lat, lon
    return None


def apply(events: list[dict], budget: float = BUDGET_SECONDS, fetch=_lookup, sleep=time.sleep) -> dict:
    """Aggiunge lat/lon (arrotondati a 5 decimali) agli eventi. Ritorna statistiche."""
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    over = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    over = {k.lower(): v for k, v in over.items() if not k.startswith("_")}
    t0, looked, found = time.time(), 0, 0
    todo: dict[str, tuple[str, str]] = {}
    for e in events:
        venue, addr = place_key(e)
        key = f"{_norm(venue)}|{_norm(addr)}"
        hit = next((v for k, v in over.items() if _norm(venue).startswith(k)), None) if not MULTI.search(venue) else None
        if hit:
            cache[key] = hit
        if key not in cache and queries(venue, addr):
            todo[key] = (venue, addr)
    for key, (venue, addr) in todo.items():
        if time.time() - t0 > budget:
            break
        res, failed = None, False
        for q in queries(venue, addr):
            try:
                res = fetch(q)
            except Exception:  # noqa: BLE001  errore di rete: non lo memorizzo, riprovo la prossima volta
                failed = True
                break
            looked += 1
            sleep(PAUSE)
            if res:
                break
        if not failed:
            cache[key] = list(res) if res else None
            found += 1 if res else 0
    for e in events:
        venue, addr = place_key(e)
        c = cache.get(f"{_norm(venue)}|{_norm(addr)}")
        if c:
            e["lat"], e["lon"] = round(c[0], 5), round(c[1], 5)
        else:
            e.pop("lat", None); e.pop("lon", None)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    return {"lookups": looked, "new_found": found, "unresolved": sum(1 for k in todo if cache.get(k) is None),
            "with_coords": sum(1 for e in events if "lat" in e), "total": len(events)}
