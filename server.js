require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const validator = require("validator");
const crypto = require("crypto");

const app = express();

/* =========================
   CONFIG
========================= */
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const APPOINTMENTS_FILE = path.join(DATA_DIR, "appointments.json");

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Optional: lock CORS to your frontend domain in production
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;

/* =========================
   OPENAI SETUP
========================= */
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* =========================
   EMAIL SETUP
========================= */
const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      })
    : null;

/* =========================
   MIDDLEWARE
========================= */
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(compression());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(
  cors({
    origin: FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : true,
    credentials: true,
    methods: ["GET", "POST"],
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
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
      secure: IS_PROD,
      sameSite: IS_PROD ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

/* =========================
   SAFE FILE FUNCTIONS
========================= */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(file) {
  ensureDataDir();
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]", "utf8");

  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    const backup = `${file}.corrupt.${Date.now()}.bak`;
    try {
      fs.copyFileSync(file, backup);
    } catch (_) {}
    fs.writeFileSync(file, "[]", "utf8");
    return [];
  }
}

function write(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/* =========================
   AUTH MIDDLEWARE
========================= */
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/* =========================
   HELPERS
========================= */
function normalizeEmail(email) {
  const n = validator.normalizeEmail(String(email || "").trim());
  return n || "";
}

function isValidEmail(email) {
  return validator.isEmail(email);
}

function cleanText(str, max = 600) {
  const s = String(str || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function makeToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function looksLikeBookingIntent(message) {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("book") ||
    lower.includes("appointment") ||
    lower.includes("schedule") ||
    lower.includes("reserve") ||
    lower.includes("set an appointment")
  );
}

/* =========================
   CLINIC AI BRAIN PROMPT
========================= */
function clinicBrain(message) {
  const clinic = process.env.CLINIC_NAME || "our clinic";
  return `
You are the official AI assistant of ${clinic}.
You act like a professional clinic receptionist.

Responsibilities:
- Help patients
- Book appointments
- Answer clinic questions
- Provide support
- Convert visitors into patients

Services:
• Dental Cleaning
• AI Consultation
• Premium Clinic Services

Rules:
- Be professional, friendly, helpful
- If user wants to book: ask for name, service, preferred date/time, and email (if not provided)
- Never claim the appointment is confirmed unless confirmation link is completed or staff confirmed it
- Keep replies concise

User message:
${message}
`.trim();
}

/* =========================
   PAGES (PROTECTED)
   IMPORTANT: define BEFORE static()
========================= */

// Home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Protect dashboard page
app.get("/dashboard.html", (req, res) => {
  if (!req.session.user) return res.redirect("/login.html");
  return res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// Optional: protect any other admin pages
// app.get("/admin.html", (req,res)=>{ ... })

/* =========================
   STATIC FILES (PUBLIC)
========================= */
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   REGISTER ADMIN
========================= */
app.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.json({ success: false, message: "Email and password required" });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "Invalid email" });
    }

    if (password.length < 6) {
      return res.json({ success: false, message: "Password must be at least 6 characters" });
    }

    const users = read(USERS_FILE);
    const exists = users.find((u) => u.email === email);
    if (exists) return res.json({ success: false, message: "User exists" });

    const hashed = await bcrypt.hash(password, 10);

    users.push({
      id: uuidv4(),
      email,
      password: hashed,
      role: "admin",
      created: new Date().toISOString(),
    });

    write(USERS_FILE, users);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   LOGIN (SESSION)
========================= */
app.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    const users = read(USERS_FILE);
    const user = users.find((u) => u.email === email);
    if (!user) return res.json({ success: false });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false });

    req.session.user = { id: user.id, email: user.email, role: user.role };
    res.json({ success: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});

/* =========================
   ADMIN LOGIN ALIAS (MATCHES YOUR login.html)
   Your login.html calls /admin/login
========================= */
app.post("/admin/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    const users = read(USERS_FILE);
    const user = users.find((u) => u.email === email);
    if (!user) return res.json({ success: false });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false });

    req.session.user = { id: user.id, email: user.email, role: user.role };

    // Your login.html expects data.token; we can return any string (session cookie is the real auth)
    res.json({ success: true, token: "session" });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});

/* =========================
   LOGOUT
========================= */
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* =========================
   CURRENT USER
========================= */
app.get("/me", (req, res) => {
  if (req.session.user) return res.json(req.session.user);
  res.status(401).json({ error: "Not logged in" });
});

