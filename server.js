import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import express from "express";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.join(ROOT, "photos");
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const PAYMENT_MODE = process.env.PAYMENT_MODE || (NODE_ENV === "production" ? "paystack" : "demo");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || "KES";
const PAYSTACK_CHANNELS = (process.env.PAYSTACK_CHANNELS || "card,mobile_money,bank_transfer")
  .split(",")
  .map((channel) => channel.trim())
  .filter(Boolean);
const VOTE_PRICE_KSH = 10;
const MAX_VOTES_PER_ORDER = positiveInteger(process.env.MAX_VOTES_PER_ORDER, 1000);
const TURSO_URL = process.env.TURSO_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(ROOT, "data", "school-vote.db"));

mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = createClient(
  TURSO_URL
    ? { url: TURSO_URL, authToken: TURSO_AUTH_TOKEN }
    : { url: `file:${DB_PATH}` }
);

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    image_path TEXT NOT NULL,
    position INTEGER NOT NULL UNIQUE
  );`,
  `CREATE TABLE IF NOT EXISTS vote_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    amount_ksh INTEGER NOT NULL CHECK (amount_ksh > 0),
    amount_subunit INTEGER NOT NULL CHECK (amount_subunit > 0),
    email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'failed', 'review')),
    provider TEXT NOT NULL,
    provider_transaction_id TEXT,
    provider_response TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );`,
  "CREATE INDEX IF NOT EXISTS vote_orders_status_idx ON vote_orders(status);",
  "CREATE INDEX IF NOT EXISTS vote_orders_candidate_idx ON vote_orders(candidate_id);"
];

const candidateSeed = [
  { id: 1, name: "Mr Ismael Omwando", role: "School Administrator Candidate", image: "photos/Mr Ismael Omwando.jpeg", position: 1 },
  { id: 2, name: "Ogendo Felix", role: "School Administrator Candidate", image: "photos/Ogendo Felix.jpeg", position: 2 },
  { id: 3, name: "Onesmus Anyimu", role: "School Administrator Candidate", image: "photos/Onesmus Anyimu.jpeg", position: 3 },
  { id: 4, name: "Njeri Nyambura", role: "School Administrator Candidate", image: "photos/Candidate 04 - stock photo.jpeg", position: 4 },
  { id: 5, name: "Madam Ruth Kipng'eno", role: "School Administrator Candidate", image: "photos/Candidate 05 - stock photo.jpeg", position: 5 }
];

async function initDatabase() {
  if (!TURSO_URL) {
    try {
      await db.execute("PRAGMA foreign_keys = ON");
      await db.execute("PRAGMA journal_mode = WAL");
    } catch (error) {
      console.warn("Could not apply local DB settings:", error.message);
    }
  }
  await db.batch(schemaStatements);
  const { rows } = await db.execute({ sql: "SELECT COUNT(*) AS count FROM candidates", args: [], column: "value" });
  if (rows[0].count === 0) {
    await db.batch(candidateSeed.map((candidate) => ({
      sql: "INSERT INTO candidates (id, name, role, image_path, position) VALUES (?, ?, ?, ?, ?)",
      args: [candidate.id, candidate.name, candidate.role, candidate.image, candidate.position]
    })));
  }
  console.log(TURSO_URL ? "Database: Turso connected" : `Database: local file at ${DB_PATH}`);
}
await initDatabase();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const FAILED_PAYSTACK_EVENTS = new Set(["charge.failed", "charge.abandoned", "charge.reversed"]);

// Paystack signs the original request body, so this route must receive raw bytes.
app.post("/api/payments/paystack/webhook", express.raw({ type: "application/json", limit: "100kb" }), (req, res) => {
  if (PAYMENT_MODE !== "paystack" || !PAYSTACK_SECRET_KEY) {
    return res.status(200).json({ received: true });
  }

  const signature = req.get("x-paystack-signature") || "";
  const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(req.body).digest("hex");
  if (!safeEqual(signature, expected)) {
    return res.status(401).json({ error: "Invalid webhook signature." });
  }

  try {
    const event = JSON.parse(req.body.toString("utf8"));
    if (event.data?.reference) {
      void processPaystackEvent(event).catch((error) => console.error("Paystack event processing error:", error.message));
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Paystack webhook parse error:", error.message);
    return res.status(400).json({ error: "Could not parse webhook." });
  }
});

app.use(express.json({ limit: "30kb" }));

const voteAttempts = new Map();
const voteLimiter = (req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = voteAttempts.get(key);
  const windowMs = 15 * 60 * 1000;
  if (!current || current.resetAt < now) {
    voteAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > 20) {
    return res.status(429).json({ error: "Too many payment attempts. Please wait a few minutes and try again." });
  }
  return next();
};
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of voteAttempts) if (value.resetAt < now) voteAttempts.delete(key);
}, 10 * 60 * 1000).unref();

app.get("/api/election", async (req, res) => {
  const voter = await isVoter(req);
  const candidates = await getCandidates();
  res.json({
    hasVoted: voter,
    votePriceKsh: VOTE_PRICE_KSH,
    maxVotesPerOrder: MAX_VOTES_PER_ORDER,
    totalVotes: voter ? await getTotalPaidVotes() : null,
    candidates: candidates.map((candidate) => voter ? candidate : { ...candidate, votes: null })
  });
});

app.get("/api/results", async (req, res) => {
  if (!(await isVoter(req))) throw new HttpError(403, "Vote to unlock live results.");
  const results = await getRankedCandidates();
  const totalVotes = await getTotalPaidVotes();
  const percentages = percentageShares(results.map((candidate) => candidate.votes), totalVotes);
  res.json({
    totalVotes,
    results: results.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      percentage: percentages[index]
    }))
  });
});

app.post("/api/orders", voteLimiter, async (req, res) => {
  try {
    const candidateId = Number(req.body?.candidateId);
    const quantity = Number(req.body?.quantity);
    const email = String(req.body?.email || "").trim().toLowerCase();
    const candidate = await qGet("SELECT id, name, role, image_path AS image FROM candidates WHERE id = ?", [candidateId]);

    if (!candidate) throw new HttpError(404, "That candidate is no longer available.");
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_VOTES_PER_ORDER) {
      throw new HttpError(400, `Choose between 1 and ${MAX_VOTES_PER_ORDER.toLocaleString()} votes.`);
    }
    if (!isEmail(email)) throw new HttpError(400, "Enter a valid email address for your Paystack payment.");

    const amountKsh = quantity * VOTE_PRICE_KSH;
    const amountSubunit = amountKsh * 100;
    const reference = createReference();
    const createdAt = new Date().toISOString();
    await qRun(
      `INSERT INTO vote_orders
        (reference, candidate_id, quantity, amount_ksh, amount_subunit, email, status, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [reference, candidateId, quantity, amountKsh, amountSubunit, email, PAYMENT_MODE, createdAt]
    );

    if (PAYMENT_MODE === "demo") {
      await qRun(
        `UPDATE vote_orders SET status = 'paid', provider_transaction_id = ?, paid_at = ? WHERE reference = ?`,
        [`demo_${reference}`, new Date().toISOString(), reference]
      );
      grantVoterAccess(res, reference);
      return res.status(201).json({ order: await getOrder(reference), checkoutUrl: null, mode: "demo" });
    }

    if (PAYMENT_MODE !== "paystack") throw new HttpError(500, "Invalid payment mode configuration.");
    assertPaystackConfigured();
    const checkoutUrl = await initializePaystackTransaction({ reference, candidate, quantity, amountKsh, amountSubunit, email });
    await qRun("UPDATE vote_orders SET status = 'awaiting_payment' WHERE reference = ?", [reference]);
    return res.status(201).json({ order: await getOrder(reference), checkoutUrl, mode: "paystack" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error("Could not create vote order:", error.message);
    return res.status(502).json({ error: "We could not start the payment. Please try again." });
  }
});

