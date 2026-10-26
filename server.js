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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
const LEAGUE_CSV = {
  PL: "E0", ELC: "E1", PD: "SP1", SA: "I1", BL1: "D1", FL1: "F1", PPL: "P1", DED: "N1",
  T1: "T1", SC0: "SC0", B1: "B1", G1: "G1"
};
const LEAGUE_LABELS = {
  PL: "Premier League", ELC: "Championship", PD: "La Liga", SA: "Serie A", BL1: "Bundesliga", FL1: "Ligue 1",
  PPL: "Primeira Liga", DED: "Eredivisie", T1: "Süper Lig", SC0: "Scottish Premiership",
  B1: "Pro League (Belgique)", G1: "Super League (Grèce)"
};
// Ligue des Champions : aucune source gratuite ne donne ses statistiques,
// on utilise donc les moyennes du championnat national de chaque club.
const CL_SEARCH = ["PL", "PD", "SA", "BL1", "FL1", "PPL", "DED", "T1", "SC0", "B1", "G1"];
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

function csvDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(text || "").trim());
  if (!m) return "";
  let y = m[3];
  if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
  return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
}

function emptyTotals() {
  return {
    n: 0,
    goalsFor: 0, goalsAgainst: 0,
    shotsFor: 0, shotsAgainst: 0,
    foulsFor: 0, foulsAgainst: 0,
    cornersFor: 0, cornersAgainst: 0,
    yellowFor: 0, yellowAgainst: 0,
    shotsTot: 0, shotsTot2: 0, foulsTot: 0, foulsTot2: 0,
    cornersTot: 0, cornersTot2: 0, yellowTot: 0, yellowTot2: 0
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
  const ensure = name => {
    if (!teams[name]) teams[name] = { all: emptyTotals(), home: emptyTotals(), away: emptyTotals(), recent: [] };
    return teams[name];
  };
  const add = (name, side, mine, theirs) => {
    ensure(name);
    [teams[name].all, teams[name][side]].forEach(t => {
      t.n++;
      [["shots", "s"], ["fouls", "f"], ["corners", "c"], ["yellow", "y"]].forEach(([name, k]) => {
        const total = mine[k] + theirs[k];
        t[name + "Tot"] += total;
        t[name + "Tot2"] += total * total;
      });
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
    const rg = [val(r, "FTHG"), val(r, "FTAG")];
    const day = "Date" in idx ? csvDate(r[idx.Date]) : "";
    if (day && rg[0] !== null && rg[1] !== null) {
      const played = { d: day, home, away, hg: rg[0], ag: rg[1] };
      ensure(home).recent.push(played);
      ensure(away).recent.push(played);
    }
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
  // variance (échantillon) du total par match : sert à calculer des probabilités réalistes
  const variance = (sum, sum2) => {
    if (t.n < 3) return null;
    const mean = sum / t.n;
    return Math.round(Math.max(0, (sum2 / t.n - mean * mean) * t.n / (t.n - 1)) * 100) / 100;
  };
  return {
    shotsVar: variance(t.shotsTot, t.shotsTot2),
    foulsVar: variance(t.foulsTot, t.foulsTot2),
    cornersVar: variance(t.cornersTot, t.cornersTot2),
    yellowVar: variance(t.yellowTot, t.yellowTot2),
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
  "vitoria": "Guimaraes",
  "olympiacos": "Olympiakos",
  "inter milan": "Inter",
  "sporting cp": "Sp Lisbon"
};

function teamTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ı/g, "i").replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/đ/g, "d")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(t => t.length > 1 && !/^\d+$/.test(t) && !STOP_WORDS.has(t));
}

function tokenMatch(a, b) {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

function matchTeamScore(requested, names) {
  const rt = teamTokens(requested);
  const alias = TEAM_ALIASES[rt.join(" ")];
  if (alias && names.includes(alias)) return { name: alias, score: 1 };

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
  return bestScore >= 0.5 ? { name: best, score: bestScore } : null;
}

function matchTeam(requested, names) {
  const m = matchTeamScore(requested, names);
  return m ? m.name : null;
}

function teamPayload(requested, data, name, leagueCode) {
  const t = data.teams[name];
  return {
    requested,
    matched: name,
    league: leagueCode,
    leagueLabel: LEAGUE_LABELS[leagueCode] || leagueCode,
    season: "20" + data.season.slice(0, 2) + "/" + data.season.slice(2),
    all: averages(t.all),
    home: averages(t.home),
    away: averages(t.away),
    leagueAverages: data.league,
    recent: (t.recent || [])
      .slice()
      .sort((a, b) => a.d.localeCompare(b.d))
      .slice(-5)
      .map(x => ({ date: x.d, home: x.home, away: x.away, hg: x.hg, ag: x.ag }))
  };
}

// Cherche chaque club dans tous les championnats chargés (pour la Ligue des Champions).
function buildCross(home, away, loaded, leagueCode) {
  const find = requested => {
    let best = null;
    loaded.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const m = matchTeamScore(requested, Object.keys(r.value.teams));
      if (m && (!best || m.score > best.m.score)) best = { m, data: r.value, code: CL_SEARCH[i] };
    });
    return best;
  };
  const build = requested => {
    const b = find(requested);
    return b ? teamPayload(requested, b.data, b.m.name, b.code) : { requested, matched: null };
  };
  const h = build(home);
  const a = build(away);
  return {
    source: "football-data.co.uk",
    league: leagueCode || "CL",
    cross: true,
    season: h.season || a.season || null,
    home: h,
    away: a,
    unavailable: ["Touches"]
  };
}

async function statsPayload(league, home, away, season) {
  if (league === "CL" || league === "ANY") {
    const loaded = await Promise.allSettled(CL_SEARCH.map(code => getLeagueStats(code)));
    if (loaded.every(r => r.status !== "fulfilled")) {
      throw new Error("Aucun championnat n'a pu être chargé depuis football-data.co.uk.");
    }
    return buildCross(home, away, loaded, league);
  }

  if (!LEAGUE_CSV[league]) {
    const err = new Error("Ce championnat n'est pas couvert par la source gratuite.");
    err.status = 404;
    err.supported = Object.keys(LEAGUE_CSV).concat(["CL", "ANY"]);
    throw err;
  }

  const data = await getLeagueStats(league, season);
  const names = Object.keys(data.teams);
  const build = requested => {
    const matched = matchTeam(requested, names);
    if (!matched) return { requested, matched: null, available: names.slice(0, 30) };
    return teamPayload(requested, data, matched, league);
  };

  return {
    source: "football-data.co.uk",
    season: "20" + data.season.slice(0, 2) + "/" + data.season.slice(2),
    league,
    leagueAverages: data.league,
    home: build(home),
    away: build(away),
    unavailable: ["Touches"]
  };
}

app.get("/stats/match", async (req, res) => {
  try {
    const league = String(req.query.league || "").toUpperCase();
    const home = String(req.query.home || "");
    const away = String(req.query.away || "");

    if (!home || !away) {
      return res.status(400).json({ error: "Les paramètres home et away sont obligatoires." });
    }

    const season = /^\d{4}$/.test(String(req.query.season || "")) ? String(req.query.season) : null;
    res.json(await statsPayload(league, home, away, season));
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: error.message, supported: error.supported });
    }
    res.status(502).json({
      error: "Impossible de lire les statistiques détaillées.",
      details: error.message
    });
  }
});

