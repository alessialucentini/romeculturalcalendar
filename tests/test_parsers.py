import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scraper"))
import ics, jsonld
from common import parse_iso, Event

FX = Path(__file__).parent / "fixtures"
KW = dict(cat="teatro", default_venue="Default", source="t")

def test_jsonld():
    evs = jsonld.parse((FX / "pagina_jsonld.html").read_text(), "https://x.it/eventi", **KW)
    assert [e.title for e in evs] == ["La locandiera", "Sole nero"]      # niente Organization, niente evento senza data, JSON rotto ignorato
    a, b = evs
    assert (a.start, a.time, a.venue) == ("2026-10-12", "19:30", "Teatro Argentina")
    assert a.description == "Goldoni, regia di Tizio ." or a.description.startswith("Goldoni")
    assert a.url == "https://x.it/spettacoli/locandiera" and "Largo di Torre Argentina" in a.address
    assert (b.kind, b.end, b.time, b.venue) == ("mostra", "2027-01-18", None, "MAXXI")

def test_ics():
    evs = ics.parse((FX / "feed.ics").read_bytes(), "https://x.it", **KW)
    talk, mostra = evs
    assert (talk.start, talk.venue) == ("2026-10-13", "Fondazione Memmo") and talk.time == "19:00"   # 17:00Z -> ora di Roma (CEST)
    assert (mostra.start, mostra.end, mostra.kind) == ("2026-10-01", "2026-10-10", "mostra")   # DTEND esclusivo

def test_dates_and_ids():
    assert parse_iso("2026-10-12T00:00:00") == ("2026-10-12", None)
    assert parse_iso("2026-13-45") == (None, None)
    e1 = Event(title="A", cat="teatro", venue="V", start="2026-10-01", end="2026-10-01", url="u", source="s1")
    e2 = Event(title=" a ", cat="teatro", venue="v", start="2026-10-01", end="2026-10-01", url="u2", source="s2")
    assert e1.id == e2.id   # stesso evento da due fonti = stesso id (dedup leggero)

def test_sites():
    """Parser dedicati su HTML reale salvato in data/samples (scaricato dal workflow in modalità sample)."""
    import datetime
    import sites
    S = Path(__file__).resolve().parent.parent / "data" / "samples"
    rd = lambda p: (S / p).read_text(encoding="utf-8")  # noqa: E731
    if not S.exists():
        return
    assert len(sites.parse_maxxi(rd("maxxi/1.html"), "https://www.maxxi.art", "contemporanea", "MAXXI", "maxxi")) >= 20
    assert len(sites.parse_auditorium(rd("auditorium-parco-della-musica/1.html"), "https://www.auditorium.com", "musica", "a")) >= 10
    o = sites.parse_opera_show(rd("teatro-dell-opera-di-roma/3.html"), "u", "opera", "o", today=datetime.date(2026, 10, 1))
    assert o and o[0].start == "2026-10-11" and o[0].time == "19:00"
    assert len(sites.parse_culture_items(rd("roma-culture-manifestazioni/3.html"), "https://culture.roma.it", "c")) > 50
    E = S / "extra"
    if E.exists():
        rx = lambda n: (E / n).read_text(encoding="utf-8")  # noqa: E731
        c = sites.parse_casadelcinema(rx("8.html"), "https://www.casadelcinema.it", "cinema", "c")
        assert len(c) >= 15 and c[0].start <= c[0].end
        assert len(sites.parse_barberini(rx("6.html"), "u", "mostre", "b", today=datetime.date(2026, 10, 1))) >= 2
        assert len(sites.parse_merulana(rx("5.html"), "u", "altro", "m")) >= 10
        a = sites.parse_arteit(rx("0.html"), "https://www.arte.it", "mostre", "a")
        assert len(a) >= 30 and a[0].start == "2026-10-01"
        q = sites.parse_quirino(rx("2.html"), "u", "teatro", "q")
        assert len(q) >= 10 and q[0].start == "2026-10-20"
    assert sites._tdr_range("10 set – 6 ott 2026") == ("2026-09-10", "2026-10-06")
    assert sites._tdr_range("07 ott 2026 – 16 feb 2027") == ("2026-10-07", "2027-02-16")



if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
