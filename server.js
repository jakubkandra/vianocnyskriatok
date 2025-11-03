// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== Databáza (SQLite) =====
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

// ===== Pomocné funkcie =====
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Garantovaný derangement — žiadne samopriradenia
function guaranteedDerangement(arr) {
  const n = arr.length;
  if (n < 2) throw new Error("Potrební aspoň 2 účastníci");
  const indices = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * i);
    if (indices[j] === i) j = i - 1;
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if (indices[0] === 0) [indices[0], indices[1]] = [indices[1], indices[0]];
  return indices.map(i => arr[i]);
}

// ===== ROUTES =====

// Hlavná stránka
app.get("/", (req, res) => {
  res.send(`
    <h2>🎲 Vytvoriť nové losovanie</h2>
    <form method="POST" action="/create" style="max-width:700px">
      <label>Zoznam účastníkov (jedna položka na riadok: meno alebo meno,email):</label><br/>
      <textarea name="list" rows="10" style="width:100%" placeholder="Janko\nMarta\nPalo,pa@example.com"></textarea><br/>
      <button type="submit">Vytvoriť losovanie</button>
    </form>
    <p>Po vytvorení dostaneš admin odkaz a odkazy pre účastníkov.</p>
  `);
});

// Vytvorenie losovania
app.post("/create", (req, res) => {
  const raw = req.body.list || "";
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return res.send("Potrebné minimálne 2 položky.");

  const participants = lines.map(line => {
    const parts = line.split(",").map(p => p.trim());
    return { name: parts[0], email: parts[1] || "", id: uuidv4() };
  });

  const targets = guaranteedDerangement(participants.map(p => p.id));
  const adminToken = uuidv4();
  const drawId = uuidv4();
  const createdAt = new Date().toISOString();

  db.run("INSERT INTO draws (id, createdAt, adminToken) VALUES (?, ?, ?)", [drawId, createdAt, adminToken]);

  participants.forEach((p, idx) => {
    const token = uuidv4();
    const assignedId = targets[idx];
    db.run(
      "INSERT INTO participants (id, drawId, name, email, assignedId, token) VALUES (?, ?, ?, ?, ?, ?)",
      [p.id, drawId, p.name, p.email, assignedId, token]
    );
  });

  const base = `${req.protocol}://${req.get("host")}`;
  db.all("SELECT * FROM participants WHERE drawId = ?", [drawId], (err, rows) => {
    if (err) return res.send("Chyba DB.");
    let csv = "name,email,link\n";
    rows.forEach(r => {
      csv += `"${r.name}","${r.email}","${base}/p/${r.token}"\n`;
    });
    res.send(`
      <h3>✅ Losovanie vytvorené</h3>
      <p>Admin odkaz (uchovaj si ho): <a href="/admin/${adminToken}">${base}/admin/${adminToken}</a></p>
      <p>CSV s odkazmi pre účastníkov:</p>
      <pre style="background:#f0f0f0;padding:10px;">${csv}</pre>
    `);
  });
});

// Stránka účastníka
app.get("/p/:token", (req, res) => {
  const token = req.params.token;
  db.get("SELECT * FROM participants WHERE token = ?", [token], (err, user) => {
    if (!user) return res.status(404).send("Token nenájdený.");
    db.get("SELECT name FROM participants WHERE id = ?", [user.assignedId], (err, target) => {
      res.send(`
        <h3>Tvoje priradenie</h3>
        <p><strong>${user.name}</strong> → <strong>${target ? target.name : "–"}</strong></p>
        <p>(Tento výsledok vidíš len ty – každý účastník má svoj unikátny odkaz.)</p>
      `);
    });
  });
});

// Admin zobrazenie
app.get("/admin/:token", (req, res) => {
  const token = req.params.token;
  db.get("SELECT * FROM draws WHERE adminToken = ?", [token], (err, draw) => {
    if (!draw) return res.status(404).send("Neplatný admin token.");
    db.all("SELECT * FROM participants WHERE drawId = ?", [draw.id], (err, participants) => {
      let html = `<h2>🧑‍💼 Admin: kompletné priradenie</h2>`;
      html += `<p>Vytvorené: ${draw.createdAt}</p>`;
      html += `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>#</th><th>Účastník</th><th>Email</th><th>Priradený</th></tr>`;
      participants.forEach((p, idx) => {
        const assigned = participants.find(x => x.id === p.assignedId);
        html += `<tr><td>${idx + 1}</td><td>${p.name}</td><td>${p.email}</td><td>${assigned ? assigned.name : "–"}</td></tr>`;
      });
      html += `</table>`;
      res.send(html);
    });
  });
});

app.listen(PORT, () => console.log(`Server beží na http://localhost:${PORT}`));
