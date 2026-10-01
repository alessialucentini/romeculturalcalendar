"""Utility condivise: fetch gentile (robots.txt, user-agent, pausa), modello evento, parsing date."""
from __future__ import annotations

import hashlib
import re
import time
import urllib.robotparser
from dataclasses import dataclass, asdict, field
from datetime import date, datetime
from urllib.parse import urlparse

import requests

USER_AGENT = "RomaOggiBot/0.1 (aggregatore culturale non commerciale; contatto: vedi README del repo)"
PAUSE_SECONDS = 2.0
TIMEOUT = 20

CATEGORIES = {
    "opera": "Opera / classica",
    "teatro": "Teatro / danza",
    "cinema": "Cinema",
    "contemporanea": "Arte contemporanea",
    "mostre": "Mostre",
    "libri": "Libri / letteratura",
    "istituti": "Istituti culturali",
    "community": "Community / sport",
    "musica": "Concerti",
    "altro": "Altro",
}

_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_last_hit: dict[str, float] = {}
_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "it,en;q=0.5"})


def robots_allows(url: str) -> bool:
    """Rispetta robots.txt. Se non si riesce a leggerlo si considera consentito (ma con pausa)."""
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _session.get(base + "/robots.txt", timeout=TIMEOUT)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
                _robots_cache[base] = rp
            else:
                _robots_cache[base] = None
        except requests.RequestException:
            _robots_cache[base] = None
    rp = _robots_cache[base]
    return True if rp is None else rp.can_fetch(USER_AGENT, url)


def polite_get(url: str) -> requests.Response:
    if not robots_allows(url):
        raise PermissionError(f"robots.txt vieta {url}")
    host = urlparse(url).netloc
    wait = PAUSE_SECONDS - (time.time() - _last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last_hit[host] = time.time()
    r = _session.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return r


@dataclass
class Event:
    title: str
    cat: str
    venue: str
    start: str                 # YYYY-MM-DD
    end: str                   # YYYY-MM-DD (uguale a start per eventi di un giorno)
    url: str
    source: str
    kind: str = "evento"       # evento | mostra | festival
    time: str | None = None    # HH:MM
    address: str = ""
    description: str = ""
    note: str = ""
    checked: str = field(default_factory=lambda: date.today().isoformat())

    @property
    def id(self) -> str:
        raw = f"{self.title.lower().strip()}|{self.venue.lower().strip()}|{self.start}|{self.time or ''}"
        return hashlib.sha1(raw.encode()).hexdigest()[:12]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["id"] = self.id
        return d


_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?")


def parse_iso(value: str | None) -> tuple[str | None, str | None]:
    """'2026-10-14T20:30:00+02:00' -> ('2026-10-14', '20:30'). Mezzanotte esatta = nessun orario."""
    if not value:
        return None, None
    m = _ISO.match(value.strip())
    if not m:
        return None, None
    y, mo, d, hh, mm = m.groups()
    try:
        datetime(int(y), int(mo), int(d))
    except ValueError:
        return None, None
    t = f"{hh}:{mm}" if hh and (hh, mm) != ("00", "00") else None
    return f"{y}-{mo}-{d}", t


def clean(text: str | None, limit: int = 400) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