/* =========================
   APPOINTMENT CONFIRM (EMAIL LINK)
========================= */
app.get("/api/appointments/confirm", (req, res) => {
  const appointmentId = String(req.query.appointmentId || "");
  const token = String(req.query.token || "");

  if (!appointmentId || !token) {
    return res.status(400).json({ success: false, message: "Missing appointmentId or token" });
  }

  const appointments = read(APPOINTMENTS_FILE);
  const idx = appointments.findIndex((a) => a.id === appointmentId);

  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  const appt = appointments[idx];
  if (appt.confirmToken !== token) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }

  appt.status = "confirmed";
  appt.confirmedAt = new Date().toISOString();
  appt.confirmToken = null;

  appointments[idx] = appt;
  write(APPOINTMENTS_FILE, appointments);

  return res.json({ success: true, message: "Appointment confirmed!", appointmentId });
});

/* =========================
   MAIN AI CHAT ENDPOINT
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = cleanText(req.body?.message, 1200);
    const emailRaw = req.body?.email;
    const email = normalizeEmail(emailRaw);

    if (!message) return res.json({ reply: "Please type a message", success: false });

    // Save lead
    const leads = read(LEADS_FILE);
    leads.push({
      id: uuidv4(),
      message,
      email: isValidEmail(email) ? email : "",
      time: new Date().toISOString(),
    });
    write(LEADS_FILE, leads);

    // AI reply
    let reply = "AI not configured. Please set OPENAI_API_KEY.";
    if (openai) {
      const ai = await openai.responses.create({
        model: "gpt-4o-mini",
        input: clinicBrain(message),
        temperature: 0.7,
      });
      reply = ai.output_text || "Sorry, I couldn't generate a reply.";
    }

    // Booking intent -> pending + confirmation email link
    if (looksLikeBookingIntent(message)) {
      const appointments = read(APPOINTMENTS_FILE);

      const appointmentId = uuidv4();
      const confirmToken = makeToken(24);

      const appointment = {
        id: appointmentId,
        email: isValidEmail(email) ? email : "",
        message,
        status: "pending",
        confirmToken,
        created: new Date().toISOString(),
      };

      appointments.push(appointment);
      write(APPOINTMENTS_FILE, appointments);

      if (isValidEmail(email) && transporter) {
        const clinic = process.env.CLINIC_NAME || "SnowSkye Clinic";
        const confirmUrl = `${BASE_URL}/api/appointments/confirm?appointmentId=${encodeURIComponent(
          appointmentId
        )}&token=${encodeURIComponent(confirmToken)}`;

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: `Confirm your appointment - ${clinic}`,
          html: `
            <h2>Confirm your appointment</h2>
            <p>Please confirm by clicking below:</p>
            <p><a href="${confirmUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px">Confirm Appointment</a></p>
            <p><strong>Your request:</strong></p>
            <p>${message.replace(/</g, "&lt;")}</p>
          `,
        });
      }

      reply += isValidEmail(email)
        ? "\n\nI sent a confirmation link to your email. Please click it to confirm your appointment."
        : "\n\nTo confirm an appointment, please provide a valid email so I can send the confirmation link.";
    }

    res.json({ reply, success: true });
  } catch (error) {
    console.error(error);
    res.json({ reply: "Clinic assistant temporarily unavailable", success: false });
  }
});

/* =========================
   GET LEADS (ADMIN)
========================= */
app.get("/api/leads", requireAuth, (req, res) => {
  const leads = read(LEADS_FILE);
  res.json(leads.reverse());
});

/* =========================
   GET APPOINTMENTS (ADMIN)
========================= */
app.get("/api/appointments", requireAuth, (req, res) => {
  const apps = read(APPOINTMENTS_FILE);
  res.json(apps.reverse());
});
// PUBLIC SAFE: recent activity (no emails, limited results)
app.get("/api/public/recent", (req, res) => {
  const leads = read(LEADS_FILE).slice(-10).reverse();
  const apps = read(APPOINTMENTS_FILE).slice(-10).reverse();

  const safeLeads = leads.map((l) => ({
    id: l.id,
    message: String(l.message || "").slice(0, 120),
    time: l.time,
  }));

  const safeApps = apps.map((a) => ({
    id: a.id,
    message: String(a.message || "").slice(0, 120),
    created: a.created,
    status: a.status || "pending",
  }));

  res.json({ leads: safeLeads, appointments: safeApps });
});

/* =========================
   SERVER START
========================= */
app.listen(PORT, () => {
  console.log(`SnowSkye Clinic AI running on ${BASE_URL} (env: ${NODE_ENV})`);
});