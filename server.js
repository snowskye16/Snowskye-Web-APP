/**
 * ✅ SnowSkyeAI server.js (CLEAN UPGRADE)
 *
 * Goals:
 * ✅ Widget works cross-domain without cookies (public routes)
 * ✅ Admin dashboard uses sessions (same domain)
 * ✅ ALWAYS replies (OpenAI down => fallback)
 * ✅ Email capture stops repeating once captured (per sessionId)
 * ✅ Saves leads + booking intent to Supabase (never blocks reply)
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

// CORS allowlist (recommended once your front-end domain is final)
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
    crossOriginResourcePolicy: { policy: "cross-origin" }, // widget/icon usable on other domains
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
   - Public widget/chat: no cookies needed
   - Admin routes: allow cookies (same site on Render)
========================= */

// Public: allow cross-domain; no credentials needed
const publicCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (!LOCK_CORS) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
});

// Admin: sessions/cookies (works best if admin pages served from SAME Render domain)
const adminCors = cors({
  origin: (origin, cb) => {
    // If admin is served on same domain, origin is same and OK.
    // If you ever host dashboard on another domain, you must LOCK and allowlist it.
    if (!origin) return cb(null, true);
    if (!LOCK_CORS) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
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
      sameSite: "lax", // ✅ best when /login + /dashboard are on Render domain
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

/* =========================
   STATIC
========================= */
app.use((req, res, next) => {
  // cache widget.js for speed
  if (req.path === "/widget.js") {
    res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day
  }
  next();
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
function looksLikeBookingIntent(message) {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("book") ||
    m.includes("appointment") ||
    m.includes("schedule") ||
    m.includes("consult") ||
    m.includes("call")
  );
}
function extractEmailFromText(text) {
  const t = String(text || "");
  const match = t.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? normalizeEmail(match[0]) : "";
}

/* =========================
   EMAIL STOP-LOOP FIX (per sessionId)
   - remembers per sessionId for a while
   - once email is captured, widget stops asking
========================= */
const sessionMemory = new Map();
// sessionMemory.get(sessionId) => { email, emailCapturedAt, askedEmailAt }

function getSessionMem(sessionId) {
  if (!sessionId) return null;
  const v = sessionMemory.get(sessionId) || null;
  if (!v) return null;

  // TTL cleanup: 14 days
  const ttlMs = 14 * 24 * 60 * 60 * 1000;
  const last = v.emailCapturedAt || v.askedEmailAt || 0;
  if (last && Date.now() - last > ttlMs) {
    sessionMemory.delete(sessionId);
    return null;
  }
  return v;
}

function setSessionEmail(sessionId, email) {
  if (!sessionId || !email) return;
  sessionMemory.set(sessionId, {
    ...(sessionMemory.get(sessionId) || {}),
    email,
    emailCapturedAt: Date.now(),
  });
}

function markAskedEmail(sessionId) {
  if (!sessionId) return;
  sessionMemory.set(sessionId, {
    ...(sessionMemory.get(sessionId) || {}),
    askedEmailAt: Date.now(),
  });
}

function shouldAskEmail(sessionId) {
  // Ask email only if we do NOT already have it,
  // and we haven’t asked in the last ~5 minutes (prevents spam looping).
  const mem = getSessionMem(sessionId);
  if (mem?.email) return false;
  const asked = mem?.askedEmailAt || 0;
  const cooldownMs = 5 * 60 * 1000;
  return !asked || Date.now() - asked > cooldownMs;
}

/* =========================
   AI PROMPT
========================= */
function businessBrain(userMessage) {
  return `
You are SnowSkyeAI's premium AI assistant for an AI Website + Chatbot agency.

GOALS:
- Explain services (websites, chatbots, automation, booking, lead capture)
- Qualify leads (business type, goal, timeline, budget)
- Convert to next step (book a call / leave contact)

RULES:
- Professional, confident, concise
- Ask 1–2 questions at a time
- If user asks pricing: give packages/ranges then ask requirements
- Never claim an appointment is confirmed unless a human confirms

User message:
${userMessage}
`.trim();
}

/* =========================
   FALLBACK (ALWAYS REPLY)
========================= */
const FALLBACK = {
  greet: "Hi! I’m SnowSkyeAI. What type of business do you run and what’s your goal (leads, sales, or automation)?",
  pricing:
    "Pricing is one-time (no monthly fees): Starter $100 (chatbot), Popular $300 (website + chatbot + lead automation), Premium $500 (full system). What business type is this for?",
  booking:
    "To book: please share your name, email, preferred date/time, and timezone. I’ll mark it as pending for follow-up.",
};

function fallbackReply(message) {
  const m = String(message || "").toLowerCase();
  if (m.includes("price") || m.includes("pricing") || m.includes("how much")) return FALLBACK.pricing;
  if (looksLikeBookingIntent(m)) return FALLBACK.booking;
  if (m.includes("website")) return "Nice — what kind of website do you need (clinic, agency, e-commerce, personal brand)?";
  if (m.includes("chatbot")) return "Great — where do you want the chatbot (website, Facebook, IG, WhatsApp)?";
  return "Got it. What’s your #1 goal right now — more leads, more sales, or automate support?";
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

    const { data: existing, error: e1 } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
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
   ADMIN DATA (DASHBOARD)
========================= */
async function getLeads(req, res) {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const { data, error } = await supabase
    .from("leads")
    .select("id,email,message,source,session_id,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ ok: false, error: "DB error" });

  res.json(
    (data || []).map((x) => ({
      id: x.id,
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
    .select("id,email,message,status,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ ok: false, error: "DB error" });

  res.json(
    (data || []).map((x) => ({
      id: x.id,
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
   PUBLIC RECENT (WIDGET ACTIVITY)
========================= */
app.get("/api/public/recent", publicCors, async (req, res) => {
  try {
    if (!supabase) return res.status(200).json({ ok: false, leads: [], appointments: [] });

    const { data: leads } = await supabase
      .from("leads")
      .select("message,created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    const { data: appointments } = await supabase
      .from("appointments")
      .select("message,status,created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    res.json({
      ok: true,
      leads: (leads || []).map((l) => ({ message: safeShort(l.message, 140), time: l.created_at })),
      appointments: (appointments || []).map((a) => ({
        message: safeShort(a.message, 140),
        status: a.status || "pending",
        created_at: a.created_at,
      })),
    });
  } catch {
    res.status(200).json({ ok: false, leads: [], appointments: [] });
  }
});

/* =========================
   CHAT (WIDGET + WEBSITE)
   ✅ ALWAYS REPLY
   ✅ Email stops looping after captured
========================= */

// alias: POST /chat -> /api/chat
app.post("/chat", publicCors, chatLimiter, (req, res, next) => {
  req.url = "/api/chat";
  next();
});

async function getKnownEmailFromDB(sessionId) {
  if (!supabase || !sessionId) return "";
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("email,created_at")
      .eq("session_id", sessionId)
      .not("email", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

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

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, reply: msgErr });

    // Email capture logic (body > message text > memory > DB)
    const emailFromBody = normalizeEmail(req.body?.email);
    const emailFromText = extractEmailFromText(message);

    let email = "";
    if (isValidEmail(emailFromBody)) email = emailFromBody;
    else if (isValidEmail(emailFromText)) email = emailFromText;

    // If we got email now -> store in memory so we stop asking
    if (email) setSessionEmail(sessionId, email);

    // If no email, check memory first
    if (!email) {
      const mem = getSessionMem(sessionId);
      if (mem?.email && isValidEmail(mem.email)) email = mem.email;
    }

    // If still no email, optionally check DB (so email persists across reloads)
    if (!email) {
      const dbEmail = await getKnownEmailFromDB(sessionId);
      if (dbEmail) {
        email = dbEmail;
        setSessionEmail(sessionId, dbEmail);
      }
    }

    // ✅ Save lead (never block reply)
    if (supabase) {
      try {
        await supabase.from("leads").insert([
          {
            email: email ? email : null,
            message,
            source,
            session_id: sessionId || null,
          },
        ]);
      } catch (dbErr) {
        console.error("leads insert failed:", dbErr?.message || dbErr);
      }
    }

    // ✅ AI reply if available, else fallback (ALWAYS respond)
    let reply = "";
    let usedAI = false;

    if (openai) {
      try {
        const ai = await openai.responses.create({
          model: "gpt-4o-mini",
          input: businessBrain(message),
          temperature: 0.7,
        });
        reply = ai.output_text || "";
        usedAI = Boolean(reply);
      } catch (aiErr) {
        // OpenAI down => fallback
        console.error("openai error:", aiErr?.message || aiErr);
      }
    }

    if (!reply) reply = fallbackReply(message);

    // ✅ Booking intent => save appointment (never blocks reply)
    if (looksLikeBookingIntent(message) && supabase) {
      try {
        await supabase.from("appointments").insert([
          {
            email: email ? email : null,
            message,
            status: "pending",
          },
        ]);
      } catch (dbErr) {
        console.error("appointments insert failed:", dbErr?.message || dbErr);
      }

      // add booking helper only once (no spam)
      reply += "\n\n📅 To book faster: send preferred date/time + timezone.";
    }

    // ✅ Email prompt (ONLY if we truly don’t have email AND cooldown allows)
    if (!email && shouldAskEmail(sessionId)) {
      markAskedEmail(sessionId);
      reply += "\n\n✉️ What’s the best email to follow up with you?";
    }

    // ✅ If we have email, ask business questions instead (no email looping)
    if (email) {
      reply += "\n\n✅ Thanks! What type of business is this for, and what’s your target launch date?";
    }

    res.json({ ok: true, reply, ai: usedAI, ms: Date.now() - started });
  } catch (e) {
    console.error("chat route fatal:", e);
    // Always respond
    res.json({ ok: true, reply: FALLBACK.greet, ai: false });
  }
});

app.get("/api/chat", publicCors, (req, res) => res.status(200).json({ ok: true, note: "Use POST /api/chat" }));

/* =========================
   LEAD FORM (COMPAT)
========================= */
app.post("/lead", publicCors, leadLimiter, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });

    const message = cleanText(req.body?.message, 2000);
    const email = normalizeEmail(req.body?.email);

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, error: msgErr });

    await supabase.from("leads").insert([
      {
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
   PAGES (ADMIN on Render)
========================= */
app.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// Optional: if hosting homepage on backend too
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Fallback
app.get("*", (req, res) => {
  if (req.path.includes(".")) return res.status(404).end();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ SnowSkyeAI server running on port ${PORT} (${NODE_ENV})`);
  console.log(`✅ Widget URL: /widget.js (public/widget.js must exist)`);
});