// Plusieurs matchs en une seule requête : { items: [{ id, league, home, away }] }
app.post("/stats/batch", express.json({ limit: "300kb" }), async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 80) : [];
  const results = {};
  for (const item of items) {
    const id = String((item && item.id) || "");
    if (!id) continue;
    try {
      results[id] = await statsForItem(item);
    } catch (error) {
      results[id] = { error: error.message };
    }
  }
  res.json({ results });
});

// ===================================================================
// Calendrier des matchs (ESPN, sans clé) : un jour, toutes les compétitions
// ===================================================================
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_LEAGUES = [
  { slug: "eng.1", code: "PL", name: "Angleterre - Premier League", flag: "🇬🇧" },
  { slug: "esp.1", code: "PD", name: "Espagne - LaLiga", flag: "🇪🇸" },
  { slug: "ita.1", code: "SA", name: "Italie - Serie A", flag: "🇮🇹" },
  { slug: "ger.1", code: "BL1", name: "Allemagne - Bundesliga", flag: "🇩🇪" },
  { slug: "fra.1", code: "FL1", name: "France - Ligue 1", flag: "🇫🇷" },
  { slug: "uefa.champions", code: "CL", name: "Ligue des champions", flag: "🇪🇺" },
  { slug: "uefa.europa", code: "EL", name: "Ligue Europa", flag: "🇪🇺" },
  { slug: "uefa.europa.conf", code: "ECL", name: "Ligue Europa Conférence", flag: "🇪🇺" },
  { slug: "uefa.nations", code: "UNL", name: "Ligue des nations", flag: "🇪🇺" },
  { slug: "por.1", code: "PPL", name: "Portugal - Liga Portugal", flag: "🇵🇹" },
  { slug: "ned.1", code: "DED", name: "Pays-Bas - Eredivisie", flag: "🇳🇱" },
  { slug: "tur.1", code: "T1", name: "Turquie - Süper Lig", flag: "🇹🇷" },
  { slug: "bel.1", code: "B1", name: "Belgique - Pro League", flag: "🇧🇪" },
  { slug: "sco.1", code: "SC0", name: "Écosse - Premiership", flag: "🇬🇧" },
  { slug: "gre.1", code: "G1", name: "Grèce - Super League", flag: "🇬🇷" },
  { slug: "eng.2", code: "ELC", name: "Angleterre - Championship", flag: "🇬🇧" }
];
const dayCache = new Map();
const leagueLogos = {};