app.all("/api/orders/:reference/verify", async (req, res) => {
  const reference = String(req.params.reference || "");
  try {
    if (!(await getOrder(reference))) throw new HttpError(404, "Payment reference not found.");
    if (PAYMENT_MODE === "paystack") await verifyPaystackPayment(reference);
    const order = await getOrder(reference);
    if (order?.status === "paid") grantVoterAccess(res, reference);
    return res.json({ order });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error("Could not verify payment:", error.message);
    return res.status(502).json({ error: "We could not verify this payment yet. Please refresh shortly." });
  }
});

app.get("/api/payments/paystack/callback", async (req, res) => {
  const reference = String(req.query.reference || "");
  if (reference && PAYMENT_MODE === "paystack") {
    try {
      await verifyPaystackPayment(reference);
      const order = await getOrder(reference);
      if (order?.status === "paid") grantVoterAccess(res, reference);
    } catch (error) {
      console.error("Paystack callback verification error:", error.message);
    }
  }
  const suffix = reference ? `?payment=${encodeURIComponent(reference)}` : "";
  res.redirect(303, `/${suffix}`);
});

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/results", (req, res) => res.sendFile(path.join(ROOT, "results.html")));
app.get("/results.html", (req, res) => res.sendFile(path.join(ROOT, "results.html")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(ROOT, "styles.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(ROOT, "script.js")));
app.get("/leadership.svg", (req, res) => res.sendFile(path.join(ROOT, "leadership.svg")));
app.get("/photos/:filename", (req, res) => {
  const filename = req.params.filename;
  const extension = path.extname(filename).toLowerCase();
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  if (path.basename(filename) !== filename || !allowedExtensions.has(extension)) return res.sendStatus(404);
  return res.sendFile(path.join(PHOTOS_DIR, filename), (error) => {
    if (error && !res.headersSent) res.sendStatus(error.statusCode || 404);
  });
});

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
app.use((req, res) => res.status(404).send("Page not found."));
app.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error("Unhandled server error:", error);
  return res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`SchoolVote running at ${PUBLIC_BASE_URL}`);
  console.log(`Payment mode: ${PAYMENT_MODE}`);
});

