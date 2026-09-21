import path from "node:path";
import { createClient } from "@libsql/client";

const TURSO_URL = process.env.TURSO_URL || "";
const DB_PATH = path.resolve(process.env.DB_PATH || "./data/school-vote.db");
const db = createClient(
  TURSO_URL
    ? { url: TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || "" }
    : { url: `file:${DB_PATH}` }
);

const { rows } = await db.execute({ sql: "SELECT COUNT(*) AS count FROM vote_orders", args: [], column: "value" });
await db.execute("DELETE FROM vote_orders");
await db.execute("DELETE FROM sqlite_sequence WHERE name = 'vote_orders'");

console.log(`Reset complete: removed ${rows[0].count} vote order(s). Candidates, configuration, and settings are untouched.`);