function normalizeEspnEvent(ev, league) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const list = comp.competitors || [];
  const h = list.find(c => c.homeAway === "home");
  const a = list.find(c => c.homeAway === "away");
  if (!h || !a || !h.team || !a.team) return null;

  const type = ((ev.status || comp.status || {}).type) || {};
  let status = "SCHEDULED";
  if (type.name === "STATUS_POSTPONED") status = "POSTPONED";
  else if (type.name === "STATUS_CANCELED" || type.name === "STATUS_CANCELLED") status = "CANCELLED";
  else if (type.state === "in") status = type.name === "STATUS_HALFTIME" ? "PAUSED" : "IN_PLAY";
  else if (type.state === "post" || type.completed) status = "FINISHED";

  const score = c => (status === "SCHEDULED" || c.score === undefined || c.score === "" || c.score === null) ? null : Number(c.score);
  const team = c => ({
    id: String(c.team.id || ""),
    name: c.team.displayName || c.team.shortDisplayName || c.team.name || "",
    crest: c.team.logo || (c.team.logos && c.team.logos[0] && c.team.logos[0].href) ||
      (c.team.id ? "https://a.espncdn.com/i/teamlogos/soccer/500/" + c.team.id + ".png" : "")
  });

  return {
    id: "espn-" + ev.id,
    code: league.code,
    competition: league.name,
    flag: league.flag,
    utcDate: ev.date || comp.date || "",
    status,
    clock: (ev.status && ev.status.displayClock) || "",
    home: team(h),
    away: team(a),
    homeScore: score(h),
    awayScore: score(a)
  };
}

async function espnLeagueDay(league, ymd) {
  const key = league.slug + ":" + ymd;
  const hit = dayCache.get(key);
  if (hit && Date.now() - hit.time < 60 * 1000) return hit.events;

  const response = await fetch(ESPN_BASE + "/" + league.slug + "/scoreboard?dates=" + ymd + "&limit=200", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = await response.json();
  const logo = data.leagues && data.leagues[0] && data.leagues[0].logos && data.leagues[0].logos[0] && data.leagues[0].logos[0].href;
  if (logo) leagueLogos[league.code] = logo;
  const events = (data.events || []).map(ev => normalizeEspnEvent(ev, league)).filter(Boolean);
  dayCache.set(key, { time: Date.now(), events });
  return events;
}

app.get("/day", async (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Paramètre date invalide (format AAAA-MM-JJ)." });
  }
  const ymd = date.replace(/-/g, "");
  const results = await Promise.allSettled(ESPN_LEAGUES.map(l => espnLeagueDay(l, ymd)));

  const matches = [];
  const diag = [];
  results.forEach((r, i) => {
    const code = ESPN_LEAGUES[i].code;
    if (r.status === "fulfilled") {
      matches.push(...r.value);
      if (r.value.length) diag.push(code + " : " + r.value.length);
    } else {
      diag.push(code + " : erreur (" + (r.reason && r.reason.message) + ")");
    }
  });

  if (results.every(r => r.status !== "fulfilled")) {
    return res.status(502).json({ error: "ESPN est injoignable depuis le serveur.", diag });
  }
  matches.sort((a, b) => String(a.utcDate).localeCompare(String(b.utcDate)));
  const logos = {};
  matches.forEach(m => { if (leagueLogos[m.code]) logos[m.code] = leagueLogos[m.code]; });
  res.json({ source: "espn", date, count: matches.length, matches, diag, logos });
});

// ===================================================================
// Statistiques réelles d'un match (ESPN) + moyennes par compétition
// pour les compétitions absentes des fichiers CSV (Ligue Europa, etc.)
// ===================================================================
const ESPN_SUMMARY_HOSTS = [
  "https://site.api.espn.com/apis/site/v2/sports/soccer",
  "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
];
const summaryCache = new Map();

