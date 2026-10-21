const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const API = "https://api.football-data.org/v4";

// Petit cache en mémoire : évite de dépasser la limite de requêtes
// de football-data.org (offre gratuite) quand on ouvre plusieurs matchs.
const cache = new Map();

async function footballData(path, ttlMs) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.time < ttlMs) return hit.result;

  const response = await fetch(API + path, {
    headers: { "X-Auth-Token": TOKEN },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  const result = { ok: response.ok, status: response.status, data };

  if (response.ok) {
    cache.set(path, { time: Date.now(), result });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return result;
}

// Dates par défaut : aujourd'hui jusqu'aux 7 prochains jours.
// Les paramètres dateFrom et dateTo fournis par le site restent prioritaires.
function defaultDateRange() {
  const today = new Date();
  const dateFrom = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 7);
  const dateTo = end.toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", (req, res) => {
  res.json({
    application: "MD ZE ZAYE API",
    status: "online",
    message: "Le serveur fonctionne."
  });
});

app.get("/matches", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        error: "Le jeton FOOTBALL_DATA_TOKEN n'est pas configuré."
      });
    }

    const defaults = defaultDateRange();
    const startDate = req.query.dateFrom || defaults.dateFrom;
    const endDate = req.query.dateTo || defaults.dateTo;

    const result = await footballData(
      "/matches?dateFrom=" + encodeURIComponent(startDate) +
      "&dateTo=" + encodeURIComponent(endDate),
      60 * 1000
    );

    if (!result.ok) {
      return res.status(result.status).json({
        error: "football-data.org a refusé la demande.",
        details: result.data
      });
    }

    const matches = result.data.matches || [];
    res.json({
      source: "football-data.org",
      count: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      error: "Impossible de récupérer les matchs.",
      details: error.message
    });
  }
});

app.get("/competitions/:code/matches", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        error: "Le jeton FOOTBALL_DATA_TOKEN n'est pas configuré."
      });
    }

    const code = encodeURIComponent(req.params.code);
    const defaults = defaultDateRange();
    const startDate = req.query.dateFrom || defaults.dateFrom;
    const endDate = req.query.dateTo || defaults.dateTo;

    const result = await footballData(
      "/competitions/" + code + "/matches" +
      "?dateFrom=" + encodeURIComponent(startDate) +
      "&dateTo=" + encodeURIComponent(endDate),
      60 * 1000
    );

    if (!result.ok) {
      return res.status(result.status).json({
        error: "Impossible de récupérer cette compétition.",
        details: result.data
      });
    }

    const matches = result.data.matches || [];
    res.json({
      source: "football-data.org",
      competition: result.data.competition || null,
      count: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      error: "Erreur pendant la récupération des matchs.",
      details: error.message
    });
  }
});

// NOUVEAU : derniers matchs terminés d'une équipe (utilisé par « Voir les statistiques »).
// Renvoie les N derniers matchs, du plus ancien au plus récent.
app.get("/teams/:id/matches", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        error: "Le jeton FOOTBALL_DATA_TOKEN n'est pas configuré."
      });
    }

    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Identifiant d'équipe invalide." });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);

    const result = await footballData(
      "/teams/" + req.params.id + "/matches?status=FINISHED",
      10 * 60 * 1000
    );

    if (!result.ok) {
      return res.status(result.status).json({
        error: "Impossible de récupérer les matchs de cette équipe.",
        details: result.data
      });
    }

    const matches = (result.data.matches || [])
      .filter(m => m.status === "FINISHED")
      .sort((a, b) => String(a.utcDate).localeCompare(String(b.utcDate)))
      .slice(-limit);

    res.json({
      source: "football-data.org",
      count: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      error: "Erreur pendant la récupération des matchs de l'équipe.",
      details: error.message
    });
  }
});

// ===================================================================
// NOUVEAU : statistiques détaillées par équipe (tirs, fautes, corners,
// cartons jaunes) depuis les fichiers CSV gratuits de football-data.co.uk.
// Les touches (throw-ins) ne sont fournies par aucune source gratuite.
// ===================================================================
const LEAGUE_CSV = { PL: "E0", PD: "SP1", SA: "I1", BL1: "D1", FL1: "F1", PPL: "P1", DED: "N1" };
const CSV_HOSTS = ["https://www.football-data.co.uk", "http://www.football-data.co.uk"];
const STATS_TTL = 6 * 60 * 60 * 1000;
const statsCache = new Map();