async function qGet(sql, args = []) {
  const result = await db.execute({ sql, args, column: "value" });
  return result.rows[0];
}

async function qAll(sql, args = []) {
  const result = await db.execute({ sql, args, column: "value" });
  return result.rows;
}

async function qRun(sql, args = []) {
  await db.execute({ sql, args });
}

async function getCandidates() {
  return qAll(`
    SELECT c.id, c.name, c.role, c.image_path AS image, c.position,
      COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.quantity ELSE 0 END), 0) AS votes
    FROM candidates c
    LEFT JOIN vote_orders o ON o.candidate_id = c.id
    GROUP BY c.id
    ORDER BY c.position ASC
  `);
}

async function getRankedCandidates() {
  return qAll(`
    SELECT c.id, c.name, c.role, c.image_path AS image, c.position,
      COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.quantity ELSE 0 END), 0) AS votes
    FROM candidates c
    LEFT JOIN vote_orders o ON o.candidate_id = c.id
    GROUP BY c.id
    ORDER BY votes DESC, c.position ASC
  `);
}

async function getTotalPaidVotes() {
  const row = await qGet("SELECT COALESCE(SUM(quantity), 0) AS total FROM vote_orders WHERE status = 'paid'");
  return row.total;
}

const VOTER_COOKIE = "voter_ref";
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 31;

async function isVoter(req) {
  const reference = parseCookies(req.headers.cookie || "")[VOTER_COOKIE];
  if (!reference) return false;
  return !!(await qGet("SELECT 1 FROM vote_orders WHERE reference = ? AND status = 'paid'", [reference]));
}

