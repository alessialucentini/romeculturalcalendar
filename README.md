# Roma oggi

PWA gratuita: apri l'icona sul telefono e vedi **cosa succede oggi a Roma** (opera, teatro, cinema, musei, arte contemporanea, festival…), con un colore per categoria. Ogni evento rimanda alla pagina originale. I dati si aggiornano da soli ogni domenica.

```
web/                       l'app (HTML/CSS/JS puro, nessuna dipendenza) → pubblicata su GitHub Pages
  data/events.json         il "database": lo scrive lo scraper, lo legge l'app
scraper/                   run.py (scraping) · probe.py (analisi fonti) · jsonld.py · ics.py · common.py
data/sources.csv           le fonti (115, dal radar culturale) con categoria/colore e flag enabled
data/eventi_manuali.json   eventi inseriti a mano (festival, grandi mostre): vengono sempre inclusi
data/raw_strutture_2023.csv  strutture di Rome Art Week 2023, da usare come indice di nuove fonti
.github/workflows/         aggiornamento settimanale + pubblicazione
```

## Messa online (0 €, circa 10 minuti)

1. Su GitHub crea un repository **pubblico** (Pages gratuito richiede repo pubblico) e carica tutto il contenuto di questa cartella.
2. *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. *Actions → "Aggiorna eventi e pubblica" → Run workflow → mode = **probe***.
   Dopo un minuto trovi `data/probe_report.md`: per ogni fonte dice se ha JSON-LD/ICS/RSS (facile) o se serve un parser dedicato.
4. In `data/sources.csv` metti `enabled = si` sulle fonti marcate FACILE, poi rilancia il workflow con mode = **scrape**.
5. L'app è su `https://<tuo-utente>.github.io/<repo>/`. Da lì si aggiorna ogni domenica (cron `0 3 * * 0`).

**Installarla sul telefono** — iPhone: Safari → Condividi → *Aggiungi alla schermata Home*. Android: Chrome → ⋮ → *Installa app*.

## Come funziona lo scraping

Per ogni fonte abilitata: scarica la pagina → cerca eventi **JSON-LD (schema.org)** → se non ci sono cerca un feed **.ics** linkato → altrimenti segnala "serve un parser". Regole di buona educazione: legge `robots.txt`, 2 secondi di pausa per sito, User-Agent dichiarato.

- Una fonte che si rompe **non cancella** i suoi eventi precedenti.
- Gli eventi finiti da più di 7 giorni spariscono.
- Lo stesso evento da due fonti (stesso titolo + luogo + giorno + ora) diventa una voce sola; quelli diversi restano tutti (le sovrapposizioni vanno bene).
- Per una fonte senza JSON-LD/ICS: aggiungi `scraper/<fonte>.py` con `parse(html, url, cat, default_venue, source) -> list[Event]` e chiamala in `run.py:scrape_source`.

## Modello dati (un evento)

`title · cat · kind (evento|mostra|festival) · venue · address · start · end · time · description · url · source · note · checked`

Mostre e festival hanno `start ≠ end` e compaiono in **In corso**; gli eventi con orario in **In programma**.
Colori: opera (rosso) · teatro/danza (giallo) · cinema (blu) · arte contemporanea (verde) · mostre (viola) · libri (arancio) · istituti (rosa) · community (marrone) · concerti (teal) · altro (grigio).

## Stato dei dati (1 ottobre 2026)

`eventi_manuali.json` contiene 16 festival e grandi mostre trovati il 1/10/2026 con ricerca web; i campi `note` segnalano le date da verificare (Rome Art Week, Roma Jazz Festival, apertura Festa del Cinema). Gli eventi serali singoli (talk, opening, spettacoli) arriveranno dagli scraper una volta abilitate le fonti.

## Limiti da sapere

- Instagram, run club e simili **non** sono scrapabili in modo affidabile/lecito: vanno inseriti a mano.
- Siti che caricano gli eventi con JavaScript o stanno dietro Cloudflare/CAPTCHA non si leggono con questo metodo.
- Gli scraper sono stati verificati solo su pagine di prova locali: il primo test sui siti reali è il *probe* del punto 3.
- GitHub può sospendere i workflow schedulati dopo 60 giorni senza attività nel repo: basta riattivarli da *Actions*.

## Provarla in locale

```
pip install -r requirements.txt
python tests/test_parsers.py
python scraper/run.py --only __none__     # rigenera events.json dai soli eventi manuali
cd web && python -m http.server 8000      # apri http://localhost:8000
```
