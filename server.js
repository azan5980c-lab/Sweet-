// server.js
// Express backend for Telegram Web App verification + submission

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_CHAT_ID = process.env.BOT_CHAT_ID || "";
const SHOW_DEBUG_CODE = (process.env.SHOW_DEBUG_CODE || "false").toLowerCase() === "true";

const TELEGRAM_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

// In-memory stores (for production use persistent storage)
const verificationStore = new Map(); // key: phone -> { code, username, expiresAt, verified, tries, used }
const submittedPhones = new Set();

// Utilities
function sanitizeUsername(name) {
  if (typeof name !== "string") return "";
  return name.trim();
}

function validatePhone(phone) {
  if (typeof phone !== "string") return false;
  const cleaned = phone.replace(/[\s\-().]/g, "");
  // Allow leading +, digits only afterward
  const digits = cleaned.replace(/^\+/, "");
  return /^\+?\d{7,15}$/.test(phone) || /^\d{7,15}$/.test(digits);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_API_BASE || !BOT_CHAT_ID) return { ok: false, error: "bot not configured" };
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: BOT_CHAT_ID, text, disable_web_page_preview: true })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Telegram send error:", err);
    return { ok: false, error: String(err) };
  }
}

// API: health
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// API: request a verification code
app.post("/api/request-code", async (req, res) => {
  try {
    const { username, phone } = req.body || {};
    const cleanName = sanitizeUsername(username);

    if (!cleanName) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!phone || !validatePhone(phone)) {
      return res.status(400).json({ error: "Phone number is required and must be valid" });
    }

    const code = generateCode();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    verificationStore.set(phone, {
      code,
      username: cleanName,
      expiresAt,
      verified: false,
      tries: 0,
      used: false
    });

    // Send code to your configured Telegram chat so owner can read it (if BOT configured)
    if (BOT_TOKEN && BOT_CHAT_ID) {
      await sendTelegramMessage(`Verification code for ${phone} (user: ${cleanName}): ${code}`);
    }

    // For local testing: optionally return the code in the response when SHOW_DEBUG_CODE=true
    if (SHOW_DEBUG_CODE) {
      return res.json({ ok: true, debugCode: code, message: "Code generated (debug mode)." });
    }

    return res.json({ ok: true, message: "Verification code issued. Check your SMS/Telegram (owner) for the code." });
  } catch (err) {
    console.error("request-code error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// API: verify a code
app.post("/api/verify-code", (req, res) => {
  try {
    const { username, phone, verificationCode } = req.body || {};
    const cleanName = sanitizeUsername(username);

    if (!cleanName) return res.status(400).json({ error: "Username is required" });
    if (!phone || !validatePhone(phone)) return res.status(400).json({ error: "Phone number is required and must be valid" });
    if (!verificationCode || typeof verificationCode !== "string") return res.status(400).json({ error: "Verification code is required" });

    const record = verificationStore.get(phone);
    if (!record) return res.status(400).json({ error: "No verification request found for this phone" });

    if (record.username !== cleanName) {
      return res.status(400).json({ error: "Username and phone do not match the verification request" });
    }

    if (Date.now() > record.expiresAt) {
      verificationStore.delete(phone);
      return res.status(400).json({ error: "Verification code expired" });
    }

    if (record.used) {
      return res.status(409).json({ error: "Code already used" });
    }

    record.tries = (record.tries || 0) + 1;
    if (record.tries > 10) {
      verificationStore.delete(phone);
      return res.status(429).json({ error: "Too many attempts" });
    }

    if (verificationCode.trim() !== record.code) {
      return res.status(400).json({ error: "Incorrect verification code" });
    }

    // Mark verified (but not yet submitted)
    record.verified = true;
    verificationStore.set(phone, record);

    return res.json({ ok: true, message: "Code verified" });
  } catch (err) {
    console.error("verify-code error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// API: submit final application
app.post("/api/submit", async (req, res) => {
  try {
    const { username, phone, verificationCode } = req.body || {};
    const cleanName = sanitizeUsername(username);

    if (!cleanName) return res.status(400).json({ error: "Username is required" });
    if (!phone || !validatePhone(phone)) return res.status(400).json({ error: "Phone number is required and must be valid" });
    if (!verificationCode || typeof verificationCode !== "string") return res.status(400).json({ error: "Verification code is required" });

    if (submittedPhones.has(phone)) {
      return res.status(409).json({ error: "This phone has already submitted an application" });
    }

    const record = verificationStore.get(phone);
    if (!record || record.username !== cleanName) {
      return res.status(400).json({ error: "No valid verification record for this submission" });
    }
    if (!record.verified) {
      return res.status(400).json({ error: "Verification not completed" });
    }
    if (Date.now() > record.expiresAt) {
      verificationStore.delete(phone);
      return res.status(400).json({ error: "Verification code expired" });
    }
    if (record.code !== verificationCode.trim()) {
      return res.status(400).json({ error: "Verification code mismatch" });
    }

    // Mark used and submitted
    record.used = true;
    verificationStore.set(phone, record);
    submittedPhones.add(phone);

    // Send notification to Telegram bot
    const submissionText = `✅ New approved submission\nUsername: ${cleanName}\nPhone: ${phone}\nTime: ${new Date().toISOString()}`;
    const tgResult = await sendTelegramMessage(submissionText);

    if (tgResult && tgResult.ok === false) {
      console.error("Failed to notify via Telegram:", tgResult);
      // Still return success to client but warn in server logs.
    }

    return res.json({ ok: true, message: "Application submitted and approved" });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Fallback to serve index.html for SPA navigation
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  res.sendFile(indexPath);
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT} (PORT=${PORT})`);
});