const STAT_KEYS = [
  ["shotsOnTarget", /shotsontarget|ontarget/],
  ["shots", /^(totalshots|shots)$/],
  ["fouls", /foul/],
  ["corners", /corner/],
  ["yellow", /yellowcard/],
  ["red", /^redcards?$/],
  ["offsides", /offside/],
  ["saves", /^saves$/],
  ["possession", /possession/],
  ["throwIns", /throw/]
];
const squash = text => String(text || "").toLowerCase().replace(/[^a-z]/g, "");
const statNumber = v => {
  const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function parseBoxscore(data) {
  const header = (data && data.header && data.header.competitions && data.header.competitions[0]) || {};
  const sideById = {};
  (header.competitors || []).forEach(c => {
    if (c.team && c.homeAway) sideById[String(c.team.id)] = c.homeAway;
  });

  const out = { home: {}, away: {} };
  ((data && data.boxscore && data.boxscore.teams) || []).forEach(t => {
    const side = t.homeAway || sideById[String(t.team && t.team.id)];
    if (side !== "home" && side !== "away") return;
    (t.statistics || []).forEach(st => {
      const names = [squash(st.name), squash(st.label)];
      for (const [key, re] of STAT_KEYS) {
        if (out[side][key] !== undefined) continue;
        if (names.some(n => n && re.test(n))) {
          out[side][key] = statNumber(st.displayValue !== undefined ? st.displayValue : st.value);
          break;
        }
      }
    });
  });

  const goals = side => {
    const c = (header.competitors || []).find(x => x.homeAway === side);
    return c ? statNumber(c.score) : null;
  };
  const type = (header.status && header.status.type) || {};
  STAT_KEYS.forEach(([key]) => {
    if (out.home[key] === undefined) out.home[key] = null;
    if (out.away[key] === undefined) out.away[key] = null;
  });
  return { home: out.home, away: out.away, goals: [goals("home"), goals("away")], state: type.state || "", clock: (header.status && header.status.displayClock) || "" };
}

async function espnSummary(slug, eventId) {
  const key = slug + ":" + eventId;
  const hit = summaryCache.get(key);
  if (hit && Date.now() < hit.until) return hit.data;

  let last = null;
  for (const host of ESPN_SUMMARY_HOSTS) {
    try {
      const response = await fetch(host + "/" + slug + "/summary?event=" + encodeURIComponent(eventId), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) { last = new Error("HTTP " + response.status); continue; }
      const parsed = parseBoxscore(await response.json());
      const ttl = parsed.state === "post" ? 24 * 3600 * 1000 : 30 * 1000;
      summaryCache.set(key, { until: Date.now() + ttl, data: parsed });
      if (summaryCache.size > 2500) summaryCache.delete(summaryCache.keys().next().value);
      return parsed;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("ESPN indisponible");
}

app.get("/match-stats", async (req, res) => {
  const code = String(req.query.code || "").toUpperCase();
  const event = String(req.query.event || "").replace(/^espn-/, "");
  const league = ESPN_LEAGUES.find(l => l.code === code);
  if (!league || !/^\d+$/.test(event)) {
    return res.status(400).json({ error: "Paramètres code et event invalides." });
  }
  try {
    res.json(Object.assign({ source: "espn", event }, await espnSummary(league.slug, event)));
  } catch (error) {
    res.status(502).json({ error: "Statistiques du match indisponibles (" + error.message + ")." });
  }
});

// --- Moyennes par équipe calculées sur les matchs terminés d'une compétition ---
const compStatsCache = new Map();
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

async function mapPool(items, size, fn) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; }
    }
  }));
  return out;
}

function accumulate(t, mine, theirs) {
  t.n++;
  [["shots", "s"], ["fouls", "f"], ["corners", "c"], ["yellow", "y"]].forEach(([name, k]) => {
    const total = mine[k] + theirs[k];
    t[name + "Tot"] += total;
    t[name + "Tot2"] += total * total;
  });
  t.goalsFor += mine.g; t.goalsAgainst += theirs.g;
  t.shotsFor += mine.s; t.shotsAgainst += theirs.s;
  t.foulsFor += mine.f; t.foulsAgainst += theirs.f;
  t.cornersFor += mine.c; t.cornersAgainst += theirs.c;
  t.yellowFor += mine.y; t.yellowAgainst += theirs.y;
}

