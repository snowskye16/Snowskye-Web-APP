(() => {
  // Prevent double load
  if (window.__SNOWSKYE_WIDGET__) return;
  window.__SNOWSKYE_WIDGET__ = true;

  const script = document.currentScript;

  // SAME DOMAIN default:
  const API_BASE = (script.getAttribute("data-api-base") || "").replace(/\/$/, "");
  const BRAND = script.getAttribute("data-brand") || "SnowSkye AI";
  const COLOR = script.getAttribute("data-color") || "#38bdf8";
  const LOGO = script.getAttribute("data-logo") || "";
  const BOOKING = script.getAttribute("data-booking") || "";

  // Use same domain if API_BASE empty
  const CHAT_URL = (API_BASE ? API_BASE : "") + "/api/chat";
  const RECENT_URL = (API_BASE ? API_BASE : "") + "/api/public/recent";

  // Session id (for lead tracking)
  let sessionId = "";
  try {
    sessionId = localStorage.getItem("snowskye_session") || "";
    if (!sessionId) {
      sessionId = (crypto?.randomUUID?.() || String(Date.now()));
      localStorage.setItem("snowskye_session", sessionId);
    }
  } catch {}

  // Styles
  const style = document.createElement("style");
  style.textContent = `
  :root{ --sk:${COLOR}; }
  .ssk-toggle{
    position:fixed; bottom:22px; right:22px; z-index:999999;
    width:64px; height:64px; border-radius:22px;
    background: radial-gradient(100px 100px at 30% 30%, rgba(255,255,255,.18), rgba(255,255,255,.06)),
                linear-gradient(135deg, rgba(56,189,248,.78), rgba(167,139,250,.62));
    border:1px solid rgba(255,255,255,.14);
    cursor:pointer;
    box-shadow:0 25px 70px rgba(0,0,0,.55), 0 0 30px rgba(56,189,248,.22);
    display:grid; place-items:center;
    color:#071022; font-size:22px;
  }
  .ssk-box{
    position:fixed; bottom:96px; right:22px; z-index:999999;
    width:380px; max-width:calc(100vw - 40px); height:560px;
    background: rgba(12,18,34,.72);
    border:1px solid rgba(255,255,255,.14);
    border-radius:18px;
    box-shadow:0 30px 90px rgba(0,0,0,.6);
    display:none; flex-direction:column; overflow:hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    color:#eaf0ff;
    backdrop-filter: blur(16px);
  }
  .ssk-box.open{display:flex}
  .ssk-head{
    padding:14px; display:flex; align-items:center; justify-content:space-between;
    background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    border-bottom:1px solid rgba(255,255,255,.10);
  }
  .ssk-brand{display:flex; align-items:center; gap:10px; min-width:0}
  .ssk-logo{
    width:34px; height:34px; border-radius:12px;
    background: linear-gradient(135deg, rgba(56,189,248,.80), rgba(167,139,250,.60));
    border:1px solid rgba(255,255,255,.18);
    overflow:hidden; flex:0 0 auto;
  }
  .ssk-logo img{width:100%; height:100%; object-fit:cover; display:${LOGO ? "block" : "none"}}
  .ssk-title{display:flex; flex-direction:column; line-height:1.1; min-width:0}
  .ssk-title b{font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ssk-live{display:flex; gap:6px; align-items:center; color:rgba(255,255,255,.70); font-size:12px; margin-top:3px;}
  .ssk-dot{width:8px; height:8px; border-radius:999px; background:#22c55e; box-shadow:0 0 12px rgba(34,197,94,.6);}
  .ssk-close{
    width:34px; height:34px; border-radius:12px;
    border:1px solid rgba(255,255,255,.14);
    background:rgba(0,0,0,.18); color:#eaf0ff; cursor:pointer;
  }
  .ssk-tabs{
    display:flex; gap:10px; padding:10px 12px;
    border-bottom:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.12);
  }
  .ssk-tab{
    flex:1; padding:10px 12px; border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.16);
    color:rgba(255,255,255,.75); font-weight:800; cursor:pointer;
  }
  .ssk-tab.active{
    background: linear-gradient(135deg, rgba(56,189,248,.30), rgba(167,139,250,.22));
    color:#eaf0ff; border-color: rgba(255,255,255,.18);
  }
  .ssk-actions{padding:10px 12px 6px; display:flex; flex-wrap:wrap; gap:10px;}
  .ssk-chip{
    display:inline-flex; align-items:center; gap:8px;
    padding:10px 12px; border-radius:16px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.16);
    color:#eaf0ff; font-weight:800; font-size:13px; cursor:pointer; user-select:none;
  }
  .ssk-body{flex:1; display:flex; flex-direction:column; overflow:hidden;}
  .ssk-chat, .ssk-activity{flex:1; overflow:auto; padding:12px; display:none;}
  .ssk-chat.active, .ssk-activity.active{display:block;}
  .ssk-msg{
    max-width:80%; padding:10px 12px; margin:8px 0;
    border-radius:16px; border:1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.06);
    line-height:1.35; font-size:14px;
  }
  .ssk-msg.me{margin-left:auto; background: rgba(56,189,248,.22); border-color: rgba(56,189,248,.30);}
  .ssk-meta{display:flex; justify-content:space-between; gap:12px; font-size:11px; margin-top:8px; color: rgba(255,255,255,.55);}
  .ssk-foot{
    padding:12px; border-top:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.18);
    display:flex; gap:10px; align-items:center;
  }
  .ssk-input{
    flex:1; padding:12px 12px; border-radius:16px;
    border:1px solid rgba(255,255,255,.12);
    background: rgba(0,0,0,.18); color:#eaf0ff; outline:none; font-size:14px;
  }
  .ssk-send{
    padding:12px 14px; border-radius:16px;
    border:1px solid rgba(255,255,255,.14);
    background: linear-gradient(135deg, rgba(56,189,248,.75), rgba(167,139,250,.55));
    color:#071022; font-weight:900; cursor:pointer;
  }
  @media (max-width: 520px){
    .ssk-box{ right:10px; left:10px; width:auto; height:78vh; bottom:92px; }
    .ssk-toggle{ right:16px; bottom:16px; }
  }
  `;
  document.head.appendChild(style);

  // UI
  const toggle = document.createElement("button");
  toggle.className = "ssk-toggle";
  toggle.innerHTML = "💬";

  const box = document.createElement("div");
  box.className = "ssk-box";
  box.innerHTML = `
    <div class="ssk-head">
      <div class="ssk-brand">
        <div class="ssk-logo">${LOGO ? `<img src="${LOGO}" alt="${BRAND}"/>` : ""}</div>
        <div class="ssk-title">
          <b>${BRAND}</b>
          <div class="ssk-live"><span class="ssk-dot"></span><span>Live</span></div>
        </div>
      </div>
      <button class="ssk-close" title="Close">✕</button>
    </div>

    <div class="ssk-tabs">
      <button class="ssk-tab" data-tab="chat">Chat</button>
      <button class="ssk-tab" data-tab="activity">Activity</button>
    </div>

    <div class="ssk-actions">
      <div class="ssk-chip" data-action="book">📅 <span>Book Consultation</span></div>
      <div class="ssk-chip" data-action="website">🚀 <span>Get Website</span></div>
      <div class="ssk-chip" data-action="pricing">💰 <span>Pricing</span></div>
      <div class="ssk-chip" data-action="grow">📈 <span>Grow</span></div>
      <div class="ssk-chip" data-action="save_email">✉️ <span>Save my email</span></div>
    </div>

    <div class="ssk-body">
      <div class="ssk-chat"></div>
      <div class="ssk-activity"></div>
      <div class="ssk-foot">
        <input class="ssk-input" placeholder="Ask ${BRAND}..." />
        <button class="ssk-send">Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(box);

  const $ = (sel) => box.querySelector(sel);
  const chatEl = $(".ssk-chat");
  const activityEl = $(".ssk-activity");
  const input = $(".ssk-input");

  function nowTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function addMsg(text, who) {
    const wrap = document.createElement("div");
    wrap.className = `ssk-msg ${who === "me" ? "me" : "bot"}`;
    wrap.textContent = text;

    const meta = document.createElement("div");
    meta.className = "ssk-meta";
    meta.innerHTML = `<span>${who === "me" ? "You" : BRAND}</span><span>${nowTime()}</span>`;
    wrap.appendChild(meta);

    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function send(message) {
    addMsg(message, "me");
    try {
      const r = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId, source: "widget" }),
      });
      const j = await r.json().catch(() => ({}));
      addMsg(j.reply || "Thanks! How can I help?", "bot");
    } catch {
      addMsg("Server unavailable. Please try again later.", "bot");
    }
  }

  function openTab(name) {
    box.querySelectorAll(".ssk-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === name)
    );
    chatEl.classList.toggle("active", name === "chat");
    activityEl.classList.toggle("active", name === "activity");
  }

  async function loadActivity() {
    activityEl.innerHTML = `<div class="ssk-msg">Loading recent activity…</div>`;
    try {
      const res = await fetch(RECENT_URL, { method: "GET" });
      const data = await res.json().catch(() => ({}));

      const leads = Array.isArray(data?.leads) ? data.leads : [];
      const apps = Array.isArray(data?.appointments) ? data.appointments : [];

      const block = document.createElement("div");
      block.innerHTML = `
        <div class="ssk-msg"><b>Recent Leads</b><div style="margin-top:8px;opacity:.85;font-size:13px">${leads.map(l=>`• ${escapeHtml(l.message)} <span style="opacity:.6">(${escapeHtml(l.time||"")})</span>`).join("<br>") || "No leads yet."}</div></div>
        <div class="ssk-msg"><b>Recent Appointments</b><div style="margin-top:8px;opacity:.85;font-size:13px">${apps.map(a=>`• ${escapeHtml(a.message)} <span style="opacity:.6">(${escapeHtml(a.status||"pending")})</span>`).join("<br>") || "No appointments yet."}</div></div>
      `;
      activityEl.innerHTML = "";
      activityEl.appendChild(block);
    } catch {
      activityEl.innerHTML = `<div class="ssk-msg">Activity is unavailable.</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  // events
  toggle.addEventListener("click", () => {
    box.classList.toggle("open");
    if (box.classList.contains("open") && !chatEl.dataset.welcome) {
      chatEl.dataset.welcome = "1";
      addMsg(`Hi, I’m ${BRAND}. Tell me your business type + your goal, and I’ll help you grow fast.`, "bot");
    }
  });

  $(".ssk-close").addEventListener("click", () => box.classList.remove("open"));

  box.querySelectorAll(".ssk-tab").forEach((b) => {
    b.addEventListener("click", async () => {
      openTab(b.dataset.tab);
      if (b.dataset.tab === "activity") await loadActivity();
    });
  });

  $(".ssk-send").addEventListener("click", () => {
    const m = (input.value || "").trim();
    if (!m) return;
    input.value = "";
    send(m);
  });

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const m = (input.value || "").trim();
      if (!m) return;
      input.value = "";
      send(m);
    }
  });

  box.querySelectorAll(".ssk-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const a = chip.dataset.action;
      if (a === "book") {
        if (BOOKING) window.open(BOOKING, "_blank", "noopener");
        else send("I want to book a consultation.");
        return;
      }
      if (a === "pricing") return send("Show me your pricing packages.");
      if (a === "website") return send("I want a premium website for my business.");
      if (a === "grow") return send("How can I grow my business using a chatbot?");
      if (a === "save_email") {
        const email = prompt("Enter your email (for follow-up):");
        if (!email) return;
        send(`My email is ${email}. Please save it and follow up with me.`);
        return;
      }
    });
  });

  // default
  openTab("chat");
})();