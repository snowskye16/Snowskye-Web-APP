(() => {
  const script = document.currentScript;

  const API_BASE = (script.getAttribute("data-api-base") || "https://snowskye-web-app.onrender.com").replace(/\/$/, "");
  const BRAND = script.getAttribute("data-brand") || "SnowSkye AI";
  const COLOR = script.getAttribute("data-color") || "#38bdf8";
  const LOGO = script.getAttribute("data-logo") || "";
  const BOOKING = script.getAttribute("data-booking") || "";
  const DEFAULT_TAB = script.getAttribute("data-tab") || "chat";

  const CHAT_URL = `${API_BASE}/chat`;
  const RECENT_URL = `${API_BASE}/api/public/recent`; // optional, uses your server route

  // Avoid double load
  if (window.__SNOWSKYE_WIDGET_PREMIUM__) return;
  window.__SNOWSKYE_WIDGET_PREMIUM__ = true;

  // Session id
  let sessionId = localStorage.getItem("snowskye_session");
  if (!sessionId) {
    sessionId = (crypto?.randomUUID?.() || String(Date.now()));
    localStorage.setItem("snowskye_session", sessionId);
  }

  // ---------- Styles ----------
  const css = `
  :root{ --skc:${COLOR}; }
  #skp-toggle{
    position:fixed; right:26px; bottom:26px; z-index:999999;
    width:64px; height:64px; border-radius:22px;
    border:1px solid rgba(255,255,255,.14);
    background: radial-gradient(120px 120px at 30% 30%, rgba(255,255,255,.18), rgba(255,255,255,.06)),
                linear-gradient(135deg, rgba(56,189,248,.75), rgba(167,139,250,.55));
    box-shadow: 0 25px 70px rgba(0,0,0,.55), 0 0 30px rgba(56,189,248,.22);
    display:grid; place-items:center;
    cursor:pointer;
  }
  #skp-toggle svg{ width:26px; height:26px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.35)); }
  #skp-shell{
    position:fixed; right:26px; bottom:102px; z-index:999999;
    width:390px; height:610px;
    display:none; flex-direction:column;
    border-radius:22px;
    border:1px solid rgba(255,255,255,.14);
    background: rgba(12,18,34,.72);
    backdrop-filter: blur(16px);
    box-shadow: 0 30px 90px rgba(0,0,0,.60);
    overflow:hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    color:#eaf0ff;
  }
  #skp-head{
    padding:14px 14px 12px 14px;
    display:flex; align-items:center; justify-content:space-between;
    background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    border-bottom:1px solid rgba(255,255,255,.10);
  }
  .skp-brand{ display:flex; align-items:center; gap:10px; min-width:0; }
  .skp-avatar{
    width:34px; height:34px; border-radius:14px;
    background: linear-gradient(135deg, rgba(56,189,248,.80), rgba(167,139,250,.60));
    border:1px solid rgba(255,255,255,.18);
    overflow:hidden;
  }
  .skp-avatar img{ width:100%; height:100%; object-fit:cover; display:${LOGO ? "block" : "none"}; }
  .skp-title{ display:flex; flex-direction:column; line-height:1.1; min-width:0; }
  .skp-title b{ font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .skp-live{ display:flex; align-items:center; gap:6px; color:rgba(255,255,255,.70); font-size:12px; margin-top:3px; }
  .skp-dot{
    width:8px; height:8px; border-radius:999px;
    background: #22c55e;
    box-shadow: 0 0 12px rgba(34,197,94,.6);
  }
  .skp-topbtns{ display:flex; align-items:center; gap:10px; }
  .skp-iconbtn{
    width:34px; height:34px; border-radius:14px;
    display:grid; place-items:center;
    border:1px solid rgba(255,255,255,.14);
    background: rgba(0,0,0,.18);
    color:#eaf0ff; cursor:pointer;
  }

  #skp-tabs{
    display:flex; gap:10px;
    padding:10px 12px;
    border-bottom:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.12);
  }
  .skp-tab{
    flex:1;
    padding:10px 12px;
    border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.16);
    color:rgba(255,255,255,.75);
    font-weight:800;
    cursor:pointer;
  }
  .skp-tab.active{
    background: linear-gradient(135deg, rgba(56,189,248,.30), rgba(167,139,250,.22));
    color:#eaf0ff;
    border-color: rgba(255,255,255,.18);
  }

  #skp-actions{
    padding:10px 12px 6px;
    display:flex; flex-wrap:wrap; gap:10px;
  }
  .skp-chip{
    display:inline-flex; align-items:center; gap:8px;
    padding:10px 12px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.16);
    color:#eaf0ff;
    font-weight:800;
    font-size:13px;
    cursor:pointer;
    user-select:none;
  }
  .skp-chip:hover{ border-color: rgba(56,189,248,.35); transform: translateY(-1px); }
  .skp-chip span{ opacity:.9; }

  #skp-body{
    flex:1;
    display:flex;
    flex-direction:column;
    overflow:hidden;
  }
  #skp-chat, #skp-activity{
    flex:1; overflow:auto;
    padding:12px;
    display:none;
  }
  #skp-chat.active, #skp-activity.active{ display:block; }
  .skp-msg{
    max-width:80%;
    padding:10px 12px;
    margin:8px 0;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.06);
    line-height:1.35;
    font-size:14px;
  }
  .skp-msg.me{
    margin-left:auto;
    background: rgba(56,189,248,.22);
    border-color: rgba(56,189,248,.30);
  }
  .skp-meta{
    display:flex; justify-content:space-between; gap:12px;
    font-size:11px; margin-top:8px;
    color: rgba(255,255,255,.55);
  }

  #skp-inputbar{
    padding:12px;
    border-top:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.18);
    display:flex; gap:10px; align-items:center;
  }
  #skp-text{
    flex:1;
    padding:12px 12px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.18);
    color:#eaf0ff;
    outline:none;
    font-size:14px;
  }
  #skp-send{
    padding:12px 14px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.14);
    background: linear-gradient(135deg, rgba(56,189,248,.75), rgba(167,139,250,.55));
    color:#071022;
    font-weight:900;
    cursor:pointer;
  }
  #skp-mic{
    width:44px; height:44px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.14);
    background: rgba(0,0,0,.18);
    color:#eaf0ff;
    cursor:pointer;
  }
  #skp-status{
    padding:10px 12px;
    font-size:12px;
    color: rgba(255,255,255,.60);
  }

  @media (max-width: 520px){
    #skp-shell{ right:10px; left:10px; width:auto; height:78vh; bottom:92px; }
    #skp-toggle{ right:16px; bottom:16px; }
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- UI ----------
  const toggle = document.createElement("button");
  toggle.id = "skp-toggle";
  toggle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12c0 4.418-4.03 8-9 8-1.04 0-2.04-.15-2.98-.43L4 20l.95-3.09A7.42 7.42 0 0 1 2 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" stroke="#071022" stroke-width="2" stroke-linejoin="round"/>
      <path d="M7.5 12h.01M12 12h.01M16.5 12h.01" stroke="#071022" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const shell = document.createElement("div");
  shell.id = "skp-shell";
  shell.innerHTML = `
    <div id="skp-head">
      <div class="skp-brand">
        <div class="skp-avatar">${LOGO ? `<img src="${LOGO}" alt="${BRAND}"/>` : ""}</div>
        <div class="skp-title">
          <b>${BRAND}</b>
          <div class="skp-live"><span class="skp-dot"></span><span>Live</span></div>
        </div>
      </div>

      <div class="skp-topbtns">
        <button class="skp-iconbtn" id="skp-voice" title="Voice reply">
          🔊
        </button>
        <button class="skp-iconbtn" id="skp-close" title="Close">
          ✕
        </button>
      </div>
    </div>

    <div id="skp-tabs">
      <button class="skp-tab" data-tab="chat">Chat</button>
      <button class="skp-tab" data-tab="activity">Activity</button>
    </div>

    <div id="skp-actions">
      <div class="skp-chip" data-action="book">📅 <span>Book Consultation</span></div>
      <div class="skp-chip" data-action="website">🚀 <span>Get Website</span></div>
      <div class="skp-chip" data-action="pricing">💰 <span>Pricing</span></div>
      <div class="skp-chip" data-action="grow">📈 <span>Grow</span></div>
      <div class="skp-chip" data-action="save_email">✉️ <span>Save my email</span></div>
    </div>

    <div id="skp-body">
      <div id="skp-chat"></div>
      <div id="skp-activity"></div>

      <div id="skp-status"></div>

      <div id="skp-inputbar">
        <button id="skp-mic" title="Voice input">🎤</button>
        <input id="skp-text" placeholder="Ask ${BRAND}..." />
        <button id="skp-send">Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(shell);

  // ---------- Helpers ----------
  const $ = (sel) => shell.querySelector(sel);

  const chatEl = $("#skp-chat");
  const activityEl = $("#skp-activity");
  const textEl = $("#skp-text");
  const statusEl = $("#skp-status");
  const voiceBtn = $("#skp-voice");

  let voiceEnabled = false;

  function nowTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function addMsg(text, who) {
    const wrap = document.createElement("div");
    wrap.className = `skp-msg ${who === "me" ? "me" : "bot"}`;
    wrap.textContent = text;

    const meta = document.createElement("div");
    meta.className = "skp-meta";
    meta.innerHTML = `<span>${who === "me" ? "You" : BRAND}</span><span>${nowTime()}</span>`;
    wrap.appendChild(meta);

    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function setStatus(t) {
    statusEl.textContent = t || "";
  }

  async function sendToBot(message) {
    addMsg(message, "me");
    setStatus("Thinking…");

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId })
      });

      const data = await res.json();
      const reply = data?.reply || "Thanks! How can I help?";

      addMsg(reply, "bot");
      setStatus("");

      if (voiceEnabled && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(reply);
        u.lang = "en-US";
        u.rate = 1;
        u.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      setStatus("");
      addMsg("Server error. Please try again later.", "bot");
    }
  }

  function openTab(name) {
    shell.querySelectorAll(".skp-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    chatEl.classList.toggle("active", name === "chat");
    activityEl.classList.toggle("active", name === "activity");
  }

  async function loadActivity() {
    activityEl.innerHTML = `<div class="skp-msg">Loading recent activity…</div>`;
    try {
      const res = await fetch(RECENT_URL, { method: "GET" });
      const data = await res.json();

      const leads = Array.isArray(data?.leads) ? data.leads : [];
      const apps = Array.isArray(data?.appointments) ? data.appointments : [];

      const block = document.createElement("div");
      block.innerHTML = `
        <div class="skp-msg"><b>Recent Leads</b><div style="margin-top:8px;opacity:.85;font-size:13px">${leads.map(l=>`• ${escapeHtml(l.message)} <span style="opacity:.6">(${escapeHtml(l.time||"")})</span>`).join("<br>") || "No leads yet."}</div></div>
        <div class="skp-msg"><b>Recent Appointments</b><div style="margin-top:8px;opacity:.85;font-size:13px">${apps.map(a=>`• ${escapeHtml(a.message)} <span style="opacity:.6">(${escapeHtml(a.status||"pending")})</span>`).join("<br>") || "No appointments yet."}</div></div>
      `;
      activityEl.innerHTML = "";
      activityEl.appendChild(block);
    } catch {
      activityEl.innerHTML = `<div class="skp-msg">Activity is unavailable.</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  // ---------- Events ----------
  toggle.addEventListener("click", () => {
    shell.style.display = (shell.style.display === "flex") ? "none" : "flex";
    if (shell.style.display === "flex") {
      textEl.focus();
      if (!chatEl.dataset.welcomed) {
        chatEl.dataset.welcomed = "1";
        addMsg(`Hi, I’m ${BRAND}. Tell me your business type + your goal, and I’ll help you grow fast.`, "bot");
      }
    }
  });

  $("#skp-close").addEventListener("click", () => (shell.style.display = "none"));

  shell.querySelectorAll(".skp-tab").forEach((b) => {
    b.addEventListener("click", async () => {
      openTab(b.dataset.tab);
      if (b.dataset.tab === "activity") await loadActivity();
    });
  });

  $("#skp-send").addEventListener("click", () => {
    const m = (textEl.value || "").trim();
    if (!m) return;
    textEl.value = "";
    sendToBot(m);
  });

  textEl.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const m = (textEl.value || "").trim();
      if (!m) return;
      textEl.value = "";
      sendToBot(m);
    }
  });

  // Voice input (mic)
  $("#skp-mic").addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addMsg("Voice input not supported on this browser.", "bot");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      const t = ev.results?.[0]?.[0]?.transcript || "";
      if (t) sendToBot(t);
    };
    rec.start();
  });

  // Voice reply toggle
  voiceBtn.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceBtn.textContent = voiceEnabled ? "🔇" : "🔊";
    setStatus(voiceEnabled ? "Voice reply: ON" : "Voice reply: OFF");
    setTimeout(() => setStatus(""), 1200);
  });

  // Chips
  shell.querySelectorAll(".skp-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const a = chip.dataset.action;
      if (a === "book") {
        if (BOOKING) window.open(BOOKING, "_blank", "noopener");
        else sendToBot("I want to book a consultation.");
        return;
      }
      if (a === "pricing") return sendToBot("Show me your pricing packages.");
      if (a === "website") return sendToBot("I want a premium website for my business.");
      if (a === "grow") return sendToBot("How can I grow my business using a chatbot?");
      if (a === "save_email") {
        const email = prompt("Enter your email (for follow-up):");
        if (!email) return;
        sendToBot(`My email is ${email}. Please save it and follow up with me.`);
        return;
      }
    });
  });

  // Default tab
  openTab(DEFAULT_TAB === "activity" ? "activity" : "chat");
})();