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

if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
