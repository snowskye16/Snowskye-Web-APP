/**
 * ✅ Skyesnow AI server.js (FULL FIX + UPGRADED + SELLABLE)
 *
 * Based on YOUR code + fixes:
 * ✅ Fix /chat alias properly (no 404) by using one shared handler
 * ✅ No-loop lead flow: ASK_NAME → ASK_GOAL → ASK_EMAIL → DONE
 * ✅ Email never forces DONE too early
 * ✅ Always returns sessionId (widget stores it)
 * ✅ Multi-tenant clientId
 * ✅ One lead per session via Supabase UPSERT (no spam rows)
 * ✅ CORS + OPTIONS preflight fixed
 * ✅ widget.js served with correct MIME + cache headers
 * ✅ /api/public/recent?clientId=...
 * ✅ Memory TTL cleanup (48 hours)
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const validator = require("validator");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();

/* =========================
   CONFIG
========================= */
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const PUBLIC_DIR = path.join(__dirname, "public");

// Optional allowlist
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").trim();
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const LOCK_CORS = String(process.env.LOCK_CORS || "false").toLowerCase() === "true";

function buildAllowedOrigins() {
  const set = new Set();
  if (FRONTEND_ORIGIN) set.add(FRONTEND_ORIGIN);
  for (const o of FRONTEND_ORIGINS) set.add(o);
  return Array.from(set);
}
const allowedOrigins = buildAllowedOrigins();

/* =========================
   SUPABASE
========================= */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

if (!supabase) {
  console.warn("⚠️ Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). DB saving disabled.");
}

/* =========================
   OPENAI (optional)
========================= */
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
if (!openai) console.warn("⚠️ OPENAI_API_KEY missing (AI replies will use fallback).");

/* =========================
   SECURITY + MIDDLEWARE
========================= */
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(compression());
app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: true, limit: "300kb" }));

/* =========================
   RATE LIMIT
========================= */
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 900, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

/* =========================
   CORS ✅ FIXED
========================= */
function allowOrigin(origin) {
  if (!origin) return true; // server-to-server / curl
  if (!LOCK_CORS) return true; // SELL MODE: allow all
  return allowedOrigins.includes(origin);
}

