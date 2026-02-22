/**
 * ✅ SnowSkyeAI server.js (SELLABLE + WIDGET MIME FIX + MULTI-CLIENT + NO-LOOP)
 *
 * Key upgrades:
 * ✅ /widget.js served with correct MIME (application/javascript)
 * ✅ Route ordering fixed (widget route BEFORE express.static)
 * ✅ Multi-tenant support via clientId (so you can sell it)
 * ✅ Anti-loop: remembers last questions + chat history
 * ✅ Email ask cooldown (no nagging)
 * ✅ Always replies (OpenAI down => fallback)
 * ✅ DB writes never block replies
 * ✅ CORS error handler so widget won’t silently fail
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

// CORS allowlist (optional)
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
   OPENAI
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
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 900,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 35,
  standardHeaders: true,
  legacyHeaders: false,
});
const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

/* =========================
   CORS (SPLIT)
========================= */
function allowOrigin(origin) {
  if (!origin) return true;
  if (!LOCK_CORS) return true;
  return allowedOrigins.includes(origin);
}

const publicCors = cors({
  origin: (origin, cb) => {
    if (allowOrigin(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
});

const adminCors = cors({
  origin: (origin, cb) => {
    if (allowOrigin(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
});

/* ✅ important: CORS error handler so widget gets JSON instead of crashing */
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
    name: "snowskye.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

/* =========================
   STATIC + WIDGET MIME FIX
========================= */
/** ✅ Put /widget.js route BEFORE express.static (ordering matters) */
app.get("/widget.js", (req, res) => {
  const filePath = path.join(PUBLIC_DIR, "widget.js");
  if (!fs.existsSync(filePath)) {
    return res.status(404).type("text/plain").send("widget.js not found in /public");
  }
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(filePath);
});

// Cache hint
app.use((req, res, next) => {
  if (req.path === "/widget.js") res.setHeader("Cache-Control", "public, max-age=86400");
  next();
});

// Serve assets
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("/debug/public-files", (req, res) => {
  try {
    const files = fs.readdirSync(PUBLIC_DIR);
    res.json({ ok: true, publicDir: PUBLIC_DIR, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
function looksLikeBookingIntent(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("book") || m.includes("appointment") || m.includes("schedule") || m.includes("consult") || m.includes("call");
}
function extractEmailFromText(text) {
  const t = String(text || "");
  const match = t.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? normalizeEmail(match[0]) : "";
}
function looksLikeLeadIntent(message) {
  const m = String(message || "").toLowerCase();
  return (
    looksLikeBookingIntent(m) ||
    m.includes("price") ||
    m.includes("pricing") ||
    m.includes("how much") ||
    m.includes("cost") ||
    m.includes("package") ||
    m.includes("quote") ||
    m.includes("contact") ||
    m.includes("email") ||
    m.includes("call")
  );
}

/* =========================
   MULTI-CLIENT (SELLABLE)
========================= */
function getClientId(req) {
  // You will send this from widget.js: { clientId }
  return cleanText(req.body?.clientId, 80) || "default";
}

/* =========================
   SESSION MEMORY (ANTI-LOOP)
========================= */
const sessionMemory = new Map();

function getSessionMem(sessionId) {
  if (!sessionId) return null;
  const v = sessionMemory.get(sessionId) || null;
  if (!v) return null;

  const ttlMs = 14 * 24 * 60 * 60 * 1000;
  const last =
    v.lastQuestionAt ||
    v.emailCapturedAt ||
    v.askedEmailAt ||
    v.thankedAt ||
    (v.history?.length ? v.history[v.history.length - 1].ts : 0) ||
    0;

  if (last && Date.now() - last > ttlMs) {
    sessionMemory.delete(sessionId);
    return null;
  }
  return v;
}

function bumpMsgCount(sessionId) {
  if (!sessionId) return 0;
  const cur = sessionMemory.get(sessionId) || {};
  const next = (cur.msgCount || 0) + 1;
  sessionMemory.set(sessionId, { ...cur, msgCount: next });
  return next;
}

function setSessionEmail(sessionId, email) {
  if (!sessionId || !email) return;
  const cur = sessionMemory.get(sessionId) || {};
  sessionMemory.set(sessionId, { ...cur, email, emailCapturedAt: Date.now() });
}

function markThanked(sessionId) {
  if (!sessionId) return;
  const cur = sessionMemory.get(sessionId) || {};
  sessionMemory.set(sessionId, { ...cur, thankedAt: Date.now() });
}
function hasThanked(sessionId) {
  const cur = getSessionMem(sessionId);
  return Boolean(cur?.thankedAt);
}

function setLastQuestion(sessionId, qKey) {
  if (!sessionId || !qKey) return;
  const cur = sessionMemory.get(sessionId) || {};
  sessionMemory.set(sessionId, { ...cur, lastQuestion: qKey, lastQuestionAt: Date.now() });
}
function lastQuestionIs(sessionId, qKey, withinMs = 10 * 60 * 1000) {
  const cur = getSessionMem(sessionId);
  if (!cur?.lastQuestion || cur.lastQuestion !== qKey) return false;
  if (!cur.lastQuestionAt) return true;
  return Date.now() - cur.lastQuestionAt < withinMs;
}

function pushHistory(sessionId, role, content, maxItems = 10) {
  if (!sessionId) return;
  const cur = sessionMemory.get(sessionId) || {};
  const history = Array.isArray(cur.history) ? cur.history : [];
  history.push({ role, content: cleanText(content, 800), ts: Date.now() });
  sessionMemory.set(sessionId, { ...cur, history: history.slice(-maxItems) });
}
function getHistory(sessionId) {
  const cur = getSessionMem(sessionId);
  return Array.isArray(cur?.history) ? cur.history : [];
}

function shouldAskEmail(sessionId, message, msgCount) {
  const mem = getSessionMem(sessionId);
  if (mem?.email) return false;

  // no nagging for 30 mins
  if (lastQuestionIs(sessionId, "ASK_EMAIL", 30 * 60 * 1000)) return false;

  const strongIntent = looksLikeLeadIntent(message);
  if (!strongIntent && (msgCount || 0) < 3) return false;

  return true;
}

/* =========================
   AI PROMPT
========================= */
function businessBrain(clientId, userMessage, history) {
  const prior = (history || [])
    .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
    .join("\n")
    .slice(-4000);

  return `
You are SnowSkyeAI's premium assistant.

Client/tenant: ${clientId}

GOALS:
- Explain services (websites, chatbots, automation, booking, lead capture)
- Qualify leads (business type, goal, timeline, budget)
- Convert to next step (book a call / leave contact)

ANTI-LOOP RULES:
- Do NOT repeat the same question if it was just asked.
- Ask only 1 question at a time.
- If user ignores a question, offer options instead of repeating.

CONTEXT:
${prior || "(none)"}

USER:
${userMessage}
`.trim();
}

/* =========================
   FALLBACK (ANTI-LOOP)
========================= */
const FALLBACK = {
  greet: "Hi! I’m SnowSkyeAI. What type of business do you run and what’s your goal (leads, sales, or automation)?",
  pricing:
    "Pricing is one-time (no monthly fees): Starter $100 (chatbot), Popular $300 (website + chatbot + lead automation), Premium $500 (full system). What business type is this for and what features do you need?",
  booking:
    "To book: please share your name, email, preferred date/time, and timezone. I’ll mark it as pending for follow-up.",
};

function premiumFallbackReply(message, sessionId) {
  const m = String(message || "").toLowerCase();

  if (m.includes("price") || m.includes("pricing") || m.includes("how much") || m.includes("cost")) {
    setLastQuestion(sessionId, "PRICING");
    return FALLBACK.pricing;
  }
  if (looksLikeBookingIntent(m)) {
    setLastQuestion(sessionId, "BOOKING");
    return FALLBACK.booking;
  }

  if (!lastQuestionIs(sessionId, "BIZ_TYPE_Q")) {
    setLastQuestion(sessionId, "BIZ_TYPE_Q");
    return "What type of business is this (clinic, agency, shop, services)?";
  }
  if (!lastQuestionIs(sessionId, "GOAL_Q")) {
    setLastQuestion(sessionId, "GOAL_Q");
    return "What’s your #1 goal: more leads, more sales, or automate support?";
  }

  setLastQuestion(sessionId, "NEXT_STEP_Q");
  return "Do you want pricing, a setup plan, or to book a quick call?";
}

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/config", (req, res) =>
  res.json({
    ok: true,
    env: NODE_ENV,
    aiEnabled: Boolean(openai),
    supabaseEnabled: Boolean(supabase),
    lockCors: LOCK_CORS,
    allowedOrigins: LOCK_CORS ? allowedOrigins : "ALL (LOCK_CORS=false)",
  })
);

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
app.post("/logout", adminCors, (req, res) => req.session.destroy(() => res.json({ ok: true, success: true })));

/* =========================
   ADMIN DATA
========================= */
async function getLeads(req, res) {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const { data, error } = await supabase
    .from("leads")
    .select("id,client_id,email,message,source,session_id,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ ok: false, error: "DB error" });

  res.json(
    (data || []).map((x) => ({
      id: x.id,
      client_id: x.client_id || "default",
      email: x.email || "",
      message: x.message || "",
      time: x.created_at,
      source: x.source || "chat",
      session_id: x.session_id || "",
    }))
  );
}

async function getAppointments(req, res) {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const { data, error } = await supabase
    .from("appointments")
    .select("id,client_id,email,message,status,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ ok: false, error: "DB error" });

  res.json(
    (data || []).map((x) => ({
      id: x.id,
      client_id: x.client_id || "default",
      email: x.email || "",
      message: x.message || "",
      status: x.status || "pending",
      created_at: x.created_at,
    }))
  );
}

app.get("/api/leads", adminCors, requireAuth, getLeads);
app.get("/api/appointments", adminCors, requireAuth, getAppointments);
/* =========================
   PUBLIC RECENT (WIDGET ACTIVITY) — MULTI CLIENT SAFE ✅
   GET /api/public/recent?clientId=buyer_001
========================= */
app.get("/api/public/recent", publicCors, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(200).json({ ok: false, leads: [], appointments: [] });
    }

    // ✅ Client filter (SELLABLE)
    const clientId = cleanText(req.query?.clientId, 80) || "default";

    const leadsQ = supabase
      .from("leads")
      .select("message,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(8);

    const appsQ = supabase
      .from("appointments")
      .select("message,status,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(8);

    const [{ data: leads, error: leadsErr }, { data: appointments, error: appsErr }] =
      await Promise.all([leadsQ, appsQ]);

    if (leadsErr || appsErr) {
      console.error("recent route error:", leadsErr?.message || leadsErr, appsErr?.message || appsErr);
      return res.status(200).json({ ok: false, leads: [], appointments: [] });
    }

    return res.json({
      ok: true,
      clientId,
      leads: (leads || []).map((l) => ({
        message: safeShort(l.message, 140),
        time: l.created_at,
      })),
      appointments: (appointments || []).map((a) => ({
        message: safeShort(a.message, 140),
        status: a.status || "pending",
        created_at: a.created_at,
      })),
    });
  } catch (e) {
    console.error("recent route fatal:", e?.message || e);
    return res.status(200).json({ ok: false, leads: [], appointments: [] });
  }
});

/* =========================
   CHAT
========================= */
app.post("/chat", publicCors, chatLimiter, (req, res, next) => {
  req.url = "/api/chat";
  next();
});

async function getKnownEmailFromDB(sessionId, clientId) {
  if (!supabase || !sessionId) return "";
  try {
    const q = supabase
      .from("leads")
      .select("email,created_at")
      .eq("session_id", sessionId)
      .not("email", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    // if you add client_id column, filter by it
    // q.eq("client_id", clientId);

    const { data, error } = await q;
    if (error) return "";
    const e = normalizeEmail(data?.[0]?.email || "");
    return isValidEmail(e) ? e : "";
  } catch {
    return "";
  }
}

app.post("/api/chat", publicCors, chatLimiter, async (req, res) => {
  const started = Date.now();

  try {
    const message = cleanText(req.body?.message, 2000);
    const source = cleanText(req.body?.source || "chat", 40);
    const sessionId = cleanText(req.body?.sessionId, 120) || "";
    const clientId = getClientId(req);

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, reply: msgErr });

    const msgCount = bumpMsgCount(sessionId);

    // Email capture
    const emailFromBody = normalizeEmail(req.body?.email);
    const emailFromText = extractEmailFromText(message);

    let email = "";
    if (isValidEmail(emailFromBody)) email = emailFromBody;
    else if (isValidEmail(emailFromText)) email = emailFromText;

    if (email) setSessionEmail(sessionId, email);

    if (!email) {
      const mem = getSessionMem(sessionId);
      if (mem?.email && isValidEmail(mem.email)) email = mem.email;
    }

    if (!email) {
      const dbEmail = await getKnownEmailFromDB(sessionId, clientId);
      if (dbEmail) {
        email = dbEmail;
        setSessionEmail(sessionId, dbEmail);
      }
    }

    // History for anti-loop AI
    pushHistory(sessionId, "user", message);
    const history = getHistory(sessionId);

    // Save lead (never block reply)
    if (supabase) {
      supabase
        .from("leads")
        .insert([
          {
            client_id: clientId, // ✅ add this column in DB
            email: email ? email : null,
            message,
            source,
            session_id: sessionId || null,
          },
        ])
        .catch((e) => console.error("leads insert failed:", e?.message || e));
    }

    let reply = "";
    let usedAI = false;

    if (openai) {
      try {
        const ai = await openai.responses.create({
          model: "gpt-4o-mini",
          input: businessBrain(clientId, message, history),
          temperature: 0.7,
        });
        reply = ai.output_text || "";
        usedAI = Boolean(reply);
      } catch (aiErr) {
        console.error("openai error:", aiErr?.message || aiErr);
      }
    }

    if (!reply) reply = premiumFallbackReply(message, sessionId);

    if (looksLikeBookingIntent(message) && supabase) {
      supabase
        .from("appointments")
        .insert([
          {
            client_id: clientId, // ✅ add this column in DB
            email: email ? email : null,
            message,
            status: "pending",
          },
        ])
        .catch((e) => console.error("appointments insert failed:", e?.message || e));

      reply += "\n\n📅 To book faster: send preferred date/time + timezone.";
    }

    if (!email && shouldAskEmail(sessionId, message, msgCount)) {
      setLastQuestion(sessionId, "ASK_EMAIL");
      reply += "\n\n✉️ If you want, leave your email and I’ll send pricing + next steps.";
    }

    if (email && !hasThanked(sessionId)) {
      markThanked(sessionId);
      reply += "\n\n✅ Thanks! What type of business is this for, and what’s your target launch date?";
    }

    pushHistory(sessionId, "assistant", reply);

    res.json({ ok: true, reply, ai: usedAI, ms: Date.now() - started });
  } catch (e) {
    console.error("chat route fatal:", e);
    res.json({ ok: true, reply: FALLBACK.greet, ai: false });
  }
});

app.get("/api/chat", publicCors, (req, res) => res.status(200).json({ ok: true, note: "Use POST /api/chat" }));

/* =========================
   LEAD FORM
========================= */
app.post("/lead", publicCors, leadLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

    const message = cleanText(req.body?.message, 2000);
    const email = normalizeEmail(req.body?.email);
    const clientId = getClientId(req);

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, error: msgErr });

    await supabase.from("leads").insert([
      {
        client_id: clientId,
        email: isValidEmail(email) ? email : null,
        message,
        source: "lead_form",
      },
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error("lead error:", e);
    res.status(500).json({ ok: false });
  }
});

app.post("/api/lead", publicCors, leadLimiter, (req, res, next) => {
  req.url = "/lead";
  next();
});

/* =========================
   PAGES (ADMIN)
========================= */
app.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.includes(".")) return res.status(404).end();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ SnowSkyeAI server running on port ${PORT} (${NODE_ENV})`);
  console.log(`✅ API: /api/chat`);
  console.log(`✅ Optional widget (if hosted here): /widget.js`);
});