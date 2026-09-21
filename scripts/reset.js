import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.resolve(process.env.DB_PATH || "./data/school-vote.db");
const db = new Database(DB_PATH);

const before = db.prepare("SELECT COUNT(*) AS count FROM vote_orders").get().count;
db.prepare("DELETE FROM vote_orders").run();
db.prepare("DELETE FROM sqlite_sequence WHERE name = 'vote_orders'").run();

console.log(`Reset complete: removed ${before} vote order(s). Candidates, configuration, and settings are untouched.`);