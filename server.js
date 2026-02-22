/**
 * ✅ SnowSkyeAI server.js (FULL FIX + PREMIUM UPGRADE)
 * - ✅ Public website works on your URL (serves /public/index.html)
 * - ✅ Widget + website chat both work (/api/chat + /chat alias)
 * - ✅ AI ALWAYS replies (OpenAI failure => smart fallback reply)
 * - ✅ Always saves leads (DB failure never blocks reply)
 * - ✅ Strong lead-capture flow (asks for email + business info)
 * - ✅ Protected dashboard (/dashboard) + login (/login)
 * - ✅ Render-ready sessions (proxy + secure cookies)
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

/**
 * If you host frontend on another domain, set:
 * FRONTEND_ORIGIN="https://your-frontend.com"
 * If empty => same-origin/dev ok.
 */
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").trim();

/**
 * If cross-site cookies are required (frontend different domain):
 * CROSS_SITE="true"
 */
const CROSS_SITE = String(process.env.CROSS_SITE || "false").toLowerCase() === "true";

/* =========================
   SUPABASE
========================= */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

/* =========================
   OPENAI (optional)
========================= */
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/* =========================
   SECURITY + MIDDLEWARE
========================= */
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // keep simple for static site + widget
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(compression());
app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: true, limit: "300kb" }));

app.use(
  cors({
    origin: FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : true,
    credentials: true,
  })
);

/* =========================
   RATE LIMITERS
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
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const widgetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

/* =========================
   SESSION (Render-ready)
========================= */
app.use(
  session({
    name: "snowskye.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    proxy: true, // ✅ important on Render/proxies
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? (CROSS_SITE ? "none" : "lax") : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

/* =========================
   STATIC FILES (PUBLIC WEBSITE)
========================= */
app.use(express.static(PUBLIC_DIR));

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
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}
function looksLikeBookingIntent(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("book") || m.includes("appointment") || m.includes("schedule") || m.includes("call") || m.includes("consult");
}
function extractEmailFromText(text) {
  const t = String(text || "");
  const match = t.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? normalizeEmail(match[0]) : "";
}
function safeShort(text, max = 140) {
  return cleanText(text, max).replace(/\s+/g, " ");
}

/* =========================
   AI PROMPT (SnowSkyeAI)
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
- Always try to capture a lead email gently
- Never claim an appointment is confirmed unless staff confirms

User message:
${userMessage}
`.trim();
}

/* =========================
   FALLBACK (Always Reply)
========================= */
const FALLBACK = {
  greet: "Hi! I’m SnowSkyeAI. What type of business do you run and what’s your goal (leads, sales, or automation)?",
  askGoal: "Got it. What’s your #1 goal right now — more leads, more sales, or automate support?",
  askEmail: "What’s the best email to follow up with you? (So I can send the next steps.)",
  pricing:
    "Pricing is one-time (no monthly fees): Starter $100 (chatbot), Popular $300 (website + chatbot + lead automation), Premium $500 (full system). What business type is this for?",
  booking: "To book: send your name, email, preferred date/time, and timezone. I’ll mark it as pending for follow-up.",
  offline: "I can still help even if AI is busy. What’s your business type and what do you want to achieve?",
};

function fallbackReply(message) {
  const m = String(message || "").toLowerCase();
  if (m.includes("price") || m.includes("pricing") || m.includes("how much")) return FALLBACK.pricing;
  if (looksLikeBookingIntent(m)) return FALLBACK.booking;
  if (m.includes("website")) return "Nice — what kind of website do you need (clinic, agency, e-commerce, personal brand)?";
  if (m.includes("chatbot")) return "Great — where do you want the chatbot (website, Facebook, IG, WhatsApp)?";
  return FALLBACK.askGoal;
}

/* =========================
   HEALTH + CONFIG
========================= */
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true, env: NODE_ENV }));
app.get("/api/config", (req, res) =>
  res.json({
    ok: true,
    env: NODE_ENV,
    aiEnabled: Boolean(openai),
    supabaseEnabled: Boolean(supabase),
  })
);

