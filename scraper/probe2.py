"""Probe 2: cerca, per ogni fonte raggiungibile, le sotto-pagine che contengono eventi leggibili
(JSON-LD schema.org, API The Events Calendar di WordPress, link iCal). Scrive data/probe2.md e data/probe2.json.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).parent))
from bs4 import BeautifulSoup  # noqa: E402

import jsonld  # noqa: E402
from common import polite_get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PATHS = ["/wp-json/tribe/events/v1/events?per_page=5", "/eventi/", "/events/", "/calendario/", "/agenda/", "/programma/", "/mostre/", "/mostre-in-corso/", "/en/events/"]
SKIP = {"maxxi", "auditorium-parco-della-musica", "teatro-dell-opera-di-roma", "roma-culture-manifestazioni",
        "teatro-di-roma-argentina-india", "teatro-india", "cinema-troisi", "artribune"}


def check(src: dict) -> dict:
    base = "{0.scheme}://{0.netloc}".format(urlparse(src["link"]))
    res = {"id": src["id"], "nome": src["nome"], "base": base, "hits": []}
    seen = set()
    urls = [src["link"]] + [base + p for p in PATHS]
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        try:
            r = polite_get(u)
        except Exception as ex:  # noqa: BLE001
            if u == src["link"]:
                res["err"] = f"{type(ex).__name__}"
                if "ConnectionError" in res["err"] or "SSL" in res["err"] or "Timeout" in res["err"]:
                    return res  # sito irraggiungibile: inutile insistere
            continue
        ct = r.headers.get("content-type", "")
        info = {"url": r.url, "ct": ct.split(";")[0], "bytes": len(r.content)}
        if "json" in ct:
            try:
                j = r.json()
                info["tribe"] = len(j.get("events", [])) if isinstance(j, dict) else 0
            except Exception:  # noqa: BLE001
                info["tribe"] = 0
        else:
            html = r.text
            try:
                info["jsonld"] = len(jsonld.parse(html, r.url, cat="altro", default_venue=src["nome"], source=src["id"]))
            except Exception:  # noqa: BLE001
                info["jsonld"] = 0
            soup = BeautifulSoup(html, "html.parser")
            info["ics"] = sum(1 for a in soup.find_all("a", href=True) if a["href"].lower().split("?")[0].endswith(".ics") or "ical=" in a["href"].lower())
            info["event_links"] = len({a["href"] for a in soup.find_all("a", href=True) if re.search(r"/(event|eventi|evento|mostra|spettacol|calendar)", a["href"], re.I)})
            info["tribe_plugin"] = "tribe-events" in html or "tribe_events" in html
        if info.get("jsonld") or info.get("tribe") or info.get("ics") or (info.get("event_links", 0) >= 5):
            res["hits"].append(info)
    return res


def main() -> None:
    rows = [r for r in csv.DictReader(open(ROOT / "data" / "sources.csv", encoding="utf-8")) if r["link"] and r["id"] not in SKIP]
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(check, rows))
    (ROOT / "data" / "probe2.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# Probe 2: sotto-pagine con eventi leggibili", "", "| fonte | pagina | tipo | JSON-LD | tribe API | iCal | link evento |", "|---|---|---|---|---|---|---|"]
    for r in out:
        for h in r["hits"]:
            lines.append(f"| {r['id']} | {h['url']} | {h['ct']} | {h.get('jsonld', '')} | {h.get('tribe', '')} | {h.get('ics', '')} | {h.get('event_links', '')} |")
    lines += ["", "## Senza risultati", ""] + [f"- {r['id']} {r.get('err', '')}" for r in out if not r["hits"]]
    (ROOT / "data" / "probe2.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{sum(1 for r in out if r['hits'])} fonti con almeno una pagina utile su {len(out)}")


if __name__ == "__main__":
    main()
