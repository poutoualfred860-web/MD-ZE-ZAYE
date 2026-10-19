const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

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

    const today = new Date().toISOString().slice(0, 10);
    const startDate = req.query.dateFrom || today;
    const endDate = req.query.dateTo || today;

    const url =
      "https://api.football-data.org/v4/matches" +
      "?dateFrom=" + encodeURIComponent(startDate) +
      "&dateTo=" + encodeURIComponent(endDate);

    const response = await fetch(url, {
      headers: { "X-Auth-Token": TOKEN }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "football-data.org a refusé la demande.",
        details: data
      });
    }

    res.json({
      source: "football-data.org",
      count: (data.matches || []).length,
      matches: data.matches || []
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
    const today = new Date().toISOString().slice(0, 10);

    const startDate = req.query.dateFrom || today;
    const endDate = req.query.dateTo || today;

    const url =
      "https://api.football-data.org/v4/competitions/" +
      code + "/matches" +
      "?dateFrom=" + encodeURIComponent(startDate) +
      "&dateTo=" + encodeURIComponent(endDate);

    const response = await fetch(url, {
      headers: { "X-Auth-Token": TOKEN }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Impossible de récupérer cette compétition.",
        details: data
      });
    }

    res.json({
      source: "football-data.org",
      competition: data.competition || null,
      count: (data.matches || []).length,
      matches: data.matches || []
    });
  } catch (error) {
    res.status(500).json({
      error: "Erreur pendant la récupération des matchs.",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("MD ZE ZAYE API démarrée sur le port " + PORT);
});