/* =========================
   AUTH (ADMIN)
========================= */

// Create admin once (optional)
app.post("/api/admin/register", authLimiter, async (req, res) => {
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

// Login (SESSION cookie)
app.post("/api/login", authLimiter, async (req, res) => {
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

// Compatibility alias
app.post("/admin/login", authLimiter, (req, res, next) => {
  req.url = "/api/login";
  next();
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true, success: true })));
app.post("/logout", (req, res) => req.session.destroy(() => res.json({ ok: true, success: true })));

app.get("/api/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
});

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
      created_at: x.created_at,
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
      created: x.created_at,
      created_at: x.created_at,
    }))
  );
}

app.get("/api/admin/leads", requireAuth, getLeads);
app.get("/api/admin/appointments", requireAuth, getAppointments);
app.get("/api/leads", requireAuth, getLeads);
app.get("/api/appointments", requireAuth, getAppointments);

/* =========================
   PUBLIC RECENT (Widget Activity)
========================= */
app.get("/api/public/recent", async (req, res) => {
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
   CHAT (Website + Widget)
========================= */

// ✅ widget alias: POST /chat -> /api/chat
app.post("/chat", widgetLimiter, (req, res, next) => {
  req.url = "/api/chat";
  next();
});

// ✅ one real handler
app.post("/api/chat", chatLimiter, async (req, res) => {
  const started = Date.now();

  try {
    const message = cleanText(req.body?.message, 2000);
    const source = cleanText(req.body?.source || "chat", 40);
    const sessionId = cleanText(req.body?.sessionId, 120) || "";

    // Accept email from body OR try to extract from message text
    const emailFromBody = normalizeEmail(req.body?.email);
    const emailFromText = extractEmailFromText(message);
    const email = isValidEmail(emailFromBody) ? emailFromBody : isValidEmail(emailFromText) ? emailFromText : "";

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, reply: msgErr });

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

    // ✅ AI reply, fallback always
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
        console.error("openai error:", aiErr?.message || aiErr);
      }
    }

    if (!reply) reply = fallbackReply(message);
    if (!reply) reply = FALLBACK.offline;

    // ✅ Booking intent => save appointment
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

      reply += "\n\n📅 To book faster: send your name + email + preferred date/time + timezone.";
    }

    // ✅ Lead capture (ask email if not known)
    if (!email) {
      reply += "\n\n✉️ What’s the best email to follow up with you?";
    } else {
      // If we got email, ask 1 key qualifier to convert
      reply += "\n\n✅ Thanks! What type of business is this for, and what’s your target launch date?";
    }

    res.json({ ok: true, reply, ai: usedAI, ms: Date.now() - started });
  } catch (e) {
    console.error("chat route fatal:", e);
    // Always reply even on fatal error
    res.json({ ok: true, reply: FALLBACK.greet, ai: false });
  }
});

app.get("/chat", (req, res) => res.status(200).json({ ok: true, note: "Use POST /api/chat" }));
app.get("/api/chat", (req, res) => res.status(200).json({ ok: true, note: "Use POST /api/chat" }));

/* =========================
   LEAD FORM COMPATIBILITY
========================= */
app.post("/lead", leadLimiter, async (req, res) => {
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
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post("/api/lead", leadLimiter, (req, res, next) => {
  req.url = "/lead";
  next();
});

/* =========================
   PAGES (WEBSITE)
========================= */

// ✅ Home => public/index.html
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ✅ Nice routes
app.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  return res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  return res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// ✅ Fallback only for "pages" (NOT files)
app.get("*", (req, res) => {
  if (req.path.includes(".")) return res.status(404).send("Not found");
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ SnowSkyeAI server running on port ${PORT} (${NODE_ENV})`);
});