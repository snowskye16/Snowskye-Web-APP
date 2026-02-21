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
 * If your frontend is hosted on a different domain, set:
 * FRONTEND_ORIGIN="https://your-frontend-domain.com"
 * If empty, origin: true (ok for same-origin + dev).
 */
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").trim();

/**
 * If frontend is on DIFFERENT domain AND you need cookies across sites:
 * CROSS_SITE="true"
 * Otherwise keep "false" (recommended for same-domain deployments).
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* =========================
   OPENAI (optional)
========================= */
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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

app.use(
  cors({
    origin: FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : true,
    credentials: true,
  })
);

// Global limiter
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 900,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(
  session({
    name: "snowskye.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD, // MUST be true on HTTPS in prod
      sameSite: IS_PROD ? (CROSS_SITE ? "none" : "lax") : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

/* =========================
   STATIC FILES
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
    m.includes("call") ||
    m.includes("consult")
  );
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
- Never claim an appointment is confirmed unless staff confirms

User message:
${userMessage}
`.trim();
}

/* =========================
   ROUTE LIMITERS (premium)
========================= */
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true, env: NODE_ENV }));

/* =========================
   AUTH (ADMIN)
========================= */

// Create admin once (optional)
app.post("/api/admin/register", authLimiter, async (req, res) => {
  try {
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

// Login (SESSION cookie)
app.post("/api/login", authLimiter, async (req, res) => {
  try {
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
    res.json({ ok: true, success: true, user: req.session.user });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Compatibility alias for your login.html (it calls /admin/login)
app.post("/admin/login", authLimiter, (req, res, next) => {
  req.url = "/api/login";
  next();
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true, success: true }));
});

// Compatibility alias (your dashboard uses /logout)
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true, success: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: req.session.user });
});

/* =========================
   ADMIN DATA (DASHBOARD)
========================= */
async function getLeads(req, res) {
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
      time: x.created_at, // dashboard uses "time"
      created_at: x.created_at,
      source: x.source || "chat",
      session_id: x.session_id || "",
    }))
  );
}

async function getAppointments(req, res) {
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
      created: x.created_at, // dashboard uses "created"
      created_at: x.created_at,
    }))
  );
}

app.get("/api/admin/leads", requireAuth, getLeads);
app.get("/api/admin/appointments", requireAuth, getAppointments);

// Compatibility routes (your dashboard fetches these)
app.get("/api/leads", requireAuth, getLeads);
app.get("/api/appointments", requireAuth, getAppointments);

/* =========================
   PUBLIC RECENT (Widget Activity tab)
========================= */
app.get("/api/public/recent", async (req, res) => {
  try {
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
    res.status(200).json({ ok: false, leads: [], appointments: [] });
  }
});

/* =========================
   CHAT (Widget + Contact pages)
========================= */
app.post("/api/chat", chatLimiter, async (req, res) => {
  const started = Date.now();

  try {
    const message = cleanText(req.body?.message, 2000);
    const email = normalizeEmail(req.body?.email);
    const sessionId = cleanText(req.body?.sessionId, 120) || "";
    const source = cleanText(req.body?.source || "chat", 40);

    const msgErr = guardMessage(message);
    if (msgErr) return res.status(400).json({ ok: false, reply: msgErr });

    // 1) Try saving lead, but NEVER block the reply if DB fails
    try {
      await supabase.from("leads").insert([
        {
          email: isValidEmail(email) ? email : null,
          message,
          source,
          session_id: sessionId || null,
        },
      ]);
    } catch (dbErr) {
      console.error("leads insert failed:", dbErr?.message || dbErr);
    }

    // 2) AI reply (still works even if DB insert failed)
    let reply = "AI not configured. Set OPENAI_API_KEY.";

    if (openai) {
      try {
        const ai = await openai.responses.create({
          model: "gpt-4o-mini",
          input: businessBrain(message),
          temperature: 0.7,
        });
        reply = ai.output_text || "Sorry, I couldn't generate a reply.";
      } catch (aiErr) {
        console.error("openai error:", aiErr?.message || aiErr);
        reply = "Assistant temporarily unavailable. Please try again in a moment.";
      }
    }

    // 3) Booking intent => also try saving appointment, but don’t block reply
    if (looksLikeBookingIntent(message)) {
      try {
        await supabase.from("appointments").insert([
          {
            email: isValidEmail(email) ? email : null,
            message,
            status: "pending",
          },
        ]);
      } catch (dbErr) {
        console.error("appointments insert failed:", dbErr?.message || dbErr);
      }

      reply += "\n\n📅 To book: send your name + email + preferred date/time + timezone.";
    }

    res.json({ ok: true, reply, ms: Date.now() - started });
  } catch (e) {
    console.error("chat route error:", e);
    res.status(500).json({ ok: false, reply: "Assistant temporarily unavailable." });
  }
});

// Compatibility alias for widget (your widget calls `${API_BASE}/chat`)
app.post("/chat", chatLimiter, (req, res, next) => {
  req.url = "/api/chat";
  next();
});

/* =========================
   LEAD FORM COMPATIBILITY
   Your old pages POST /lead
========================= */
app.post("/lead", leadLimiter, async (req, res) => {
  try {
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
    res.status(500).json({ ok: false });
  }
});

// Optional: also accept /api/lead
app.post("/api/lead", leadLimiter, (req, res, next) => {
  req.url = "/lead";
  next();
});

/* =========================
   HOME + FALLBACK
========================= */
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
// ✅ Prevent GET /chat 404 (browser probe / devtools)
app.get("/chat", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Chat endpoint ready. Use POST /api/chat",
  });
});
// ✅ Only fallback for pages (NOT files)
app.get("*", (req, res) => {
  // if request looks like a file, return 404 (so /widget.js works correctly)
  if (req.path.includes(".")) return res.status(404).send("Not found");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ SnowSkyeAI server running on port ${PORT} (${NODE_ENV})`);
});