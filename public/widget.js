(() => {
  // Prevent double load
  if (window.__SNOWSKYE_WIDGET__) return;
  window.__SNOWSKYE_WIDGET__ = true;

  const script = document.currentScript;

  const API_BASE = (script.getAttribute("data-api-base") || "").replace(/\/$/, "");
  const BRAND = script.getAttribute("data-brand") || "SnowSkye AI";
  const COLOR = script.getAttribute("data-color") || "#38bdf8";
  const LOGO = script.getAttribute("data-logo") || "";
  const BOOKING = script.getAttribute("data-booking") || "";

  const CHAT_URL = (API_BASE || "") + "/api/chat";

  /* =========================
     STYLES
  ========================= */
  const style = document.createElement("style");
  style.textContent = `
  .ssk-toggle{
    position:fixed; bottom:22px; right:22px; z-index:999999;
    width:64px; height:64px; border-radius:22px;
    background: linear-gradient(135deg, ${COLOR}, #a78bfa);
    border:0; cursor:pointer;
    box-shadow:0 25px 70px rgba(0,0,0,.55);
    display:grid; place-items:center;
    color:#020617; font-size:22px;
  }
  .ssk-box{
    position:fixed; bottom:96px; right:22px; z-index:999999;
    width:360px; max-width:calc(100vw - 40px); height:520px;
    background:#070b18; border:1px solid rgba(255,255,255,.12);
    border-radius:18px; box-shadow:0 30px 90px rgba(0,0,0,.6);
    display:none; flex-direction:column; overflow:hidden;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    color:#eaf0ff;
  }
  .ssk-box.open{display:flex}
  .ssk-head{
    padding:14px; display:flex; align-items:center; justify-content:space-between;
    background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
    border-bottom:1px solid rgba(255,255,255,.12);
  }
  .ssk-brand{display:flex; align-items:center; gap:10px}
  .ssk-logo{
    width:34px; height:34px; border-radius:12px;
    background: linear-gradient(135deg, ${COLOR}, #a78bfa);
    display:grid; place-items:center; overflow:hidden;
  }
  .ssk-logo img{width:100%; height:100%; object-fit:cover}
  .ssk-close{
    width:34px; height:34px; border-radius:12px;
    border:1px solid rgba(255,255,255,.14);
    background:rgba(0,0,0,.2); color:#eaf0ff; cursor:pointer;
  }
  .ssk-body{
    flex:1; padding:12px; overflow:auto;
  }
  .ssk-msg{
    max-width:80%; padding:10px 12px; margin:8px 0;
    border-radius:14px; font-size:14px; line-height:1.4;
    border:1px solid rgba(255,255,255,.12);
  }
  .ssk-me{margin-left:auto; background:rgba(56,189,248,.22)}
  .ssk-bot{background:rgba(255,255,255,.06)}
  .ssk-foot{
    padding:10px; border-top:1px solid rgba(255,255,255,.12);
    display:flex; gap:8px;
  }
  .ssk-input{
    flex:1; padding:10px 12px;
    border-radius:14px; border:1px solid rgba(255,255,255,.14);
    background:#050814; color:#eaf0ff; outline:none;
  }
  .ssk-send{
    padding:10px 14px; border-radius:14px;
    border:0; cursor:pointer;
    background:${COLOR}; color:#020617; font-weight:800;
  }
  .ssk-actions{
    padding:8px 12px; display:flex; gap:8px; flex-wrap:wrap;
  }
  .ssk-chip{
    padding:8px 10px; font-size:12px; font-weight:700;
    border-radius:999px; cursor:pointer;
    border:1px solid rgba(255,255,255,.14);
    background:rgba(255,255,255,.08);
  }
  `;
  document.head.appendChild(style);

  /* =========================
     UI
  ========================= */
  const toggle = document.createElement("button");
  toggle.className = "ssk-toggle";
  toggle.innerHTML = "💬";

  const box = document.createElement("div");
  box.className = "ssk-box";
  box.innerHTML = `
    <div class="ssk-head">
      <div class="ssk-brand">
        <div class="ssk-logo">${LOGO ? `<img src="${LOGO}" />` : "🤖"}</div>
        <b>${BRAND}</b>
      </div>
      <button class="ssk-close">✕</button>
    </div>

    <div class="ssk-actions">
      <div class="ssk-chip" data-q="I want a website + chatbot">🚀 Website + AI</div>
      <div class="ssk-chip" data-q="Show me your pricing">💰 Pricing</div>
      <div class="ssk-chip" data-q="I want to book a consultation">📅 Book Call</div>
    </div>

    <div class="ssk-body"></div>

    <div class="ssk-foot">
      <input class="ssk-input" placeholder="Ask about websites, chatbots, automation…" />
      <button class="ssk-send">Send</button>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(box);

  const body = box.querySelector(".ssk-body");
  const input = box.querySelector(".ssk-input");

  function addMsg(text, who) {
    const d = document.createElement("div");
    d.className = `ssk-msg ${who}`;
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  async function send(msg) {
    addMsg(msg, "ssk-me");
    try {
      const r = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
      });
      const j = await r.json();
      addMsg(j.reply || "Thanks! How can I help?", "ssk-bot");
    } catch {
      addMsg("Server unavailable. Please try again later.", "ssk-bot");
    }
  }

  toggle.onclick = () => {
    box.classList.toggle("open");
    if (box.classList.contains("open") && !body.dataset.welcome) {
      body.dataset.welcome = "1";
      addMsg(`Hi! I’m ${BRAND}. What business are you in and what do you want to build?`, "ssk-bot");
    }
  };

  box.querySelector(".ssk-close").onclick = () => box.classList.remove("open");

  box.querySelector(".ssk-send").onclick = () => {
    const m = input.value.trim();
    if (!m) return;
    input.value = "";
    send(m);
  };

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const m = input.value.trim();
      if (!m) return;
      input.value = "";
      send(m);
    }
  });

  box.querySelectorAll(".ssk-chip").forEach(c => {
    c.onclick = () => {
      const q = c.getAttribute("data-q");
      if (q.includes("Book") && BOOKING) {
        window.open(BOOKING, "_blank", "noopener");
      } else {
        send(q);
      }
    };
  });
})();