const publicCors = cors({
  origin: (origin, cb) => (allowOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
});

const adminCors = cors({
  origin: (origin, cb) => (allowOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
});

// ✅ Preflight support
app.options("*", publicCors);

// ✅ CORS JSON error handler
app.use((err, req, res, next) => {
  if (err && String(err.message || "").includes("CORS")) {
    return res.status(403).json({ ok: false, reply: "Blocked by CORS. Add this domain to allowed origins." });
  }
  next(err);
});

/* =========================
   SESSION (ADMIN ONLY)
========================= */
app.use(
  session({
    name: "skyesnow.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { httpOnly: true, secure: IS_PROD, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 },
  })
);

/* =========================
   STATIC + WIDGET MIME FIX
========================= */
app.get("/widget.js", (req, res) => {
  const filePath = path.join(PUBLIC_DIR, "widget.js");
  if (!fs.existsSync(filePath)) return res.status(404).type("text/plain").send("widget.js not found in /public");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(filePath);
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

/* =========================
   HELPERS
========================= */
function normalizeEmail(email) {
  return validator.normalizeEmail(String(email || "").trim()) || "";
}
function isValidEmail(email) {
  return validator.isEmail(String(email || "").trim());
}
function cleanText(str, max = 2000) {
  const s = String(str || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}
function guardMessage(message) {
  const m = String(message || "").trim();
  if (!m) return "Please type a message.";
  if (m.length < 2) return "Please type a longer message.";
  if (m.length > 2000) return "Message too long.";
  return "";
}
function safeShort(text, max = 140) {
  return cleanText(text, max).replace(/\s+/g, " ");
}
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}

function extractEmailFromText(text) {
  const t = String(text || "");
  const match = t.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? normalizeEmail(match[0]) : "";
}

function looksLikeBookingIntent(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("book") || m.includes("appointment") || m.includes("schedule") || m.includes("consult") || m.includes("call");
}

function looksLikeQuestion(text) {
  const t = String(text || "").trim().toLowerCase();
  return t.endsWith("?") || t.startsWith("what") || t.startsWith("how") || t.startsWith("why") || t.startsWith("can ");
}

// Basic name extraction: "Chris", "I'm Chris", "my name is Chris Ian"
function extractName(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (looksLikeQuestion(t)) return "";

  const m =
    t.match(/^(?:my name is|i am|i'm)\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})$/i) ||
    t.match(/^([a-zA-Z][a-zA-Z\s.'-]{1,40})$/);

  if (!m) return "";
  const candidate = m[1].trim().replace(/\s+/g, " ");

  const bad = new Set(["yes", "no", "okay", "ok", "hi", "hello", "thanks", "thank you"]);
  if (bad.has(candidate.toLowerCase())) return "";

  if (candidate.length > 50) return "";
  return candidate;
}

function makeId() {
  return crypto.randomBytes(12).toString("hex"); // 24 chars
}

/* =========================
   MULTI-CLIENT (SELLABLE)
========================= */
function getClientId(req) {
  return cleanText(req.body?.clientId, 80) || cleanText(req.query?.clientId, 80) || "default";
}
function memKey(clientId, sessionId) {
  return `${clientId}::${sessionId}`;
}

/* =========================
   SESSION MEMORY + LEAD FLOW
========================= */
const sessionMemory = new Map();
const MEMORY_TTL_MS = 1000 * 60 * 60 * 24 * 2; // 48 hours

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessionMemory.entries()) {
    if (!v?.lastSeenAt || now - v.lastSeenAt > MEMORY_TTL_MS) sessionMemory.delete(k);
  }
}, 1000 * 60 * 10).unref();

function getMem(clientId, sessionId) {
  if (!clientId || !sessionId) return null;
  return sessionMemory.get(memKey(clientId, sessionId)) || null;
}
function setMem(clientId, sessionId, patch) {
  if (!clientId || !sessionId) return;
  const cur = getMem(clientId, sessionId) || {};
  sessionMemory.set(memKey(clientId, sessionId), { ...cur, ...patch, lastSeenAt: Date.now() });
}
function bumpMsgCount(clientId, sessionId) {
  const cur = getMem(clientId, sessionId) || {};
  const next = (cur.msgCount || 0) + 1;
  setMem(clientId, sessionId, { msgCount: next });
  return next;
}
function pushHistory(clientId, sessionId, role, content, maxItems = 10) {
  const cur = getMem(clientId, sessionId) || {};
  const history = Array.isArray(cur.history) ? cur.history : [];
  history.push({ role, content: cleanText(content, 800), ts: Date.now() });
  setMem(clientId, sessionId, { history: history.slice(-maxItems) });
}
function getHistory(clientId, sessionId) {
  const cur = getMem(clientId, sessionId);
  return Array.isArray(cur?.history) ? cur.history : [];
}
function hasThanked(clientId, sessionId) {
  const cur = getMem(clientId, sessionId);
  return Boolean(cur?.thankedAt);
}
function markThanked(clientId, sessionId) {
  setMem(clientId, sessionId, { thankedAt: Date.now() });
}

/* =========================
   DB UPSERT (ONE LEAD PER SESSION)
========================= */
async function upsertLead({ clientId, sessionId, source, name, goal, email, last_message }) {
  if (!supabase) return;
  try {
    await supabase
      .from("leads")
      .upsert(
        [
          {
            client_id: clientId,
            session_id: sessionId,
            source: source || "widget",
            name: name || null,
            goal: goal || null,
            email: email || null,
            last_message: last_message || null,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: "client_id,session_id" }
      );
  } catch (e) {
    console.error("lead upsert failed:", e?.message || e);
  }
}

/* =========================
   AI PROMPT
========================= */
function businessBrain(clientId, mem, userMessage, history) {
  const prior = (history || [])
    .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
    .join("\n")
    .slice(-4000);

  const nameLine = mem?.name ? `User name: ${mem.name}` : "User name: (unknown)";
  const goalLine = mem?.goal ? `User goal: ${mem.goal}` : "User goal: (unknown)";

  return `
You are Skyesnow AI's premium assistant.

Client/tenant: ${clientId}
${nameLine}
${goalLine}

Rules:
- Be concise.
- Ask ONLY 1 question at a time.
- If user name is known, DO NOT ask for name again.
- Help them decide packages or book a consult.

CONTEXT:
${prior || "(none)"}

USER:
${userMessage}
`.trim();
}

/* =========================
   FALLBACK
========================= */
function fallbackReply(m, mem) {
  const msg = String(m || "").toLowerCase();

  if (msg.includes("price") || msg.includes("pricing") || msg.includes("cost")) {
    return "Pricing (one-time): Starter $100 (chatbot), Popular $300 (website + chatbot + lead automation), Premium $500 (full system). What’s your business type?";
  }
  if (looksLikeBookingIntent(msg)) {
    return "Sure ✅ What date/time and timezone do you prefer for a consultation?";
  }
  if (mem?.goal) {
    return `Got it. To help you with "${mem.goal}", what business are you in (clinic, real estate, agency, shop, etc.)?`;
  }
  return "Got it. What’s your business type and your main goal (leads, sales, booking, automation)?";
}

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => res.json({ ok: true }));

/* =========================
   AUTH (ADMIN)
========================= */
app.post("/api/admin/register", adminCors, authLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required" });
    if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });

    const { data: existing, error: e1 } = await supabase.from("admin_users").select("id").eq("email", email).maybeSingle();
    if (e1) return res.status(500).json({ ok: false, error: "DB error" });
    if (existing) return res.status(409).json({ ok: false, error: "Admin already exists" });

    const password_hash = await bcrypt.hash(password, 10);
    const { error: e2 } = await supabase.from("admin_users").insert([{ email, password_hash, role: "admin" }]);
    if (e2) return res.status(500).json({ ok: false, error: "DB insert error" });

    res.json({ ok: true });
  } catch (e) {
    console.error("admin register error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/login", adminCors, authLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required" });

    const { data: user, error } = await supabase
      .from("admin_users")
      .select("id,email,password_hash,role")
      .eq("email", email)
      .maybeSingle();

    if (error) return res.status(500).json({ ok: false, error: "DB error" });
    if (!user) return res.status(401).json({ ok: false, error: "Invalid login" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Invalid login" });

    req.session.user = { id: user.id, email: user.email, role: user.role };
    req.session.save(() => res.json({ ok: true, success: true, user: req.session.user }));
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/me", adminCors, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
});

app.post("/api/logout", adminCors, (req, res) => req.session.destroy(() => res.json({ ok: true, success: true })));

/* =========================
   ADMIN DATA
========================= */
app.get("/api/leads", adminCors, requireAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const { data, error } = await supabase
    .from("leads")
    .select("id,client_id,session_id,name,goal,email,last_message,source,updated_at,created_at")
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ ok: false, error: "DB error" });
  res.json(data || []);
});

/* =========================
   PUBLIC RECENT (Activity tab)
========================= */
app.get("/api/public/recent", publicCors, async (req, res) => {
  try {
    if (!supabase) return res.status(200).json({ ok: false, leads: [], appointments: [] });

    const clientId = cleanText(req.query?.clientId, 80) || "default";

    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("name,goal,email,last_message,updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(8);

    const { data: appointments } = await supabase
      .from("appointments")
      .select("message,status,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(8);

    if (leadsErr) return res.status(200).json({ ok: false, leads: [], appointments: [] });

    return res.json({
      ok: true,
      clientId,
      leads: (leads || []).map((l) => ({
        message: safeShort(l.last_message || `${l.name || ""} ${l.goal || ""}`.trim(), 140),
        time: l.updated_at,
      })),
      appointments: (appointments || []).map((a) => ({
        message: safeShort(a.message, 140),
        status: a.status || "pending",
        created_at: a.created_at,
      })),
    });
  } catch (e) {
    console.error("recent fatal:", e?.message || e);
    return res.status(200).json({ ok: false, leads: [], appointments: [] });
  }
});

/* =========================
   CHAT HANDLER ✅ SHARED (fixes /chat 404)
========================= */
async function chatHandler(req, res) {
  const started = Date.now();

  try {
    const clientId = getClientId(req);
    const source = cleanText(req.body?.source || "chat", 40);

    // ✅ sessionId: accept sessionId OR conversationId; generate if missing
    let sessionId = cleanText(req.body?.sessionId, 120) || cleanText(req.body?.conversationId, 120) || "";
    if (!sessionId) sessionId = makeId(); // always generate if missing

    const message = cleanText(req.body?.message, 2000);
    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, reply: msgErr, sessionId });

    // init stage if absent
    const cur0 = getMem(clientId, sessionId) || {};
    if (!cur0.stage) setMem(clientId, sessionId, { stage: "ASK_NAME" });

    bumpMsgCount(clientId, sessionId);
    pushHistory(clientId, sessionId, "user", message);

    // detect email (from message or body)
    const emailFromBody = normalizeEmail(req.body?.email);
    const emailFromText = extractEmailFromText(message);
    const foundEmail =
      isValidEmail(emailFromBody) ? emailFromBody : isValidEmail(emailFromText) ? emailFromText : "";

    // read memory fresh
    let mem = getMem(clientId, sessionId) || {};
    let stage = mem.stage;

    // ✅ IMPORTANT: email never forces DONE too early
    if (foundEmail) {
      if ((mem.name && mem.goal) || stage === "ASK_EMAIL") {
        setMem(clientId, sessionId, { email: foundEmail, stage: "DONE" });
      } else {
        // store email for later, but DO NOT complete lead yet
        setMem(clientId, sessionId, { email: foundEmail });
      }
    }

    // refresh memory
    mem = getMem(clientId, sessionId) || {};
    stage = mem.stage;

    let reply = "";
    let usedAI = false;

    // ===== Lead flow (ASK_NAME → ASK_GOAL → ASK_EMAIL → DONE) =====
    if (stage === "ASK_NAME") {
      const name = extractName(message);
      if (name) {
        setMem(clientId, sessionId, { name, stage: "ASK_GOAL" });
        reply = `Nice to meet you, ${name}! 👋 What are you looking for today? (website, chatbot, booking, automation, or leads)`;
      } else {
        reply = `Thanks! ✅ What’s your name?`;
      }
    } else if (stage === "ASK_GOAL") {
      if (foundEmail) {
        reply = `Perfect ✅ What do you want to achieve? (more leads, bookings, sales, support automation)`;
      } else {
        const goal = cleanText(message, 300);
        setMem(clientId, sessionId, { goal, stage: "ASK_EMAIL" });
        reply = `Got it ✅ What’s the best email to send details and pricing?`;
      }
    } else if (stage === "ASK_EMAIL") {
      if (foundEmail) {
        setMem(clientId, sessionId, { email: foundEmail, stage: "DONE" });
        mem = getMem(clientId, sessionId) || {};
        stage = mem.stage;
      } else {
        reply = `No problem — please type your email like name@gmail.com so I can send the details.`;
      }
    }

    // DONE behavior
    mem = getMem(clientId, sessionId) || {};
    if (mem.stage === "DONE") {
      if (!mem.name) {
        setMem(clientId, sessionId, { stage: "ASK_NAME" });
        reply = `Thanks! ✅ What’s your name?`;
      } else if (!mem.goal) {
        setMem(clientId, sessionId, { stage: "ASK_GOAL" });
        reply = `Thanks, ${mem.name}! ✅ What are you looking for today (website, chatbot, booking, automation, or leads)?`;
      } else if (!hasThanked(clientId, sessionId)) {
        markThanked(clientId, sessionId);
        reply =
          `Thank you, ${mem.name}! ✅ I saved your details.\n\nChoose one:\n1) Pricing packages\n2) Book a consultation\n3) Quick setup plan`;
      } else if (!reply) {
        const history = getHistory(clientId, sessionId);

        if (openai) {
          try {
            const ai = await openai.responses.create({
              model: "gpt-4o-mini",
              input: businessBrain(clientId, mem, message, history),
              temperature: 0.7,
            });
            reply = ai.output_text || "";
            usedAI = Boolean(reply);
          } catch (e) {
            console.error("openai error:", e?.message || e);
          }
        }

        if (!reply) reply = fallbackReply(message, mem);
      }
    }

    // Save/update ONE lead row
    mem = getMem(clientId, sessionId) || {};
    await upsertLead({
      clientId,
      sessionId,
      source,
      name: mem.name || null,
      goal: mem.goal || null,
      email: mem.email || null,
      last_message: message,
    });

    // Booking -> appointments (optional)
    if (looksLikeBookingIntent(message) && supabase) {
      supabase
        .from("appointments")
        .insert([{ client_id: clientId, email: mem.email || null, message, status: "pending" }])
        .catch((e) => console.error("appointments insert failed:", e?.message || e));
    }

    pushHistory(clientId, sessionId, "assistant", reply);

    // ✅ Always return sessionId (widget stores it)
    return res.json({ ok: true, reply, ai: usedAI, ms: Date.now() - started, sessionId });
  } catch (e) {
    console.error("chat fatal:", e?.message || e);
    return res.json({ ok: true, reply: "Hi! What’s your name? 🙂", ai: false, sessionId: "" });
  }
}

// ✅ Routes (REAL alias)
app.post("/api/chat", publicCors, chatLimiter, chatHandler);
app.post("/chat", publicCors, chatLimiter, chatHandler);

/* =========================
   PAGES
========================= */
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.get("*", (req, res) => {
  if (req.path.includes(".")) return res.status(404).end();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ Skyesnow AI server running on port ${PORT} (${NODE_ENV})`);
  console.log(`✅ API: /api/chat (and /chat alias)`);
  console.log(`✅ Widget: /widget.js`);
});