async function competitionHistory(league) {
  const from = new Date(Date.now() - 75 * 24 * 3600 * 1000);
  const response = await fetch(ESPN_BASE + "/" + league.slug + "/scoreboard?dates=" + ymd(from) + "-" + ymd(new Date()) + "&limit=500", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = await response.json();
  return (data.events || [])
    .map(ev => normalizeEspnEvent(ev, league))
    .filter(e => e && e.status === "FINISHED")
    .sort((a, b) => String(b.utcDate).localeCompare(String(a.utcDate)))
    .slice(0, 90);
}

function competitionStats(code) {
  const hit = compStatsCache.get(code);
  if (hit && Date.now() - hit.time < 3 * 3600 * 1000) return hit.promise;
  const league = ESPN_LEAGUES.find(l => l.code === code);
  const promise = (async () => {
    const events = await competitionHistory(league);
    const sums = await mapPool(events, 5, ev => espnSummary(league.slug, ev.id.replace(/^espn-/, "")));
    const teams = {};
    events.forEach((ev, i) => {
      const p = sums[i];
      if (!p || ev.homeScore === null || ev.awayScore === null) return;
      const keys = ["shots", "fouls", "corners", "yellow"];
      if (keys.some(k => p.home[k] === null || p.away[k] === null)) return;
      const pack = (m, g) => ({ g, s: m.shots, f: m.fouls, c: m.corners, y: m.yellow });
      [[ev.home, p.home, p.away, ev.homeScore, ev.awayScore], [ev.away, p.away, p.home, ev.awayScore, ev.homeScore]].forEach(([team, m, o, g, ga]) => {
        if (!teams[team.id]) teams[team.id] = { name: team.name, all: emptyTotals() };
        accumulate(teams[team.id].all, pack(m, g), pack(o, ga));
      });
    });
    return teams;
  })();
  compStatsCache.set(code, { time: Date.now(), promise });
  promise.catch(() => compStatsCache.delete(code));
  return promise;
}

function espnSide(teams, id, requested, code) {
  const t = teams[String(id)];
  if (!t) return { requested, matched: null };
  const league = ESPN_LEAGUES.find(l => l.code === code);
  return {
    requested, matched: t.name, league: code, leagueLabel: league ? league.name : code, season: "saison en cours",
    src: "espn", all: averages(t.all), home: null, away: null, leagueAverages: null, recent: []
  };
}

// CSV d'abord ; si une équipe est introuvable (ou compétition non couverte), moyennes ESPN de la compétition
async function statsForItem(item) {
  const league = String(item.league || "").toUpperCase();
  const code = String(item.code || "").toUpperCase();
  const home = String(item.home || "");
  const away = String(item.away || "");
  let payload = null;
  let firstError = null;

  if (league !== "ESPN") {
    try { payload = await statsPayload(league, home, away, null); } catch (e) { firstError = e; }
  }

  const ok = side => side && side.matched && side.all;
  if ((!payload || !ok(payload.home) || !ok(payload.away)) && ESPN_LEAGUES.some(l => l.code === code)) {
    try {
      const teams = await competitionStats(code);
      const base = payload || { source: "espn", league: code, unavailable: ["Touches"] };
      payload = Object.assign({}, base, {
        home: ok(base.home) ? base.home : espnSide(teams, item.homeId, home, code),
        away: ok(base.away) ? base.away : espnSide(teams, item.awayId, away, code)
      });
    } catch (e) {
      if (!payload) throw firstError || e;
    }
  }
  if (!payload) throw firstError || new Error("Statistiques indisponibles.");
  return payload;
}

// Proxy d'images (logos d'équipes et de compétitions) : le navigateur peut ainsi les dessiner
// dans une vraie image téléchargeable (sans cela, il bloque l'export à cause des règles CORS).
const IMG_HOSTS = ["a.espncdn.com", "a1.espncdn.com", "a2.espncdn.com", "a3.espncdn.com", "a4.espncdn.com", "crests.football-data.org", "upload.wikimedia.org"];
app.get("/img", async (req, res) => {
  let url;
  try { url = new URL(String(req.query.u || "")); } catch (e) { return res.status(400).json({ error: "URL invalide." }); }
  if (url.protocol !== "https:" || !IMG_HOSTS.includes(url.hostname)) {
    return res.status(400).json({ error: "Hôte non autorisé." });
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "image/*" } });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("image/")) return res.status(502).json({ error: "Image indisponible." });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: "Image trop lourde." });
    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=604800");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(buffer);
  } catch (error) {
    res.status(502).json({ error: "Image indisponible." });
  }
});

app.listen(PORT, () => {
  console.log("MD ZE ZAYE API démarrée sur le port " + PORT);
});
