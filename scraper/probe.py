"""Fase 2: per ogni fonte dice COME si può leggere (JSON-LD, ICS, RSS, solo HTML, bloccata).

Si lancia da GitHub Actions (workflow_dispatch, mode=probe) perché da lì i siti sono raggiungibili.
Scrive data/probe_report.md: serve a decidere quali fonti abilitare in data/sources.csv.
Uso:  python scraper/probe.py [--all]     (default: solo fonti con link, abilitate o no)
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
import jsonld  # noqa: E402
from common import polite_get, robots_allows  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def probe(src: dict) -> dict:
    url = src["link"]
    res = {"id": src["id"], "url": url, "http": "-", "robots": "-", "jsonld_events": 0, "ics": "no", "rss": "no", "verdetto": ""}
    try:
        res["robots"] = "ok" if robots_allows(url) else "VIETATO"
        if res["robots"] != "ok":
            res["verdetto"] = "non scaricare (robots.txt)"
            return res
        r = polite_get(url)
        res["http"] = r.status_code
        res["jsonld_events"] = len(jsonld.parse(r.text, url, cat=src["cat"], default_venue=src["nome"], source=src["id"]))
        soup = BeautifulSoup(r.text, "html.parser")
        hrefs = [a["href"].lower() for a in soup.find_all("a", href=True)]
        if any(h.split("?")[0].endswith(".ics") or "ical" in h for h in hrefs):
            res["ics"] = "si"
        if soup.find("link", type="application/rss+xml") or soup.find("link", type="application/atom+xml"):
            res["rss"] = "si"
        if res["jsonld_events"] or res["ics"] == "si":
            res["verdetto"] = "FACILE: abilita method=auto"
        elif res["rss"] == "si":
            res["verdetto"] = "medio: c'è un RSS da leggere"
        else:
            res["verdetto"] = "serve parser HTML dedicato (o pagina eventi diversa dalla home)"
    except PermissionError:
        res["verdetto"] = "non scaricare (robots.txt)"
    except Exception as ex:
        res["http"] = f"ERR {type(ex).__name__}"
        res["verdetto"] = "irraggiungibile: verifica il link"
    return res


def main() -> None:
    with open(ROOT / "data" / "sources.csv", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["link"]]
    results = []
    for r in rows:
        results.append(probe(r))
        print(results[-1]["id"], "->", results[-1]["verdetto"], flush=True)
    lines = ["# Probe fonti", "", "| fonte | http | robots | eventi JSON-LD | ICS | RSS | verdetto |", "|---|---|---|---|---|---|---|"]
    for x in results:
        lines.append(f"| [{x['id']}]({x['url']}) | {x['http']} | {x['robots']} | {x['jsonld_events']} | {x['ics']} | {x['rss']} | {x['verdetto']} |")
    (ROOT / "data" / "probe_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
