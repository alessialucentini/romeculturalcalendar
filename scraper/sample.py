"""Scarica l'HTML reale delle pagine eventi di alcune fonti, per poter scrivere i parser dedicati.
Salva in data/samples/<id>/ (HTML troncato) + index.md con i link candidati trovati.
Uso: python scraper/sample.py [id,id,...]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from common import polite_get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "samples"
IDS = ["roma-culture-manifestazioni", "teatro-dell-opera-di-roma", "teatro-di-roma-argentina-india",
       "auditorium-parco-della-musica", "maxxi"]
KEYS = re.compile(r"calendar|agenda|event|spettacol|program|stagione|mostr|cartellone|biglietti|manifestaz|attivit", re.I)
MAX_BYTES = 350_000
MAX_PAGES = 4


def main() -> None:
    import csv
    ids = sys.argv[1].split(",") if len(sys.argv) > 1 else IDS
    src = {r["id"]: r for r in csv.DictReader(open(ROOT / "data" / "sources.csv", encoding="utf-8"))}
    for sid in ids:
        d = OUT / sid
        d.mkdir(parents=True, exist_ok=True)
        lines = [f"# {sid}", ""]
        try:
            home = src[sid]["link"]
            pages = [home]
            r = polite_get(home)
            soup = BeautifulSoup(r.text, "html.parser")
            host = urlparse(home).netloc.split(":")[0].removeprefix("www.")
            cand = []
            for a in soup.find_all("a", href=True):
                u = urljoin(home, a["href"]).split("#")[0]
                if urlparse(u).netloc.removeprefix("www.") == host and KEYS.search(u) and u not in cand and u != home:
                    cand.append(u)
            lines += ["Link candidati dalla home:"] + [f"- {u}" for u in cand[:40]] + [""]
            pages += cand[: MAX_PAGES - 1]
            for i, u in enumerate(pages):
                try:
                    resp = r if i == 0 else polite_get(u)
                    (d / f"{i}.html").write_text(resp.text[:MAX_BYTES], encoding="utf-8")
                    lines.append(f"- {i}.html <- {u} ({resp.status_code}, {len(resp.text)} byte)")
                except Exception as ex:  # noqa: BLE001
                    lines.append(f"- {i}: {u} ERRORE {type(ex).__name__}: {ex}")
        except Exception as ex:  # noqa: BLE001
            lines.append(f"ERRORE {type(ex).__name__}: {ex}")
        (d / "index.md").write_text("\n".join(lines), encoding="utf-8")
        print("\n".join(lines[-6:]))


if __name__ == "__main__":
    main()