function seasonCode(date = new Date()) {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return String(start).slice(2) + String(start + 1).slice(2);
}

function previousSeason(code) {
  const a = (parseInt(code.slice(0, 2), 10) + 99) % 100;
  const b = (parseInt(code.slice(2), 10) + 99) % 100;
  return String(a).padStart(2, "0") + String(b).padStart(2, "0");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else { field += c; }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

function emptyTotals() {
  return {
    n: 0,
    goalsFor: 0, goalsAgainst: 0,
    shotsFor: 0, shotsAgainst: 0,
    foulsFor: 0, foulsAgainst: 0,
    cornersFor: 0, cornersAgainst: 0,
    yellowFor: 0, yellowAgainst: 0
  };
}

function aggregate(rows) {
  if (!rows.length) throw new Error("Fichier CSV vide.");
  const idx = {};
  rows[0].forEach((h, i) => { const k = h.trim(); if (!(k in idx)) idx[k] = i; });
  ["HomeTeam", "AwayTeam"].forEach(k => {
    if (!(k in idx)) throw new Error("Format CSV inattendu (colonne " + k + " absente).");
  });

  const val = (r, k) => {
    if (!(k in idx)) return null;
    const v = (r[idx[k]] || "").trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const teams = {};
  const league = { n: 0, homeGoals: 0, awayGoals: 0 };
  const add = (name, side, mine, theirs) => {
    if (!teams[name]) teams[name] = { all: emptyTotals(), home: emptyTotals(), away: emptyTotals() };
    [teams[name].all, teams[name][side]].forEach(t => {
      t.n++;
      t.goalsFor += mine.g; t.goalsAgainst += theirs.g;
      t.shotsFor += mine.s; t.shotsAgainst += theirs.s;
      t.foulsFor += mine.f; t.foulsAgainst += theirs.f;
      t.cornersFor += mine.c; t.cornersAgainst += theirs.c;
      t.yellowFor += mine.y; t.yellowAgainst += theirs.y;
    });
  };

  rows.slice(1).forEach(r => {
    const home = (r[idx.HomeTeam] || "").trim();
    const away = (r[idx.AwayTeam] || "").trim();
    if (!home || !away) return;
    const h = { g: val(r, "FTHG"), s: val(r, "HS"), f: val(r, "HF"), c: val(r, "HC"), y: val(r, "HY") };
    const a = { g: val(r, "FTAG"), s: val(r, "AS"), f: val(r, "AF"), c: val(r, "AC"), y: val(r, "AY") };
    if ([h.g, h.s, h.f, h.c, h.y, a.g, a.s, a.f, a.c, a.y].some(v => v === null)) return;
    add(home, "home", h, a);
    add(away, "away", a, h);
    league.n++;
    league.homeGoals += h.g;
    league.awayGoals += a.g;
  });
  if (league.n) {
    league.homeGoals = Math.round((league.homeGoals / league.n) * 100) / 100;
    league.awayGoals = Math.round((league.awayGoals / league.n) * 100) / 100;
  }
  return { teams, league };
}

function averages(t) {
  if (!t || !t.n) return null;
  const r = v => Math.round((v / t.n) * 100) / 100;
  return {
    n: t.n,
    goalsFor: r(t.goalsFor), goalsAgainst: r(t.goalsAgainst),
    shotsFor: r(t.shotsFor), shotsAgainst: r(t.shotsAgainst),
    foulsFor: r(t.foulsFor), foulsAgainst: r(t.foulsAgainst),
    cornersFor: r(t.cornersFor), cornersAgainst: r(t.cornersAgainst),
    yellowFor: r(t.yellowFor), yellowAgainst: r(t.yellowAgainst)
  };
}

async function fetchCsv(csvCode, season) {
  let lastError = new Error("Source indisponible.");
  for (const host of CSV_HOSTS) {
    try {
      const response = await fetch(host + "/mmz4281/" + season + "/" + csvCode + ".csv", {
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) { lastError = new Error("HTTP " + response.status); continue; }
      const buffer = await response.arrayBuffer();
      try { return new TextDecoder("windows-1252").decode(buffer); }
      catch (e) { return new TextDecoder("utf-8").decode(buffer); }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function getLeagueStats(league, seasonOverride) {
  const csvCode = LEAGUE_CSV[league];
  const first = seasonOverride || seasonCode();
  const seasons = seasonOverride ? [first] : [first, previousSeason(first)];
  let lastError = new Error("Aucune donnée disponible.");

  for (const season of seasons) {
    const key = csvCode + ":" + season;
    const hit = statsCache.get(key);
    if (hit && Date.now() - hit.time < STATS_TTL) return hit.value;
    try {
      const { teams, league: leagueAvg } = aggregate(parseCsv(await fetchCsv(csvCode, season)));
      if (Object.keys(teams).length) {
        const value = { season, teams, league: leagueAvg };
        statsCache.set(key, { time: Date.now(), value });
        return value;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// --- Rapprochement des noms d'équipes (API « Manchester United FC » <-> CSV « Man United ») ---
const STOP_WORDS = new Set([
  "fc", "cf", "afc", "sc", "ac", "as", "ssc", "ss", "us", "rc", "rcd", "ud", "sd", "cd",
  "fsv", "tsg", "vfl", "vfb", "sv", "bv", "bsc", "ogc", "sco", "de", "del", "di", "da",
  "the", "club", "clube", "calcio", "football"
]);

const TEAM_ALIASES = {
  "paris saint germain": "Paris SG",
  "atletico madrid": "Ath Madrid",
  "athletic": "Ath Bilbao",
  "borussia monchengladbach": "M'gladbach",
  "internazionale milano": "Inter",
  "bayern munchen": "Bayern Munich",
  "stade rennais": "Rennes",
  "wolverhampton wanderers": "Wolves",
  "espanyol barcelona": "Espanol",
  "sporting portugal": "Sp Lisbon",
  "sporting braga": "Sp Braga",
  "vitoria": "Guimaraes"
};

function teamTokens(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(t => t.length > 1 && !/^\d+$/.test(t) && !STOP_WORDS.has(t));
}

function tokenMatch(a, b) {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

function matchTeam(requested, names) {
  const rt = teamTokens(requested);
  const alias = TEAM_ALIASES[rt.join(" ")];
  if (alias && names.includes(alias)) return alias;

  let best = null;
  let bestScore = 0;
  for (const name of names) {
    const nt = teamTokens(name);
    if (!nt.length) continue;
    const hits = nt.filter(t => rt.some(u => tokenMatch(u, t))).length;
    const extra = rt.filter(u => !nt.some(t => tokenMatch(u, t))).length;
    const score = hits / nt.length - 0.01 * extra;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore >= 0.5 ? best : null;
}

app.get("/stats/match", async (req, res) => {
  try {
    const league = String(req.query.league || "").toUpperCase();
    const home = String(req.query.home || "");
    const away = String(req.query.away || "");

    if (!LEAGUE_CSV[league]) {
      return res.status(404).json({
        error: "Ce championnat n'est pas couvert par la source gratuite.",
        supported: Object.keys(LEAGUE_CSV)
      });
    }
    if (!home || !away) {
      return res.status(400).json({ error: "Les paramètres home et away sont obligatoires." });
    }

    const season = /^\d{4}$/.test(String(req.query.season || "")) ? String(req.query.season) : null;
    const data = await getLeagueStats(league, season);
    const names = Object.keys(data.teams);

    const build = requested => {
      const matched = matchTeam(requested, names);
      if (!matched) return { requested, matched: null, available: names.slice(0, 30) };
      const t = data.teams[matched];
      return { requested, matched, all: averages(t.all), home: averages(t.home), away: averages(t.away) };
    };

    res.json({
      source: "football-data.co.uk",
      season: "20" + data.season.slice(0, 2) + "/" + data.season.slice(2),
      league,
      leagueAverages: data.league,
      home: build(home),
      away: build(away),
      unavailable: ["Touches"]
    });
  } catch (error) {
    res.status(502).json({
      error: "Impossible de lire les statistiques détaillées.",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("MD ZE ZAYE API démarrée sur le port " + PORT);
});
