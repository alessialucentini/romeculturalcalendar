/* Linceo — legge data/events.json e lo mostra. Nessuna dipendenza, nessun tracciamento. */
(() => {
  "use strict";

  const CATS = {
    opera: "Opera / classica", teatro: "Teatro / danza", cinema: "Cinema", contemporanea: "Arte contemporanea",
    mostre: "Mostre", libri: "Libri", istituti: "Istituti culturali", community: "Community", musica: "Concerti", altro: "Altro",
  };
  const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  const DOW = ["L", "M", "M", "G", "V", "S", "D"];

  const $ = (s) => document.querySelector(s);
  const state = { events: [], meta: null, view: "oggi", prev: "oggi", q: "", cap: 60, hidden: new Set(), saved: new Set(), runs: new Map(), month: null, picked: null, now: new Date() };

  // ---------- util ----------
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const longDay = (d) => `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
  const shortDate = (s) => { const d = fromIso(s); return `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}`; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } },
  };

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "style") n.setAttribute("style", v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  }

  const ICONS = {
    heart: '<path d="M12 20.5s-7.6-4.7-9.6-9.4C.9 7.7 2.7 4.5 6 4.5c2.1 0 3.4 1.1 4.1 2.3h3.8c.7-1.2 2-2.3 4.1-2.3 3.3 0 5.1 3.2 3.6 6.6-2 4.7-9.6 9.4-9.6 9.4z"/>',
    share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
    mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  };
  function icon(name) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[name];
    return s;
  }
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // "serie": stesso titolo nello stesso luogo = una produzione con più date (repliche, proiezioni)
  const sKey = (e) => { const s = `${norm(e.title)}|${norm(e.venue)}`; let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
  function buildRuns() {
    state.runs = new Map();
    for (const e of state.events) { e._k = sKey(e); if (!state.runs.has(e._k)) state.runs.set(e._k, []); state.runs.get(e._k).push(e); }
    for (const a of state.runs.values()) a.sort((x, y) => x.start.localeCompare(y.start) || (x.time || "").localeCompare(y.time || ""));
  }
  const occLabel = (o) => `${shortDate(o.start)}${o.time ? " " + o.time : ""}`;
  const toastEl = () => $("#toast");
  let toastT = 0;
  function toast(msg) { const t = toastEl(); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400); }
  const saveSaved = () => { store.set("saved", JSON.stringify([...state.saved])); syncSaved(); };
  function syncSaved() {
    const n = state.saved.size, b = $("#savedCount");
    if (b) { b.textContent = String(n); b.hidden = n === 0; }
    const btn = $("#savedBtn"); if (btn) btn.setAttribute("aria-pressed", String(state.view === "salvati" && !state.q));
  }
  const SHARE_URL = () => location.origin + location.pathname;
  async function shareEvent(e) {
    const link = safeUrl(e.url) || SHARE_URL();
    const text = `Ehi, ho trovato questo evento su Linceo 👉 ${link}. Vieni con me? ☀️`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (err) { if (err && err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast("Messaggio copiato: incollalo dove vuoi"); }
    catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener"); }
  }

  // ---------- dati ----------
  const visible = () => state.events.filter((e) => !state.hidden.has(e.cat));
  const onDay = (list, day) => list.filter((e) => e.start <= day && day <= e.end);
  const isRange = (e) => e.kind === "festival" || e.kind === "mostra" || e.start !== e.end;

  // ---------- aggiungi al calendario ----------
  const p2 = (n) => String(n).padStart(2, "0");
  const compact = (s) => s.replaceAll("-", "");
  // ora di Roma -> istante UTC (corretto anche con l'ora legale)
  function romeToUtc(day, time) {
    const [y, m, d] = day.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(guess));
    const g = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
    return new Date(guess - (Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute) - guess));
  }
  const utcStamp = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
  function calData(e) {
    const where = [e.venue, e.address].filter(Boolean).join(", ");
    const details = [e.description, e.url ? `Info: ${e.url}` : "", "Da Linceo"].filter(Boolean).join("\n\n");
    if (e.time && !isRange(e)) {
      const s = romeToUtc(e.start, e.time), en = new Date(s.getTime() + 2 * 3600e3);
      return { e, where, details, allDay: false, s, en };
    }
    const last = addDays(fromIso(e.end || e.start), 1); // fine esclusiva
    return { e, where, details, allDay: true, s: e.start, en: iso(last) };
  }
  function googleUrl(c) {
    const q = new URLSearchParams({ action: "TEMPLATE", text: c.e.title, details: c.details, location: c.where });
    q.set("dates", c.allDay ? `${compact(c.s)}/${compact(c.en)}` : `${utcStamp(c.s)}/${utcStamp(c.en)}`);
    return `https://calendar.google.com/calendar/render?${q}`;
  }
  function outlookUrl(c, host) {
    const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: c.e.title, body: c.details, location: c.where });
    if (c.allDay) { q.set("allday", "true"); q.set("startdt", c.s); q.set("enddt", c.en); }
    else { q.set("startdt", c.s.toISOString()); q.set("enddt", c.en.toISOString()); }
    return `https://${host}/calendar/0/deeplink/compose?${q}`;
  }
  const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line) => line.length <= 73 ? line : line.match(/.{1,73}/gu).join("\r\n ");
  function icsText(c) {
    const uid = `${c.e.id || compact(c.e.start) + p2(c.e.title.length)}@linceo`;
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Linceo//Roma//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utcStamp(new Date())}`];
    if (c.allDay) L.push(`DTSTART;VALUE=DATE:${compact(c.s)}`, `DTEND;VALUE=DATE:${compact(c.en)}`);
    else L.push(`DTSTART:${utcStamp(c.s)}`, `DTEND:${utcStamp(c.en)}`);
    L.push(`SUMMARY:${esc(c.e.title)}`, `LOCATION:${esc(c.where)}`, `DESCRIPTION:${esc(c.details)}`);
    if (safeUrl(c.e.url)) L.push(`URL:${c.e.url}`);
    L.push("END:VEVENT", "END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }
  function openIcs(c) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const name = `${c.e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "evento"}.ics`;
    // file vero generato dallo scraper (web/ics/<id>.ics): iPhone lo apre direttamente nel Calendario
    const href = c.e.id ? new URL(`ics/${c.e.id}.ics`, location.href).href : `data:text/calendar;charset=utf-8,${encodeURIComponent(icsText(c))}`;
    const a = el("a", { href, download: ios ? null : name, target: ios ? "_blank" : null, rel: "noopener" });
    document.body.append(a); a.click(); a.remove();
  }

  let sheet = null;
  function closeSheet() { if (!sheet) return; const s = sheet; sheet = null; s.classList.remove("show"); setTimeout(() => s.remove(), 220); document.removeEventListener("keydown", onKey); if (s._from) s._from.focus(); }
  function onKey(ev) { if (ev.key === "Escape") closeSheet(); }
  function openSheet(e, from) {
    closeSheet();
    const c = calData(e);
    const opt = (label, hint, act) => el("button", { class: "sheet-opt", type: "button", onclick() { act(); closeSheet(); } }, el("b", { text: label }), el("small", { text: hint }));
    const when = isRange(e) ? `${shortDate(e.start)} – ${shortDate(e.end)}` : `${shortDate(e.start)}${e.time ? " · " + e.time : ""}`;
    sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Aggiungi sul mio calendario", onclick(ev) { if (ev.target === ev.currentTarget) closeSheet(); } },
      el("div", { class: "sheet-card" },
        el("div", { class: "sheet-grip", "aria-hidden": "true" }),
        el("h3", { text: "Aggiungi sul mio calendario" }),
        el("p", { class: "sheet-ev", text: `${e.title} · ${when}` }),
        opt("Apple Calendar", "iPhone, iPad, Mac", () => openIcs(c)),
        opt("Google Calendar", "si apre nel browser", () => window.open(googleUrl(c), "_blank", "noopener")),
        opt("Outlook", "outlook.com, Hotmail", () => window.open(outlookUrl(c, "outlook.live.com"), "_blank", "noopener")),
        opt("Outlook di lavoro", "Microsoft 365", () => window.open(outlookUrl(c, "outlook.office.com"), "_blank", "noopener")),
        el("button", { class: "sheet-cancel", type: "button", text: "Annulla", onclick: closeSheet })));
    sheet._from = from;
    document.body.append(sheet);
    requestAnimationFrame(() => { sheet && sheet.classList.add("show"); sheet && sheet.querySelector(".sheet-opt").focus(); });
    document.addEventListener("keydown", onKey);
  }

  // "NEW": evento comparso per la prima volta nell'ultimo aggiornamento (entro 7 giorni da quando l'ha visto lo scraper)
  const isNew = (e) => { if (!e.first_seen) return false; const d = (new Date(iso(state.now)) - new Date(e.first_seen)) / 864e5; return d >= 0 && d <= 7; };

  // ---------- componenti ----------
  function card(e, ctx = {}) {
    const col = `var(--c-${CATS[e.cat] ? e.cat : "altro"})`;
    const open = { v: false };
    const desc = e.description ? el("p", { class: "desc", text: e.description }) : null;
    const moreBtn = e.description && e.description.length > 130
      ? el("button", { class: "more", type: "button", "aria-expanded": "false", text: "Leggi tutto", onclick(ev) {
          open.v = !open.v; ev.target.closest(".card").classList.toggle("open", open.v);
          ev.target.textContent = open.v ? "Meno" : "Leggi tutto"; ev.target.setAttribute("aria-expanded", String(open.v));
        } })
      : null;
    const url = safeUrl(e.url);
    const when = isRange(e)
      ? el("div", { class: "when" }, "fino", el("small", { text: shortDate(e.end) }))
      : el("div", { class: "when" }, e.time || "—", e.time ? null : el("small", { text: "giornata" }));
    const isSaved = state.saved.has(e._k);
    const heart = el("button", { class: "ib heart", type: "button", "aria-pressed": String(isSaved), "aria-label": isSaved ? "Rimuovi dai salvati" : "Salva evento", onclick(ev) {
      const b = ev.currentTarget, on = !state.saved.has(e._k);
      on ? state.saved.add(e._k) : state.saved.delete(e._k);
      b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Rimuovi dai salvati" : "Salva evento");
      b.classList.remove("pop"); void b.offsetWidth; if (on) b.classList.add("pop");
      saveSaved();
      if (window.LinceoAuth) window.LinceoAuth.setSaved(e._k, on);
      if (!on && state.view === "salvati" && !state.q) setTimeout(() => swap(render), 260);
    } }, icon("heart"));
    const times = ctx.times && ctx.times.length > 1 ? el("div", { class: "runs" }, el("b", { text: "Orari" }), ctx.times.join(" · ")) : null;
    const others = ctx.others && ctx.others.length
      ? el("div", { class: "runs" }, el("b", { text: "Altre date" }), ctx.others.slice(0, 4).map(occLabel).join(" · "), ctx.others.length > 4 ? ` · +${ctx.others.length - 4}` : "")
      : null;
    const fresh = isNew(e) || (state.runs.get(e._k) || []).some(isNew);
    return el("article", { class: "card" + (fresh ? " is-new" : ""), style: `--col:${col}` },
      fresh ? el("span", { class: "new-tag", text: "NEW" }) : null,
      when,
      el("div", {},
        el("h3", { text: e.title }),
        el("div", { class: "where", text: [e.venue, e.address].filter(Boolean).join(" · ") }),
        el("div", { class: "badges" },
          el("span", { class: "badge", text: CATS[e.cat] || "Altro" }),
          e.kind !== "evento" ? el("span", { class: "badge kind", text: e.kind }) : null),
        times, others,
        desc,
        e.note ? el("p", { class: "note", text: `Da verificare: ${e.note}` }) : null,
        el("div", { class: "actions" },
          el("button", { class: "go cal", type: "button", text: "Aggiungi sul mio calendario", onclick(ev) { openSheet(e, ev.currentTarget); } })),
        el("div", { class: "links" },
          url ? el("a", { class: "go", href: url, target: "_blank", rel: "noopener noreferrer", text: "Vedi evento →" }) : null,
          moreBtn)),
      el("div", { class: "ib-group" }, heart,
        el("button", { class: "ib share", type: "button", "aria-label": "Condividi con un amico", onclick() { shareEvent(e); } }, icon("share"))));
  }

  function daySection(date, { heading } = {}) {
    const day = iso(date);
    const items = onDay(visible(), day);
    const timed = items.filter((e) => !isRange(e)).sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));
    const going = items.filter(isRange).sort((a, b) => (a.kind === "festival" ? 0 : 1) - (b.kind === "festival" ? 0 : 1) || a.end.localeCompare(b.end));
    const sec = el("section", { class: "day" }, el("h2", { text: heading || longDay(date) }));
    if (!items.length) {
      sec.append(el("div", { class: "empty" }, el("b", { text: "Niente in programma" }), "Prova a togliere qualche filtro o guarda un altro giorno."));
      return sec;
    }
    if (timed.length) {
      const groups = new Map();
      for (const e of timed) { if (!groups.has(e._k)) groups.set(e._k, []); groups.get(e._k).push(e); }
      const cards = [...groups.values()].map((g) => {
        const rep = g[0], later = (state.runs.get(rep._k) || []).filter((o) => !isRange(o) && o.start > day);
        return card(rep, { times: g.map((x) => x.time).filter(Boolean), others: later });
      });
      sec.append(el("div", { class: "sub", text: `In programma · ${cards.length}` }), ...cards);
    }
    if (going.length) { sec.append(el("div", { class: "sub", text: `In corso · ${going.length}` }), ...going.map((e) => card(e))); }
    return sec;
  }

  // ---------- movimento morbido ----------
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // cambia vista con una transizione (View Transitions API); dove non c'è, dissolvenza CSS
  function swap(fn, dir = "fade") {
    const main = $("#main");
    if (reduceMotion) { fn(); return; }
    if (document.startViewTransition) {
      document.documentElement.dataset.dir = dir;
      const t = document.startViewTransition(() => { fn(); });
      t.finished.finally(() => { delete document.documentElement.dataset.dir; });
    } else {
      fn(); main.classList.remove("fresh"); void main.offsetWidth; main.classList.add("fresh");
    }
  }
  // le schede compaiono con una dolce salita quando entrano nello schermo
  let cardIO = null;
  function revealCards() {
    const cards = [...document.querySelectorAll("#main .card:not(.seen)")];
    if (reduceMotion || !("IntersectionObserver" in window)) { cards.forEach((c) => c.classList.add("seen")); return; }
    if (!cardIO) {
      cardIO = new IntersectionObserver((es) => {
        let k = 0;
        es.filter((e) => e.isIntersecting).forEach((e) => { e.target.style.transitionDelay = `${Math.min(k++, 6) * 55}ms`; e.target.classList.add("seen"); cardIO.unobserve(e.target); });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
    }
    cards.forEach((c) => { const r = c.getBoundingClientRect(); const top = $("#app").getBoundingClientRect().top; if (top <= 0 && r.top < innerHeight) c.classList.add("seen"); else cardIO.observe(c); });
  }
  // la pillola dei tab scorre sotto il tab scelto
  function movePill() {
    const sel = document.querySelector('.tabs [aria-selected="true"]'), pill = $(".tab-pill");
    if (!sel || !pill) return;
    pill.style.setProperty("--x", `${sel.offsetLeft}px`); pill.style.setProperty("--w", `${sel.offsetWidth}px`);
  }
  window.addEventListener("resize", movePill);

  // elenco "per serie" (ricerca, salvati): una scheda per produzione, con le altre date
  function renderGrouped(list, empty) {
    const main = $("#main"); main.replaceChildren();
    if (!list.length) { main.append(el("div", { class: "empty" }, el("b", { text: empty[0] }), empty[1])); return; }
    const todayIso = iso(state.now), tomorrowIso = iso(addDays(state.now, 1));
    const shown = list.slice(0, state.cap), groups = new Map();
    for (const e of shown) {
      const key = isRange(e) && e.start <= todayIso ? "0" : e.start;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const [key, items] of groups) {
      const head = key === "0" ? "In corso" : key === todayIso ? "Oggi" : key === tomorrowIso ? `Domani · ${longDay(fromIso(key))}` : longDay(fromIso(key));
      main.append(el("section", { class: "day" }, el("h2", { text: head }),
        ...items.map((e) => card(e, { others: (state.runs.get(e._k) || []).filter((o) => !isRange(o) && (o.start > e.start || (o.start === e.start && (o.time || "") > (e.time || "")))) }))));
    }
    if (list.length > shown.length) {
      main.append(el("button", { class: "more-results", type: "button", text: `Mostra altri (${list.length - shown.length})`, onclick() { state.cap += 60; render(); } }));
    }
  }
  const upcoming = () => { const t = iso(state.now); return state.events.filter((e) => e.end >= t); };
  const firstPerSeries = (list) => {
    const m = new Map();
    for (const e of list) if (!m.has(e._k)) m.set(e._k, e);
    return [...m.values()].sort((a, b) => a.start.localeCompare(b.start) || (a.time || "").localeCompare(b.time || ""));
  };
  function renderSearch() {
    const toks = norm(state.q).split(/\s+/).filter(Boolean);
    // titolo, luogo e categoria: basta l'inizio della parola ("jaz" trova "jazz"); nella descrizione serve la parola intera
    const words = (s) => " " + norm(s).replace(/[^a-z0-9]+/g, " ") + " ";
    const hit = (e) => { const main = words(`${e.title} ${e.venue} ${e.address} ${CATS[e.cat] || ""} ${e.kind}`), desc = words(e.description); return toks.every((t) => main.includes(" " + t) || desc.includes(" " + t + " ")); };
    renderGrouped(firstPerSeries(upcoming().filter(hit)), [`Nessun risultato per “${state.q}”`, "Prova con un'altra parola, un luogo o una categoria."]);
  }
  function renderSaved() {
    const t = iso(state.now);
    const list = [...state.saved].map((k) => (state.runs.get(k) || []).find((o) => o.end >= t)).filter(Boolean);
    renderGrouped(list.sort((a, b) => a.start.localeCompare(b.start) || (a.time || "").localeCompare(b.time || "")),
      ["Nessun evento salvato", "Tocca il cuore su un evento per ritrovarlo qui."]);
  }

  // ---------- viste ----------
  // giorni mostrati nelle viste Oggi / Domani / Weekend
  function viewDays() {
    const t = new Date(state.now.getFullYear(), state.now.getMonth(), state.now.getDate());
    if (state.view === "oggi") return [t];
    if (state.view === "domani") return [addDays(t, 1)];
    const dow = t.getDay(); // weekend: prossimo sabato e domenica (se oggi è già weekend, include oggi)
    const sat = dow === 0 ? addDays(t, -1) : addDays(t, 6 - dow);
    return dow === 0 ? [t] : dow === 6 ? [t, addDays(t, 1)] : [sat, addDays(sat, 1)];
  }

  function renderList() {
    const main = $("#main"); main.replaceChildren();
    const days = viewDays(), t = days[0];
    if (state.view === "oggi") main.append(daySection(t, { heading: "Oggi" }));
    else if (state.view === "domani") main.append(daySection(t, { heading: `Domani · ${longDay(t)}` }));
    else days.forEach((d) => main.append(daySection(d)));
  }

  function renderCalendar() {
    const main = $("#main"); main.replaceChildren();
    const m = state.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // lunedì = 0
    const start = addDays(first, -lead);
    const list = visible();
    const grid = el("div", { class: "grid", role: "group", "aria-label": `${MESI[m.getMonth()]} ${m.getFullYear()}` }, DOW.map((d) => el("div", { class: "dow", "aria-hidden": "true", text: d })));
    const todayIso = iso(state.now);
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), key = iso(d);
      if (i >= 35 && d.getMonth() !== m.getMonth()) break;
      // pallini: eventi di un giorno e festival (le mostre lunghe non riempiono il calendario)
      const dayEv = onDay(list, key).filter((e) => !isRange(e) || e.kind === "festival");
      const cats = [...new Set(dayEv.map((e) => e.cat))];
      grid.append(el("button", {
        class: `cell${d.getMonth() !== m.getMonth() ? " out" : ""}${key === todayIso ? " today" : ""}`, type: "button",
        "aria-pressed": String(key === state.picked), "aria-label": `${longDay(d)}, ${dayEv.length} eventi`,
        onclick() { state.picked = key; swap(() => { renderCalendar(); revealCards(); }); },
      }, el("span", { class: "n", text: d.getDate() }),
      el("span", { class: "dots" }, cats.slice(0, 3).map((c) => el("i", { style: `--col:var(--c-${CATS[c] ? c : "altro"})` })), cats.length > 3 ? el("em", { text: `+${cats.length - 3}` }) : null)));
    }
    main.append(
      el("div", { class: "cal-head" },
        el("button", { type: "button", "aria-label": "Mese precedente", text: "‹", onclick() { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); swap(() => { renderCalendar(); revealCards(); }, "prev"); } }),
        el("h2", { text: `${MESI[m.getMonth()]} ${m.getFullYear()}` }),
        el("button", { type: "button", "aria-label": "Mese successivo", text: "›", onclick() { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); swap(() => { renderCalendar(); revealCards(); }, "next"); } })),
      grid,
      daySection(fromIso(state.picked)));
  }

  // ---------- mappa del giorno ----------
  let leafletP = null, map = null, pins = null, mapSeq = 0;
  function loadLeaflet() {
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.append(l);
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error("leaflet")); }; document.head.append(s);
    });
    return leafletP;
  }
  function openPlace(group) {
    closeSheet();
    const cards = group.items.map(({ e, times }) => { const c = card(e, { times }); c.classList.add("seen"); return c; });
    sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": group.venue, onclick(ev) { if (ev.target === ev.currentTarget) closeSheet(); } },
      el("div", { class: "sheet-card place" },
        el("div", { class: "sheet-grip", "aria-hidden": "true" }),
        el("h3", { text: group.venue }),
        el("p", { class: "sheet-ev", text: group.items.length > 1 ? `${group.items.length} eventi in questo luogo` : "Un evento in questo luogo" }),
        el("div", { class: "place-list" }, cards),
        el("button", { class: "sheet-cancel", type: "button", text: "Chiudi", onclick: closeSheet })));
    document.body.append(sheet);
    requestAnimationFrame(() => sheet && sheet.classList.add("show"));
    document.addEventListener("keydown", onKey);
  }
  async function updateMap() {
    const box = $("#mapbox"), seq = ++mapSeq;
    if (state.q || !["oggi", "domani", "weekend"].includes(state.view)) { box.hidden = true; return; }
    const days = viewDays().map(iso);
    const groups = new Map();
    for (const e of visible()) {
      if (e.lat == null || !days.some((d) => e.start <= d && d <= e.end)) continue;
      const k = `${e.lat},${e.lon}`;
      if (!groups.has(k)) groups.set(k, { lat: e.lat, lon: e.lon, venue: e.venue.split(" · ")[0], byKey: new Map() });
      const g = groups.get(k), it = g.byKey.get(e._k);
      if (it) { if (e.time) it.times.push(e.time); } else g.byKey.set(e._k, { e, times: e.time ? [e.time] : [] });
    }
    if (!groups.size) { box.hidden = true; return; }
    let L; try { L = await loadLeaflet(); } catch { box.hidden = true; return; }
    if (seq !== mapSeq) return;
    box.hidden = false;
    if (!map) {
      const touch = L.Browser.mobile;
      map = L.map("map", { zoomControl: !touch, scrollWheelZoom: false, dragging: !touch, attributionControl: true, zoomSnap: 0.5 });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap · © CARTO" }).addTo(map);
      pins = L.layerGroup().addTo(map);
    }
    pins.clearLayers();
    const pts = [];
    for (const g of groups.values()) {
      g.items = [...g.byKey.values()].sort((a, b) => (a.times[0] || "99").localeCompare(b.times[0] || "99"));
      g.items.forEach((it) => { it.times = [...new Set(it.times)].sort(); });
      const cats = new Set(g.items.map((it) => it.e.cat));
      const col = cats.size === 1 ? `var(--c-${CATS[[...cats][0]] ? [...cats][0] : "altro"})` : "var(--accent)";
      const n = g.items.length;
      const m = L.marker([g.lat, g.lon], { title: `${g.venue} · ${n}`, keyboard: true, icon: L.divIcon({ className: "pin", html: `<span style="--c:${col}">${n > 1 ? n : ""}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      m.on("click", () => openPlace(g));
      m.addTo(pins); pts.push([g.lat, g.lon]);
    }
    $("#mapNote").textContent = `${pts.length} ${pts.length === 1 ? "luogo" : "luoghi"} sulla mappa · tocca un pallino per aprire la scheda`;
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (pts.length === 1) map.setView(pts[0], 15, { animate: false });
      else map.fitBounds(pts, { padding: [30, 30], maxZoom: 15, animate: false });
    });
  }

  function render() {
    const special = !!state.q || state.view === "salvati";
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(!special && b.dataset.view === state.view)));
    $(".tabs").classList.toggle("none", special);
    if (state.q) renderSearch(); else if (state.view === "salvati") renderSaved();
    else if (state.view === "calendario") renderCalendar(); else renderList();
    syncSaved(); movePill(); revealCards(); updateMap();
  }
  const toTop = () => { const y = $("#app").offsetTop + $("#intro").offsetHeight; if (window.scrollY > y) window.scrollTo({ top: y, behavior: "instant" }); };

  function renderChips() {
    const used = new Set(state.events.map((e) => e.cat));
    const box = $("#chips"); box.replaceChildren();
    Object.entries(CATS).filter(([k]) => used.has(k)).forEach(([k, label]) => {
      box.append(el("button", {
        class: "chip", type: "button", style: `--dot:var(--c-${k})`, "aria-pressed": String(!state.hidden.has(k)),
        onclick(ev) {
          const b = ev.currentTarget;
          state.hidden.has(k) ? state.hidden.delete(k) : state.hidden.add(k);
          store.set("hidden", JSON.stringify([...state.hidden]));
          b.setAttribute("aria-pressed", String(!state.hidden.has(k))); b.classList.toggle("dim", state.hidden.has(k));
          swap(render);
        },
      }, el("i"), label));
    });
  }

  function header() {
    $("#today-label").textContent = longDay(state.now).replace(/^./, (c) => c.toUpperCase());
    const gen = state.meta && state.meta.generated ? new Date(state.meta.generated) : null;
    $("#stamp").textContent = gen ? `agg. ${gen.getDate()} ${MESI[gen.getMonth()].slice(0, 3)}` : "";
    const foot = $("#foot");
    foot.replaceChildren(
      gen ? `Dati aggiornati il ${gen.getDate()} ${MESI[gen.getMonth()]} ${gen.getFullYear()} · ${state.events.length} eventi` : "Dati non disponibili",
      el("br"), "Aggregatore non commerciale: ogni evento rimanda alla fonte originale.",
      el("br"), el("span", { class: "made", text: "fatto col ❤️ da Alessia Lucentini" }));
  }

  // ---------- ricerca e salvati nell'intestazione ----------
  function openSearch() {
    $(".brand").classList.add("searching"); $("#searchbox").hidden = false;
    requestAnimationFrame(() => { $("#searchbox").classList.add("on"); $("#q").focus(); });
  }
  function closeSearch(redraw = true) {
    $("#q").value = ""; state.q = ""; state.cap = 60;
    $("#searchbox").classList.remove("on"); $(".brand").classList.remove("searching");
    setTimeout(() => { if (!$(".brand").classList.contains("searching")) $("#searchbox").hidden = true; }, 250);
    if (redraw) swap(() => { render(); toTop(); });
  }
  function wireHeader() {
    $("#searchBtn").addEventListener("click", openSearch);
    $("#searchClose").addEventListener("click", () => closeSearch());
    $("#searchbox").addEventListener("submit", (ev) => { ev.preventDefault(); $("#q").blur(); });
    let t = 0;
    $("#q").addEventListener("input", (ev) => {
      clearTimeout(t);
      t = setTimeout(() => { const was = state.q; state.q = ev.target.value.trim(); state.cap = 60; if (was !== state.q) { render(); if (state.q) toTop(); } }, 140);
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && $(".brand").classList.contains("searching") && !sheet) closeSearch(); });
    $("#savedBtn").addEventListener("click", () => {
      if (state.q) closeSearch(false);
      if (state.view === "salvati") state.view = state.prev || "oggi"; else { state.prev = state.view; state.view = "salvati"; }
      swap(() => { render(); toTop(); }, state.view === "salvati" ? "next" : "prev");
    });
    syncSaved();
  }

  // ---------- salvati sincronizzati con l'account ----------
  window.addEventListener("linceo:saved", (ev) => {
    state.saved = new Set(ev.detail || []);
    saveSaved();
    if (state.events.length) render();
  });

  // ---------- avvio ----------
  async function init() {
    try { state.hidden = new Set(JSON.parse(store.get("hidden") || "[]")); } catch { state.hidden = new Set(); }
    try { state.saved = new Set(JSON.parse(store.get("saved") || "[]")); } catch { state.saved = new Set(); }
    document.querySelectorAll("[data-icon]").forEach((b) => b.prepend(icon(b.dataset.icon)));
    const saved = store.get("view"); if (["oggi", "domani", "weekend", "calendario"].includes(saved)) state.view = saved;
    state.month = new Date(state.now.getFullYear(), state.now.getMonth(), 1);
    state.picked = iso(state.now);
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
      const order = ["oggi", "domani", "weekend", "calendario"];
      if (b.dataset.view === state.view && !state.q) return;
      const from = order.indexOf(state.view), dir = order.indexOf(b.dataset.view) > from ? "next" : "prev";
      if (state.q) closeSearch(false);
      state.view = b.dataset.view; store.set("view", state.view);
      swap(() => { render(); toTop(); }, from < 0 ? "fade" : dir);
    }));
    try {
      const r = await fetch("data/events.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const db = await r.json();
      state.events = db.events || []; state.meta = db.meta || null;
    } catch (err) {
      $("#main").append(el("div", { class: "empty" }, el("b", { text: "Non riesco a caricare gli eventi" }), "Controlla la connessione e riapri l'app."));
      return;
    }
    buildRuns(); header(); renderChips();
    document.querySelectorAll(".chip").forEach((c, i) => { const k = Object.keys(CATS).filter((x) => new Set(state.events.map((e) => e.cat)).has(x))[i]; c.classList.toggle("dim", state.hidden.has(k)); });
    render();
    wireHeader();
    requestAnimationFrame(() => requestAnimationFrame(() => $(".tabs").classList.add("ready")));
    // se l'app resta aperta oltre la mezzanotte, ricalcola "oggi" al ritorno in primo piano
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const n = new Date(); if (iso(n) !== iso(state.now)) { state.now = n; state.picked = iso(n); header(); render(); }
    });
  }

  // ---------- feedback tattile ----------
  // Android/Chrome: Vibration API. iPhone: Safari non la supporta, ma un interruttore nativo (input switch)
  // attivato da un tocco produce il "tic" del sistema (iOS 17.4+). Se nessuno dei due c'è, resta il feedback visivo.
  const canVibrate = typeof navigator.vibrate === "function";
    let tickLabel = null;
  function iosTick() {
    if (!tickLabel) {
      tickLabel = el("label", { "aria-hidden": "true", style: "display:none" }, el("input", { type: "checkbox", switch: true }));
      document.head.append(tickLabel);
    }
    tickLabel.click();
  }
  const TAP = "button, a.go, .chip, .cell, .tabs button, .sheet-opt";
  document.addEventListener("pointerdown", (ev) => {
    if (!canVibrate || ev.pointerType === "mouse") return;
    const t = ev.target.closest(TAP);
    if (t) navigator.vibrate(t.matches(".tabs button, .cell") ? 14 : 9);
  }, { passive: true });
  document.addEventListener("click", (ev) => {
    if (canVibrate || !ev.isTrusted) return;
    if (ev.target.closest(TAP)) { try { iosTick(); } catch { /* nessun feedback disponibile */ } }
  });

  // ---------- gong di benvenuto (sintetizzato, nessun file) ----------
  let actx = null, gongDone = false;
  function synthGong(ctx) {
    const t0 = ctx.currentTime + 0.03, dur = 0.5, f0 = 262;
    const master = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3400;
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.32, t0 + 0.014);   // attacco morbido
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);   // si spegne in mezzo secondo
    master.connect(lp); lp.connect(ctx.destination);
    // parziali non armonici, come un gong/campana; gli acuti si spengono prima
    [[1, 0.62, 1], [2.04, 0.34, 0.8], [2.76, 0.24, 0.62], [4.1, 0.1, 0.4], [5.4, 0.06, 0.28]].forEach(([r, g, d]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f0 * r * 1.006, t0); o.frequency.exponentialRampToValueAtTime(f0 * r, t0 + 0.12);
      og.gain.setValueAtTime(g, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * d);
      o.connect(og); og.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
    });
  }
  function playGong() {
    if (gongDone || store.get("sound") === "off") return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = actx || new AC();
      const go = () => { if (gongDone || actx.state !== "running") return; gongDone = true; synthGong(actx); };
      if (actx.state === "running") go(); else actx.resume().then(go).catch(() => {});
    } catch { /* audio non disponibile */ }
  }
  // i browser bloccano l'audio finché non c'è un tocco: provo subito, e al primo gesto se serve
  ["pointerdown", "touchend", "keydown", "click"].forEach((t) => window.addEventListener(t, function once() { if (gongDone) window.removeEventListener(t, once); else playGong(); }, { passive: true }));
  window.addEventListener("load", playGong);
  $("#snd").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const off = store.get("sound") !== "off";
    store.set("sound", off ? "off" : "on");
    ev.currentTarget.setAttribute("aria-pressed", String(!off)); ev.currentTarget.replaceChildren(icon(off ? "mute" : "sound"));
    if (!off) { gongDone = false; playGong(); }
  });
  { const b = $("#snd"), on = store.get("sound") !== "off"; b.setAttribute("aria-pressed", String(on)); b.replaceChildren(icon(on ? "sound" : "mute")); }

  // ---------- splash: scorri (o tocca) per entrare nel calendario ----------
  const app = $("#app"), splashIn = $("#splash-in");
  const goApp = () => (document.getElementById("gate") && !document.getElementById("gate").hidden ? document.getElementById("gate") : app).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  $("#cue").addEventListener("click", goApp);
  $("#splash").addEventListener("click", goApp);
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { splashIn.style.setProperty("--p", Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1).toFixed(3));
      const stuck = app.getBoundingClientRect().top <= -2 && window.scrollY > 0; document.querySelector("header.top").classList.toggle("stuck", stuck); ticking = false; });
  }, { passive: true });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { app.classList.add("in"); o.disconnect(); } }, { threshold: 0, rootMargin: "0px 0px -18% 0px" }).observe(app);
  } else app.classList.add("in");
  if (location.hash === "#app") { app.classList.add("in"); app.scrollIntoView(); }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  init();
})();