function grantVoterAccess(res, reference) {
  const secure = NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${VOTER_COOKIE}=${encodeURIComponent(reference)}; Path=/; Max-Age=${VOTER_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function percentageShares(votes, total) {
  if (!total || votes.length === 0) return votes.map(() => 0);
  const raw = votes.map((vote) => (vote / total) * 100);
  const shares = raw.map((value) => Math.floor(value));
  let remainder = 100 - shares.reduce((sum, value) => sum + value, 0);
  const fractional = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i++) shares[fractional[i].index] += 1;
  return shares;
}

async function getOrder(reference) {
  return qGet(`
    SELECT o.reference, o.quantity, o.amount_ksh AS amountKsh, o.status, o.provider, o.created_at AS createdAt,
      o.paid_at AS paidAt, c.id AS candidateId, c.name AS candidateName, c.role AS candidateRole, c.image_path AS candidateImage
    FROM vote_orders o
    JOIN candidates c ON c.id = o.candidate_id
    WHERE o.reference = ?
  `, [reference]);
}

async function initializePaystackTransaction({ reference, candidate, quantity, amountKsh, amountSubunit, email }) {
  const callbackUrl = new URL("/api/payments/paystack/callback", PUBLIC_BASE_URL).toString();
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      amount: amountSubunit,
      currency: PAYSTACK_CURRENCY,
      reference,
      callback_url: callbackUrl,
      channels: PAYSTACK_CHANNELS,
      metadata: {
        vote_order_reference: reference,
        candidate_id: candidate.id,
        candidate_name: candidate.name,
        vote_quantity: quantity,
        amount_ksh: amountKsh,
        custom_fields: [
          { display_name: "Candidate", variable_name: "candidate", value: candidate.name },
          { display_name: "Votes", variable_name: "votes", value: String(quantity) }
        ]
      }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status || !payload.data?.authorization_url) {
    throw new Error(payload?.message || "Paystack did not return a checkout link.");
  }
  return payload.data.authorization_url;
}

const verifyInFlight = new Map();

function verifyPaystackPayment(reference) {
  const existing = verifyInFlight.get(reference);
  if (existing) return existing;
  const pending = verifyPaystackPaymentUncached(reference).finally(() => verifyInFlight.delete(reference));
  verifyInFlight.set(reference, pending);
  return pending;
}

async function verifyPaystackPaymentUncached(reference) {
  const order = await qGet("SELECT * FROM vote_orders WHERE reference = ?", [reference]);
  if (!order || order.status === "paid") return order;
  assertPaystackConfigured();

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status || !payload.data) throw new Error(payload?.message || "Paystack verification failed.");

  const transaction = payload.data;
  const verified = transaction.status === "success"
    && transaction.reference === order.reference
    && Number(transaction.amount) === order.amount_subunit
    && transaction.currency === PAYSTACK_CURRENCY;
  const serialized = JSON.stringify({ status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency });

  if (verified) {
    await qRun(
      `UPDATE vote_orders
        SET status = 'paid', provider_transaction_id = ?, provider_response = ?, paid_at = ?
        WHERE reference = ? AND status != 'paid'`,
      [String(transaction.id || ""), serialized, transaction.paid_at || new Date().toISOString(), reference]
    );
  } else if (["failed", "abandoned", "reversed"].includes(transaction.status)) {
    await markOrderFailed(reference, serialized);
  } else if (transaction.status === "success") {
    await qRun(
      "UPDATE vote_orders SET status = 'review', provider_response = ? WHERE reference = ? AND status != 'paid'",
      [serialized, reference]
    );
  }
  return getOrder(reference);
}

async function processPaystackEvent(event) {
  const reference = event.data?.reference;
  if (!reference) return;
  if (event.event === "charge.success") {
    await verifyPaystackPayment(reference);
  } else if (FAILED_PAYSTACK_EVENTS.has(event.event)) {
    await markOrderFailed(reference, JSON.stringify(event));
  }
}

async function markOrderFailed(reference, providerResponse) {
  await qRun(
    "UPDATE vote_orders SET status = 'failed', provider_response = ? WHERE reference = ? AND status != 'paid'",
    [providerResponse, reference]
  );
}

function assertPaystackConfigured() {
  if (!PAYSTACK_SECRET_KEY) throw new HttpError(503, "Payments are not configured yet. Please try again later.");
  if (!PUBLIC_BASE_URL.startsWith("https://") && NODE_ENV === "production") {
    throw new HttpError(503, "The payment callback URL must use HTTPS in production.");
  }
}

function createReference() {
  return `vote-${Date.now().toString(36)}-${crypto.randomBytes(9).toString("hex")}`;
}

function safeEqual(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
