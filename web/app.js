/* Roma oggi — legge data/events.json e lo mostra. Nessuna dipendenza, nessun tracciamento. */
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
  const state = { events: [], meta: null, view: "oggi", hidden: new Set(), month: null, picked: null, now: new Date() };

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

  // ---------- dati ----------
  const visible = () => state.events.filter((e) => !state.hidden.has(e.cat));
  const onDay = (list, day) => list.filter((e) => e.start <= day && day <= e.end);
  const isRange = (e) => e.kind === "festival" || e.kind === "mostra" || e.start !== e.end;

  // ---------- componenti ----------
  function card(e) {
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
    return el("article", { class: "card", style: `--col:${col}` },
      when,
      el("div", {},
        el("h3", { text: e.title }),
        el("div", { class: "where", text: [e.venue, e.address].filter(Boolean).join(" · ") }),
        el("div", { class: "badges" },
          el("span", { class: "badge", text: CATS[e.cat] || "Altro" }),
          e.kind !== "evento" ? el("span", { class: "badge kind", text: e.kind }) : null),
        desc,
        e.note ? el("p", { class: "note", text: `Da verificare: ${e.note}` }) : null,
        el("div", { class: "actions" },
          url ? el("a", { class: "go", href: url, target: "_blank", rel: "noopener noreferrer", text: "Vedi evento →" }) : null,
          moreBtn)));
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
    if (timed.length) { sec.append(el("div", { class: "sub", text: `In programma · ${timed.length}` }), ...timed.map(card)); }
    if (going.length) { sec.append(el("div", { class: "sub", text: `In corso · ${going.length}` }), ...going.map(card)); }
    return sec;
  }

  // ---------- viste ----------
  function renderList() {
    const t = new Date(state.now.getFullYear(), state.now.getMonth(), state.now.getDate());
    const main = $("#main"); main.replaceChildren();
    if (state.view === "oggi") main.append(daySection(t, { heading: "Oggi" }));
    else if (state.view === "domani") main.append(daySection(addDays(t, 1), { heading: `Domani · ${longDay(addDays(t, 1))}` }));
    else { // weekend: prossimo sabato e domenica (se oggi è già weekend, include oggi)
      const dow = t.getDay();
      const sat = dow === 0 ? addDays(t, -1) : addDays(t, 6 - dow);
      const days = dow === 0 ? [t] : dow === 6 ? [t, addDays(t, 1)] : [sat, addDays(sat, 1)];
      days.forEach((d) => main.append(daySection(d)));
    }
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
        onclick() { state.picked = key; renderCalendar(); },
      }, el("span", { class: "n", text: d.getDate() }),
      el("span", { class: "dots" }, cats.slice(0, 3).map((c) => el("i", { style: `--col:var(--c-${CATS[c] ? c : "altro"})` })), cats.length > 3 ? el("em", { text: `+${cats.length - 3}` }) : null)));
    }
    main.append(
      el("div", { class: "cal-head" },
        el("button", { type: "button", "aria-label": "Mese precedente", text: "‹", onclick() { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderCalendar(); } }),
        el("h2", { text: `${MESI[m.getMonth()]} ${m.getFullYear()}` }),
        el("button", { type: "button", "aria-label": "Mese successivo", text: "›", onclick() { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderCalendar(); } })),
      grid,
      daySection(fromIso(state.picked)));
  }

  function render() {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    state.view === "calendario" ? renderCalendar() : renderList();
  }

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
          render();
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
      el("br"), "Aggregatore non commerciale: ogni evento rimanda alla fonte originale.");
  }

  // ---------- avvio ----------
  async function init() {
    try { state.hidden = new Set(JSON.parse(store.get("hidden") || "[]")); } catch { state.hidden = new Set(); }
    const saved = store.get("view"); if (["oggi", "domani", "weekend", "calendario"].includes(saved)) state.view = saved;
    state.month = new Date(state.now.getFullYear(), state.now.getMonth(), 1);
    state.picked = iso(state.now);
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; store.set("view", state.view); render(); window.scrollTo({ top: 0 }); }));
    try {
      const r = await fetch("data/events.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const db = await r.json();
      state.events = db.events || []; state.meta = db.meta || null;
    } catch (err) {
      $("#main").append(el("div", { class: "empty" }, el("b", { text: "Non riesco a caricare gli eventi" }), "Controlla la connessione e riapri l'app."));
      return;
    }
    header(); renderChips();
    document.querySelectorAll(".chip").forEach((c, i) => { const k = Object.keys(CATS).filter((x) => new Set(state.events.map((e) => e.cat)).has(x))[i]; c.classList.toggle("dim", state.hidden.has(k)); });
    render();
    // se l'app resta aperta oltre la mezzanotte, ricalcola "oggi" al ritorno in primo piano
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const n = new Date(); if (iso(n) !== iso(state.now)) { state.now = n; state.picked = iso(n); header(); render(); }
    });
  }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  init();
})();
