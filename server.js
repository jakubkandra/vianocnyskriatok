// ===============================
// Secret Draw Server (with SQLite + Email sending)
// ===============================

const express = require("express");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");

// ========= CONFIG =========
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


// ========= DATABASE (SQLite) =========
const DB_FILE = path.join(__dirname, "draws.db");
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS draws (
      id TEXT PRIMARY KEY,
      createdAt TEXT,
      adminToken TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      drawId TEXT,
      name TEXT,
      email TEXT,
      assignedId TEXT,
      token TEXT,
      FOREIGN KEY(drawId) REFERENCES draws(id)
    )
  `);
});


// ========= EMAIL TRANSPORT =========
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});


// ========= HELPER FUNCTIONS =========

// Fisher–Yates shuffle
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Garantovaný derangement (žiadne samopriradenie)
function guaranteedDerangement(arr) {
  const n = arr.length;
  if (n < 2) throw new Error("Potrební aspoň 2 účastníci");

  const indices = [...Array(n).keys()];
  shuffle(indices);

  for (let i = 0; i < n; i++) {
    if (indices[i] === i) {
      // swap s predchádzajúcim
      const j = (i === 0) ? 1 : i - 1;
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
  }

  return indices.map(i => arr[i]);
}


// ========= ROUTES =========

// Form na vytvorenie losovania
app.get("/", (req, res) => {
  res.send(`
    <h2>🎲 Vytvoriť nové losovanie</h2>
    <form method="POST" action="/create" style="max-width:700px">
      <label>Zoznam účastníkov (jedna položka na riadok: meno alebo meno,email):</label><br/>
      <textarea name="list" rows="10" style="width:100%" placeholder="Janko\nMarta\nPalo,pa@example.com"></textarea><br/>
      <button type="submit">Vytvoriť losovanie</button>
    </form>
    <p>Po vytvorení účastníci dostanú výsledok emailom.</p>
  `);
});


// Vytvorenie losovania
app.post("/create", (req, res) => {
  const raw = req.body.list || "";
  const lines = raw.split(/\r?\n/).map(s => s.trim
