"""Parser dedicati ai siti che non hanno JSON-LD né iCal.

Ogni sito ha due funzioni: parse_*(html, ...) -> list[Event] (testabile su HTML salvato)
e fetch_*(src) -> list[Event] (scarica le pagine necessarie con polite_get).
SITES in fondo collega l'id della fonte (data/sources.csv) alla funzione fetch.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from bs4 import BeautifulSoup

from common import Event, clean, polite_get

MESI = {m: i + 1 for i, m in enumerate(
    ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"])}
MESI.update({k[:3]: v for k, v in list(MESI.items())})  # gen, feb, mar, ... (set = sett)
MESI["sett"] = 9


def _month(s: str) -> int | None:
    s = s.lower().strip(".")
    return MESI.get(s) or MESI.get(s[:3])


def _d(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def _soup(html: str | bytes) -> BeautifulSoup:
    if isinstance(html, bytes):
        html = html.decode("utf-8", "replace")
    return BeautifulSoup(html, "html.parser")


def _text(html_bytes: bytes) -> str:
    return html_bytes.decode("utf-8", "replace")


# ------------------------------------------------------------------ MAXXI
_MAXXI_DATE = re.compile(r"(\d{1,2})\s+([A-Za-zì]+)\s+(\d{4})")


def parse_maxxi(html: str, base: str, cat: str, venue: str, source: str) -> list[Event]:
    """Home/pagine eventi di maxxi.art: blocchi .list_eventi .item con .cat, h3, .data."""
    out: list[Event] = []
    seen = set()
    for it in _soup(html).select(".list_eventi .item"):
        a = it.find("a", href=True)
        h3 = it.find("h3")
        data = it.select_one(".data")
        if not (a and h3 and data):
            continue
        txt = data.get_text(" ", strip=True)
        dates = [_d(int(y), _month(m) or 0, int(d)) for d, m, y in _MAXXI_DATE.findall(txt)]
        dates = [x for x in dates if x]
        if not dates:
            continue
        sopra = h3.select_one(".sovratitolo")
        sotto = h3.select_one(".sottotitolo")
        parts = [sopra.get_text(" ", strip=True) if sopra else "", sotto.get_text(" ", strip=True) if sotto else ""]
        for s in h3.select(".sovratitolo, .sottotitolo"):
            s.extract()
        title = clean(h3.get_text(" ", strip=True))
        if not title:
            continue
        label = (it.select_one(".cat").get_text(strip=True).lower() if it.select_one(".cat") else "")
        m = re.search(r"ore\s*(\d{1,2})[:.](\d{2})", txt)
        time = f"{int(m.group(1)):02d}:{m.group(2)}" if m else None
        start, end = dates[0], dates[-1]
        kind = "mostra" if (label in ("mostra", "focus") and start != end) else "evento"
        key = (a["href"], start, time)
        if key in seen:
            continue
        seen.add(key)
        out.append(Event(
            title=title, cat=cat, venue=venue, address="Via Guido Reni 4A, Roma", start=start, end=end, time=time,
            url=urljoin(base, a["href"]), source=source, kind=kind,
            description=clean(" · ".join(x for x in [label, *parts] if x))))
    return out


def fetch_maxxi(src: dict) -> list[Event]:
    r = polite_get(src["link"])
    return parse_maxxi(_text(r.content), src["link"], src["cat"], "MAXXI", src["id"])


# ------------------------------------------------------------------ Auditorium Parco della Musica
_AUD_DATE = re.compile(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:,?\s*h\.?\s*(\d{1,2})[:.](\d{2}))?(?:\s*-\s*(.+))?")


def parse_auditorium(html: str, base: str, cat: str, source: str) -> list[Event]:
    """Due layout di card: slider (data+ora+sala in una riga) e lista (sottotitolo/intro/body separati)."""
    out: list[Event] = []
    for card in _soup(html).select("div.event-card"):
        link = card.select_one("a.apm-card-link[href]")
        title_el = card.select_one(".text-card-title")
        descr = card.select_one(".event-card-descr")
        if not (link and title_el and descr):
            continue
        sub, intro, body = (card.select_one(f".{c}") for c in ("text-subtitle", "text-intro", "text-body-small"))
        if sub:
            when = sub.get_text(" ", strip=True) + (" " + intro.get_text(" ", strip=True) if intro else "")
            sala = clean(body.get_text(" ", strip=True)) if body else ""
        else:
            when, sala = descr.get_text(" | ", strip=True).split(" | ")[0], ""
        m = _AUD_DATE.search(when)
        if not m or not _month(m.group(2)):
            continue
        start = _d(int(m.group(3)), _month(m.group(2)), int(m.group(1)))
        if not start:
            continue
        time = f"{int(m.group(4)):02d}:{m.group(5)}" if m.group(4) else None
        sala = sala or clean(m.group(6) or "")
        label = card.select_one(".text-label")
        lab = clean(label.get_text(" ", strip=True)) if label else ""
        ev_cat = "opera" if "classica" in lab.lower() else "teatro" if re.search(r"teatro|danza", lab, re.I) else cat
        out.append(Event(
            title=clean(title_el.get_text(" ", strip=True)), cat=ev_cat,
            venue=f"Auditorium Parco della Musica{' · ' + sala if sala and sala != 'AuditoriumArte' else ''}",
            address="Viale Pietro de Coubertin 30, Roma", start=start, end=start, time=time,
            url=urljoin(base, link["href"]), source=source, description=lab))
    return out


def fetch_auditorium(src: dict, max_pages: int = 8) -> list[Event]:
    out: list[Event] = []
    for n in range(1, max_pages + 1):
        url = "https://www.auditorium.com/it/eventi/" + (f"page/{n}/" if n > 1 else "")
        try:
            r = polite_get(url)
        except Exception:
            break
        evs = parse_auditorium(_text(r.content), url, src["cat"], src["id"])
        if not evs:
            break
        out += evs
    return out


# ------------------------------------------------------------------ Teatro dell'Opera di Roma
def _infer_year(month: int, day: int, today: date) -> str | None:
    """Le date dell'Opera non riportano l'anno: scelgo quello che le colloca da 30 giorni fa in avanti."""
    for y in (today.year, today.year + 1):
        d = _d(y, month, day)
        if d and date.fromisoformat(d) >= today - timedelta(days=30):
            return d
    return None


def parse_opera_show(html: str, url: str, cat: str, source: str, today: date | None = None) -> list[Event]:
    today = today or date.today()
    soup = _soup(html)
    title = clean((soup.title.get_text() if soup.title else "").split("|")[0])
    if not title:
        return []
    crumbs = soup.get_text(" | ", strip=True)
    genre = re.search(r"Stagione \d{4}\s*/\s*\d{4}\s*\|\s*›?\s*\|?\s*(Opere in Concerto|Opere|Balletti|Concerti|Extra|Teatro)", crumbs)
    g = genre.group(1) if genre else ""
    ev_cat = "teatro" if g == "Balletti" else cat
    desc = soup.find("meta", attrs={"name": "description"})
    description = clean(desc["content"]) if desc and desc.get("content") else ""
    out = []
    for li in soup.select("ul.datelist li"):
        giorno, mese = li.select_one(".giorno"), li.select_one(".mese")
        if not (giorno and mese and _month(mese.get_text(strip=True))):
            continue
        start = _infer_year(_month(mese.get_text(strip=True)), int(re.sub(r"\D", "", giorno.get_text()) or 0), today)
        if not start:
            continue
        t = re.search(r"ORE\s*(\d{1,2})[:.](\d{2})", li.get_text(" ", strip=True), re.I)
        out.append(Event(
            title=title, cat=ev_cat, venue="Teatro dell'Opera di Roma", address="Piazza Beniamino Gigli 7, Roma",
            start=start, end=start, time=f"{int(t.group(1)):02d}:{t.group(2)}" if t else None,
            url=url, source=source, description=description))
    return out


def fetch_opera(src: dict, max_shows: int = 45) -> list[Event]:
    home = polite_get(src["link"])
    soup = _soup(_text(home.content))
    links = []
    for a in soup.find_all("a", href=True):
        u = urljoin(src["link"], a["href"]).split("#")[0].replace("http://", "https://")
        if "/spettacoli/" in u and u.rstrip("/") != "https://www.operaroma.it/spettacoli" and u not in links:
            links.append(u)
    out: list[Event] = []
    for u in links[:max_shows]:
        try:
            r = polite_get(u)
        except Exception:
            continue
        out += parse_opera_show(_text(r.content), u, src["cat"], src["id"])
    return out


# ------------------------------------------------------------------ Roma Culture (culture.roma.it)
_SEZ_CAT = {"arte": "mostre", "cinema": "cinema", "musica": "musica", "teatro": "teatro", "danza": "teatro",
            "incontri": "altro", "kids": "altro"}
MAX_RANGE_DAYS = 120  # le rassegne "tutto l'anno" riempirebbero ogni giorno: le escludo


def parse_culture_items(html: str, base: str, source: str) -> list[Event]:
    out = []
    for item in _soup(html).select("div.archivio_item"):
        h2 = item.select_one("h2.page_title a")
        gcal = item.select_one("a[href*='calendar.google.com']")
        if not (h2 and gcal):
            continue
        q = parse_qs(urlparse(gcal["href"]).query)
        m = re.match(r"(\d{8})(?:T(\d{4})\d{2})?/(\d{8})(?:T(\d{4})\d{2})?", (q.get("dates") or [""])[0])
        if not m:
            continue
        s, st, e, et = m.groups()
        start, end = f"{s[:4]}-{s[4:6]}-{s[6:]}", f"{e[:4]}-{e[4:6]}-{e[6:]}"
        if (date.fromisoformat(end) - date.fromisoformat(start)).days > MAX_RANGE_DAYS:
            continue
        time = f"{st[:2]}:{st[2:]}" if st and st != "0000" and start == end else None
        sez = next((c[4:] for c in (item.select_one(".slide_title") or {"class": []}).get("class", []) if c.startswith("sez-") and c != "sez-tutti"), "")
        luogo, loc = item.select_one(".luogo_title"), item.select_one(".location")
        kind = "mostra" if start != end and sez == "arte" else "evento"
        out.append(Event(
            title=clean(h2.get_text(" ", strip=True)), cat=_SEZ_CAT.get(sez, "altro"), kind=kind,
            venue=clean(luogo.get_text(" ", strip=True)) if luogo else "Roma", address=clean(loc.get_text(" ", strip=True)) if loc else "",
            start=start, end=end, time=time, url=urljoin(base, h2["href"]), source=source,
            description=clean(unquote((q.get("details") or [""])[0]).split(" Scopri di più")[0])))
    return out


def fetch_culture(src: dict, max_pages: int = 60) -> list[Event]:
    """Elenco delle manifestazioni -> ogni pagina manifestazione contiene i suoi appuntamenti."""
    base = "https://culture.roma.it"
    seen_pages, out, seen_urls = [], [], set()
    for n in range(1, 4):  # elenco paginato
        url = src["link"] if n == 1 else f"{src['link'].rstrip('/')}/page/{n}/"
        r = None
        for _ in range(2):  # il sito è lento: un secondo tentativo
            try:
                r = polite_get(url)
                break
            except Exception:
                continue
        if r is None:
            break
        soup = _soup(_text(r.content))
        found = [urljoin(base, a["href"]) for a in soup.find_all("a", href=re.compile(r"/manifestazione/[^/]+/?$"))]
        new = [u for u in dict.fromkeys(found) if u not in seen_pages and u.rstrip("/") != src["link"].rstrip("/")]
        if not new:
            break
        seen_pages += new
    for u in seen_pages[:max_pages]:
        try:
            r = polite_get(u)
        except Exception:
            continue
        for e in parse_culture_items(_text(r.content), base, src["id"]):
            if e.url + e.start not in seen_urls:
                seen_urls.add(e.url + e.start)
                out.append(e)
    return out


# ------------------------------------------------------------------ Teatro di Roma
_TDR_PIECE = re.compile(r"(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?")


def _tdr_range(txt: str) -> tuple[str, str] | None:
    """'8 – 9 ott 2026' | '10 set – 6 ott 2026' | '07 ott 2026 – 16 feb 2027' | '11 ott 2026'."""
    parts = [p.strip() for p in re.split(r"\s[–-]\s", txt) if p.strip()]
    if not parts:
        return None
    m2 = _TDR_PIECE.fullmatch(parts[-1])
    if not (m2 and m2.group(2) and m2.group(3) and _month(m2.group(2))):
        return None
    end_d, end_m, end_y = int(m2.group(1)), _month(m2.group(2)), int(m2.group(3))
    end = _d(end_y, end_m, end_d)
    if len(parts) == 1:
        return (end, end) if end else None
    m1 = _TDR_PIECE.fullmatch(parts[0])
    if not (m1 and end):
        return None
    sm = _month(m1.group(2)) if m1.group(2) else end_m
    sy = int(m1.group(3)) if m1.group(3) else (end_y - 1 if sm > end_m else end_y)
    start = _d(sy, sm, int(m1.group(1)))
    return (start, end) if start else None


def parse_teatrodiroma(html: str, base: str, cat: str, source: str) -> list[Event]:
    out = []
    for card in _soup(html).select("div.w-full.max-w-sm"):
        t = card.find("time")
        link = card.select_one("a[href] h5")
        if not (t and link):
            continue
        rng = _tdr_range(t.get_text(" ", strip=True))
        if not rng:
            continue
        venue = card.select_one("h5.text-crimson-500")
        v = clean(venue.get_text(" ", strip=True)) if venue else ""
        out.append(Event(
            title=clean(link.get_text(" ", strip=True)), cat=cat, venue=f"Teatro di Roma · {v}" if v else "Teatro di Roma",
            start=rng[0], end=rng[1], url=urljoin(base, link.find_parent("a")["href"]), source=source))
    return out


def fetch_teatrodiroma(src: dict, max_pages: int = 8) -> list[Event]:
    out: list[Event] = []
    for n in range(1, max_pages + 1):
        url = "https://www.teatrodiroma.net/calendario/" + (f"page/{n}/" if n > 1 else "")
        try:
            r = polite_get(url)
        except Exception:
            break
        evs = parse_teatrodiroma(_text(r.content), url, src["cat"], src["id"])
        if not evs or (n > 1 and {e.url for e in evs} <= {e.url for e in out}):
            break
        out += evs
    return out


# ------------------------------------------------------------------ Casa del Cinema
def parse_casadelcinema(html: str, base: str, cat: str, source: str) -> list[Event]:
    """Slider della home: .gt-slide-inner con titolo, una o due date (inizio/fine) e link /it/event/."""
    out, seen = [], set()
    for sl in _soup(html).select(".gt-slide-inner"):
        t, a = sl.select_one(".gt-title"), sl.select_one(".buttons a[href]")
        if not (t and a):
            continue
        ds = []
        for li in sl.select(".gt-information li"):
            m = _MAXXI_DATE.search(li.get_text(" ", strip=True))
            if m and _month(m.group(2)):
                d = _d(int(m.group(3)), _month(m.group(2)), int(m.group(1)))
                if d:
                    ds.append(d)
        if not ds or a["href"] in seen:
            continue
        seen.add(a["href"])
        st = sl.select_one(".gt-event-status")
        out.append(Event(
            title=clean(t.get_text(" ", strip=True)), cat=cat, venue="Casa del Cinema",
            address="Largo Marcello Mastroianni 1, Roma", start=ds[0], end=ds[-1],
            url=urljoin(base, a["href"]), source=source, kind="evento",
            description=clean(st.get_text(" ", strip=True)) if st else ""))
    return out


def fetch_casadelcinema(src: dict) -> list[Event]:
    r = polite_get(src["link"])
    return parse_casadelcinema(_text(r.content), src["link"], src["cat"], src["id"])


# ------------------------------------------------------------------ Palazzo Barberini / Galleria Corsini
def parse_barberini(html: str, base: str, cat: str, source: str, today: date | None = None) -> list[Event]:
    """Card 'fino al 11 Ottobre 2026' + sede: l'inizio non e' indicato, uso oggi."""
    today = today or date.today()
    out = []
    for art in _soup(html).select("article.a11y_card"):
        a = art.select_one("a.card_title[href]")
        d = art.select_one(".date")
        if not (a and d):
            continue
        m = _MAXXI_DATE.search(d.get_text(" ", strip=True))
        if not (m and _month(m.group(2))):
            continue
        end = _d(int(m.group(3)), _month(m.group(2)), int(m.group(1)))
        if not end or date.fromisoformat(end) < today:
            continue
        if (date.fromisoformat(end) - today).days > MAX_RANGE_DAYS:
            continue
        sede = art.select_one(".sede")
        ex = art.select_one(".excerpt")
        out.append(Event(
            title=clean(a.get_text(" ", strip=True)), cat=cat,
            venue=clean(sede.get_text(" ", strip=True)).title() if sede else "Gallerie Nazionali Barberini Corsini",
            address="Via delle Quattro Fontane 13, Roma", start=today.isoformat(), end=end, url=a["href"], source=source,
            kind="mostra", description=clean(ex.get_text(" ", strip=True)) if ex else ""))
    return out


def fetch_barberini(src: dict) -> list[Event]:
    r = polite_get(src["link"])
    return parse_barberini(_text(r.content), src["link"], src["cat"], src["id"])


# ------------------------------------------------------------------ Palazzo Merulana
def parse_merulana(html: str, base: str, cat: str, source: str) -> list[Event]:
    """Card .cards.card-short con data gg/mm/aaaa (solo date singole; 'Dal ...' senza fine e' escluso)."""
    out = []
    for c in _soup(html).select(".cards.card-short"):
        a, d, t = c.select_one("a.card-content[href]"), c.select_one(".pre-title .date"), c.select_one(".post-title")
        if not (a and d and t):
            continue
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", d.get_text(strip=True))
        if not m:
            continue
        start = _d(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if start:
            out.append(Event(title=clean(t.get_text(" ", strip=True)), cat=cat, venue="Palazzo Merulana",
                             address="Via Merulana 121, Roma", start=start, end=start, url=a["href"], source=source))
    return out


def fetch_merulana(src: dict) -> list[Event]:
    r = polite_get(src["link"])
    return parse_merulana(_text(r.content), src["link"], src["cat"], src["id"])


# ------------------------------------------------------------------ Teatro Quirino
def parse_quirino(html: str, base: str, cat: str, source: str) -> list[Event]:
    """Calendario mensile (Events Manager): una cella per giorno con titolo e link."""
    out = []
    for cell in _soup(html).select(".em-cal-day.eventful"):
        ts = cell.select_one("[data-calendar-date]")
        if not ts:
            continue
        try:
            day = date.fromtimestamp(int(ts["data-calendar-date"]) + 12 * 3600)
        except (ValueError, OverflowError):
            continue
        for ev in cell.select(".em-cal-event"):
            a = ev.select_one("a[href]")
            if a:
                out.append(Event(title=clean(a.get_text(" ", strip=True)), cat=cat, venue="Teatro Quirino",
                                 address="Via delle Vergini 7, Roma", start=day.isoformat(), end=day.isoformat(),
                                 url=a["href"], source=source))
    return out


def fetch_quirino(src: dict, months: int = 4) -> list[Event]:
    out: list[Event] = []
    today = date.today()
    y, m = today.year, today.month
    for _ in range(months):
        url = f"https://www.teatroquirino.it/calendario/?mo={m}&yr={y}"
        try:
            r = polite_get(url)
        except Exception:
            break
        out += parse_quirino(_text(r.content), url, src["cat"], src["id"])
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


SITES = {
    "maxxi": fetch_maxxi,
    "auditorium-parco-della-musica": fetch_auditorium,
    "teatro-dell-opera-di-roma": fetch_opera,
    "roma-culture-manifestazioni": fetch_culture,
    "teatro-di-roma-argentina-india": fetch_teatrodiroma,
    "casa-del-cinema": fetch_casadelcinema,
    "gallerie-nazionali-barberini-corsini": fetch_barberini,
    "palazzo-merulana": fetch_merulana,
    "teatro-quirino": fetch_quirino,
}
