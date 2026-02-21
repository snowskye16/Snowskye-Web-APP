(() => {
  const script = document.currentScript;

  const API_BASE = script.getAttribute("data-api-base") || "https://snowskye-web-app.onrender.com";
  const BRAND = script.getAttribute("data-brand") || "SnowSkyeAI";
  const COLOR = script.getAttribute("data-color") || "#38bdf8";
  const LOGO = script.getAttribute("data-logo") || "";
  const BOOKING = script.getAttribute("data-booking") || "";

  const CHAT_URL = `${API_BASE.replace(/\/$/, "")}/chat`;

  // Avoid double-inject
  if (window.__SNOWSKYE_WIDGET_LOADED__) return;
  window.__SNOWSKYE_WIDGET_LOADED__ = true;

  const style = document.createElement("style");
  style.textContent = `
    #sk-toggle{
      position:fixed; bottom:20px; right:20px;
      width:60px; height:60px; border-radius:999px;
      background:${COLOR}; color:#020617;
      border:1px solid rgba(255,255,255,.12);
      font-size:26px; cursor:pointer; z-index:999999;
      box-shadow: 0 0 25px rgba(56,189,248,.25);
      display:grid; place-items:center;
    }
    #sk-chat{
      position:fixed; bottom:90px; right:20px;
      width:360px; height:520px;
      background: rgba(15,23,42,.96);
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      display:none; flex-direction:column;
      overflow:hidden; z-index:999999;
      box-shadow: 0 20px 80px rgba(0,0,0,.55);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #sk-head{
      background:${COLOR};
      padding:12px; display:flex; align-items:center; justify-content:space-between;
      color:#020617; font-weight:900;
    }
    #sk-title{display:flex; align-items:center; gap:10px;}
    #sk-title img{width:26px; height:26px; border-radius:8px; object-fit:cover; display:${LOGO ? "block" : "none"};}
    #sk-close{cursor:pointer; font-weight:900; padding:0 6px;}
    #sk-msgs{flex:1; overflow:auto; padding:10px;}
    .sk-msg{padding:10px; margin:6px; border-radius:10px; max-width:80%; font-size:14px; line-height:1.35;}
    .sk-user{background:${COLOR}; color:#020617; margin-left:auto;}
    .sk-bot{background:rgba(255,255,255,.07); color:#eaf0ff; border:1px solid rgba(255,255,255,.10);}
    #sk-input{
      display:flex; border-top:1px solid rgba(255,255,255,.10);
      background: rgba(0,0,0,.20);
    }
    #sk-text{
      flex:1; padding:10px; border:none; outline:none;
      background: transparent; color:#eaf0ff;
    }
    #sk-send{
      padding:10px 12px; border:none; cursor:pointer;
      background:${COLOR}; color:#020617; font-weight:900;
    }
    #sk-actions{
      display:flex; gap:8px; padding:10px; border-top:1px solid rgba(255,255,255,.08);
    }
    #sk-book{
      display:${BOOKING ? "inline-flex" : "none"};
      padding:10px 12px; border-radius:12px;
      background: rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.12);
      color:#eaf0ff; text-decoration:none; font-weight:800; font-size:13px;
    }
  `;
  document.head.appendChild(style);

  const toggle = document.createElement("button");
  toggle.id = "sk-toggle";
  toggle.setAttribute("aria-label", "Open chat");
  toggle.textContent = "💬";

  const chat = document.createElement("div");
  chat.id = "sk-chat";
  chat.innerHTML = `
    <div id="sk-head">
      <div id="sk-title">
        <img src="${LOGO}" alt="${BRAND}"/>
        <span>${BRAND} Assistant</span>
      </div>
      <span id="sk-close">✕</span>
    </div>
    <div id="sk-msgs"></div>
    <div id="sk-input">
      <input id="sk-text" placeholder="Type a message..." />
      <button id="sk-send">Send</button>
    </div>
    <div id="sk-actions">
      <a id="sk-book" href="${BOOKING}" target="_blank" rel="noopener">Book now</a>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(chat);

  const msgs = chat.querySelector("#sk-msgs");
  const closeBtn = chat.querySelector("#sk-close");
  const text = chat.querySelector("#sk-text");
  const sendBtn = chat.querySelector("#sk-send");

  let sessionId = localStorage.getItem("snowskye_session");
  if (!sessionId) {
    sessionId = (crypto?.randomUUID?.() || String(Date.now()));
    localStorage.setItem("snowskye_session", sessionId);
  }

  function addMessage(t, who) {
    const div = document.createElement("div");
    div.className = `sk-msg ${who === "user" ? "sk-user" : "sk-bot"}`;
    div.textContent = t;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function send() {
    const message = (text.value || "").trim();
    if (!message) return;

    addMessage(message, "user");
    text.value = "";

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId })
      });

      const data = await res.json();
      addMessage(data.reply || "Thanks! How can I help?", "bot");
    } catch (e) {
      addMessage("Server error. Please try again later.", "bot");
    }
  }

  toggle.onclick = () => {
    chat.style.display = (chat.style.display === "flex") ? "none" : "flex";
    if (chat.style.display === "flex") text.focus();
  };
  closeBtn.onclick = () => (chat.style.display = "none");
  sendBtn.onclick = send;
  text.addEventListener("keypress", (e) => {
    if (e.key === "Enter") send();
  });
})();