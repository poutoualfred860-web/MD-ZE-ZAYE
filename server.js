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

app.listen(PORT, () => {
  console.log("MD ZE ZAYE API démarrée sur le port " + PORT);
});
