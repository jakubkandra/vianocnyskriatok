// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const STORAGE_FILE = path.join(__dirname, 'draws.json');
let storage = {};
if (fs.existsSync(STORAGE_FILE)) {
  try { storage = JSON.parse(fs.readFileSync(STORAGE_FILE)); } catch(e){ storage = {}; }
}
function saveStorage() {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
}

// Fisher–Yates shuffle
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 🧠 Garantovaný derangement algoritmus — nikdy nikto nedostane sám seba
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

// ========== ROUTES ==========

// Formulár na vytvorenie losovania
app.get('/', (req, res) => {
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

// Spracovanie vytvorenia
app.post('/create', (req, res) => {
  const raw = req.body.list || '';
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return res.send('Potrebné minimálne 2 položky.');

  const participants = lines.map(line => {
    const parts = line.split(',').map(p => p.trim());
    return { name: parts[0], email: parts[1] || '', id: uuidv4() };
  });

  // Použijeme garantovaný derangement (žiadne samopriradenia)
  const targets = guaranteedDerangement(participants.map(p => p.id));

  const adminToken = uuidv4();
  const mapping = {};
  const tokens = {};
  participants.forEach((p, idx) => {
    const assignedId = targets[idx];
    const token = uuidv4();
    tokens[token] = p.id;
    mapping[p.id] = { participant: p, assignedId };
  });

  const drawId = uuidv4();
  storage[drawId] = {
    createdAt: new Date().toISOString(),
    adminToken,
    participants,
    mapping,
    tokens
  };
  saveStorage();

  const base = `${req.protocol}://${req.get('host')}`;
  let csv = 'name,email,link\n';
  Object.entries(tokens).forEach(([token, pid]) => {
    const p = participants.find(x => x.id === pid);
    csv += `"${p.name}","${p.email}","${base}/p/${token}"\n`;
  });

  res.send(`
    <h3>✅ Losovanie vytvorené</h3>
    <p>Admin odkaz (uchovaj si ho): <a href="/admin/${adminToken}">${base}/admin/${adminToken}</a></p>
    <p>CSV s odkazmi pre účastníkov:</p>
    <pre style="background:#f0f0f0;padding:10px;">${csv}</pre>
  `);
});

// Účastník: zobrazí len svoje priradenie
app.get('/p/:token', (req, res) => {
  const token = req.params.token;
  for (const drawId of Object.keys(storage)) {
    const draw = storage[drawId];
    if (draw.tokens && draw.tokens[token]) {
      const pid = draw.tokens[token];
      const entry = draw.mapping[pid];
      const assigned = draw.participants.find(x => x.id === entry.assignedId);
      return res.send(`
        <h3>Tvoje priradenie</h3>
        <p><strong>${entry.participant.name}</strong> → <strong>${assigned ? assigned.name : '–'}</strong></p>
        <p>(Tento výsledok vidíš len ty – každý účastník má svoj unikátny odkaz.)</p>
      `);
    }
  }
  res.status(404).send('Token nenájdený.');
});

// Admin: plné zobrazenie
app.get('/admin/:admintoken', (req, res) => {
  const t = req.params.admintoken;
  for (const drawId of Object.keys(storage)) {
    const draw = storage[drawId];
    if (draw.adminToken === t) {
      const base = `${req.protocol}://${req.get('host')}`;
      let html = `<h2>🧑‍💼 Admin: kompletné priradenie</h2>`;
      html += `<p>Vytvorené: ${draw.createdAt}</p>`;
      html += `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>#</th><th>Účastník</th><th>Email</th><th>Priradený</th></tr>`;
      draw.participants.forEach((p, idx) => {
        const assigned = draw.participants.find(x => x.id === draw.mapping[p.id].assignedId);
        html += `<tr><td>${idx+1}</td><td>${p.name}</td><td>${p.email}</td><td>${assigned ? assigned.name : '–'}</td></tr>`;
      });
      html += `</table>`;
      html += `<p><a href="/admin/${t}/export/csv">Export CSV</a> | <a href="/admin/${t}/export/json">Export JSON</a></p>`;
      return res.send(html);
    }
  }
  res.status(403).send('Neplatný admin token.');
});

// Export CSV/JSON
app.get('/admin/:admintoken/export/:fmt', (req, res) => {
  const t = req.params.admintoken;
  const fmt = req.params.fmt === 'json' ? 'json' : 'csv';
  for (const drawId of Object.keys(storage)) {
    const draw = storage[drawId];
    if (draw.adminToken === t) {
      if (fmt === 'json') {
        res.setHeader('Content-disposition', 'attachment; filename=draw.json');
        res.setHeader('Content-type', 'application/json');
        return res.send(JSON.stringify(draw, null, 2));
      } else {
        let csv = 'participant,participant_email,assigned,assigned_email\n';
        draw.participants.forEach(p => {
          const a = draw.participants.find(x => x.id === draw.mapping[p.id].assignedId);
          csv += `"${p.name}","${p.email}","${a ? a.name : ''}","${a ? a.email : ''}"\n`;
        });
        res.setHeader('Content-disposition', 'attachment; filename=draw.csv');
        res.setHeader('Content-type', 'text/csv');
        return res.send(csv);
      }
    }
  }
  res.status(403).send('Neplatný admin token.');
});

app.listen(PORT, () => {
  console.log(`Server beží na http://localhost:${PORT}`);
});
