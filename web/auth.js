// Account (Supabase) per Linceo: accesso, eventi salvati sincronizzati, feedback.
// Se config.js non ha le chiavi, tutto resta spento e l'app funziona come prima (salvati solo sul dispositivo).
(function () {
  "use strict";
  const CFG = window.LINCEO_CFG || {};
  const $ = (s) => document.querySelector(s);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignora */ } },
  };
  const toast = (m) => { const t = $("#toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); };
  const configured = !!(CFG.supabaseUrl && CFG.supabaseKey);

  let sb = null, user = null;
  const api = { configured, user: () => user, setSaved() {}, async sendFeedback() { return false; } };
  window.LinceoAuth = api;

  // ---------- feedback (box nel footer): visibile sempre ----------
  function wireFeedback() {
    const tog = $("#fb-toggle"), panel = $("#fb-panel"), form = $("#fb-form"), txt = $("#fb-text"), cnt = $("#fb-count");
    if (!tog) return;
    tog.addEventListener("click", () => {
      const open = tog.getAttribute("aria-expanded") !== "true";
      tog.setAttribute("aria-expanded", String(open)); panel.classList.toggle("open", open);
      if (open) setTimeout(() => txt.focus({ preventScroll: true }), 260);
    });
    const closeFb = () => { if (tog.getAttribute("aria-expanded") === "true") tog.click(); };
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeFb(); });
    document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest("#fb")) closeFb(); });
    txt.addEventListener("input", () => { cnt.textContent = `${txt.value.length}/1000`; });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const message = txt.value.trim();
      if (!message) return;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      const ok = await api.sendFeedback(message);
      btn.disabled = false;
      if (ok) { txt.value = ""; cnt.textContent = "0/1000"; tog.click(); toast("Grazie! Il tuo feedback è arrivato 💛"); }
      else toast(configured ? "Non sono riuscita a inviarlo, riprova tra poco." : "Il feedback sarà attivo a breve.");
    });
  }

  function accountLine() {
    const a = $("#acct"); if (!a) return;
    a.replaceChildren();
    if (!configured) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "linklike";
    if (user) {
      a.append(`Accesso come ${user.email} · `);
      btn.textContent = "Esci";
      btn.onclick = async () => { await sb.auth.signOut(); user = null; accountLine(); toast("Sei uscita da Linceo"); };
    } else {
      btn.textContent = "Accedi o registrati";
      btn.onclick = () => showGate(true);
    }
    a.append(btn);
  }

  if (!configured) { wireFeedback(); return; }

  // ---------- Supabase ----------
  const rememberPref = () => ls.get("remember") !== "0";
  function makeClient(remember) {
    return window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storage: remember ? window.localStorage : window.sessionStorage },
    });
  }

  const gate = $("#gate");
  function showGate(scroll) {
    if (!gate) return;
    gate.classList.remove("leaving"); gate.hidden = false;
    if (scroll) gate.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function hideGate(goApp = true) {
    if (!gate || gate.hidden) return;
    gate.classList.add("leaving");
    setTimeout(() => { gate.hidden = true; if (goApp) $("#app").scrollIntoView({ behavior: "auto", block: "start" }); }, 260);
  }

  const ERR = [
    [/invalid login/i, "Email o password non corrette."],
    [/already registered|already been registered/i, "Questa email è già registrata: usa “Accedi”."],
    [/not confirmed/i, "Conferma prima la tua email: ti abbiamo scritto, controlla anche lo spam."],
    [/password/i, "La password deve avere almeno 8 caratteri."],
    [/rate limit|too many/i, "Troppi tentativi: riprova tra qualche minuto."],
    [/valid email|invalid email/i, "Controlla l'indirizzo email."],
  ];
  const niceErr = (e) => (ERR.find(([r]) => r.test(e && e.message || "")) || [0, "Qualcosa è andato storto. Riprova."])[1];

  async function syncSaved() {
    if (!user) return;
    try {
      const { data, error } = await sb.from("saved").select("key");
      if (error) throw error;
      const server = new Set((data || []).map((r) => r.key));
      let local = []; try { local = JSON.parse(ls.get("saved") || "[]"); } catch { /* vuoto */ }
      const up = local.filter((k) => !server.has(k));
      if (up.length) await sb.from("saved").upsert(up.map((key) => ({ user_id: user.id, key })), { onConflict: "user_id,key", ignoreDuplicates: true });
      window.dispatchEvent(new CustomEvent("linceo:saved", { detail: [...new Set([...server, ...local])] }));
    } catch { /* offline: restano i salvati locali */ }
  }

  api.setSaved = async (key, on) => {
    if (!user) return;
    try {
      if (on) await sb.from("saved").upsert({ user_id: user.id, key }, { onConflict: "user_id,key", ignoreDuplicates: true });
      else await sb.from("saved").delete().eq("user_id", user.id).eq("key", key);
    } catch { /* riprova alla prossima sincronizzazione */ }
  };

  api.sendFeedback = async (message) => {
    try {
      const { error } = await sb.from("feedback").insert({ message, email: user ? user.email : null, user_id: user ? user.id : null });
      return !error;
    } catch { return false; }
  };

  function onSession(session) {
    user = session && session.user ? session.user : null;
    accountLine();
    if (user) { syncSaved(); }
  }

  function wireGate() {
    if (!gate) return;
    let mode = "in";
    const form = $("#gate-form"), mail = $("#g-mail"), pass = $("#g-pass"), rem = $("#g-rem"), msg = $("#g-msg"), go = $("#g-go");
    const consent = $("#g-consent"), consentRow = $("#g-consent-row"), seg = gate.querySelector(".seg");
    rem.checked = rememberPref();
    const setMode = (m) => {
      mode = m; seg.dataset.mode = m;
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
      consentRow.hidden = m !== "up";
      go.textContent = m === "up" ? "Crea il mio account" : "Accedi";
      pass.autocomplete = m === "up" ? "new-password" : "current-password";
      msg.textContent = ""; msg.className = "gate-msg";
    };
    seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    const say = (t, ok) => { msg.textContent = t; msg.className = "gate-msg" + (ok ? " ok" : " err"); };

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = mail.value.trim(), password = pass.value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return say("Controlla l'indirizzo email.");
      if (password.length < 8) return say("La password deve avere almeno 8 caratteri.");
      if (mode === "up" && !consent.checked) return say("Per registrarti serve acconsentire a ricevere gli aggiornamenti via mail.");
      go.disabled = true; say("");
      const remember = rem.checked;
      ls.set("remember", remember ? "1" : "0");
      if (remember !== (sb.auth.storage === window.localStorage)) sb = makeClient(remember);
      try {
        const res = mode === "up"
          ? await sb.auth.signUp({ email, password, options: { data: { consent: true } } })
          : await sb.auth.signInWithPassword({ email, password });
        if (res.error) throw res.error;
        if (!res.data.session) { say("Quasi fatto! Ti abbiamo scritto: conferma l'email per entrare.", true); return; }
        onSession(res.data.session);
        toast(mode === "up" ? "Benvenuta in Linceo ✨" : "Bentornata ✨");
        hideGate();
      } catch (e) { say(niceErr(e)); } finally { go.disabled = false; }
    });

    $("#g-forgot").addEventListener("click", async () => {
      const email = mail.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return say("Scrivi la tua email qui sopra, poi tocca di nuovo.");
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      error ? say(niceErr(error)) : say("Ti abbiamo mandato il link per scegliere una nuova password.", true);
    });
    $("#g-skip").addEventListener("click", () => { ss.set("gate-skip", "1"); hideGate(); });
  }

  function start() {
    sb = makeClient(rememberPref());
    wireFeedback(); wireGate();
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "PASSWORD_RECOVERY") { const p = prompt("Scegli la nuova password (almeno 8 caratteri)"); if (p && p.length >= 8) sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? "Password non cambiata" : "Password aggiornata")); }
      if (ev === "SIGNED_OUT") onSession(null);
    });
    sb.auth.getSession().then(({ data }) => {
      onSession(data.session);
      if (!data.session && ss.get("gate-skip") !== "1") showGate(false);
    });
  }

  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  s.onload = start; s.onerror = () => { wireFeedback(); };
  document.head.append(s);
})();
