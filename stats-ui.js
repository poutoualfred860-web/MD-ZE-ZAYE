/* MD ZE ZAYE — nouvel affichage des statistiques de match
   À charger APRÈS le script principal de index.html :
   <script src="stats-ui.js"></script>   (juste avant </body>) */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var BASE = 'https://md-ze-zaye.onrender.com';

  // ---------- Utilitaires ----------
  function H(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  function f1(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function f2(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
  function todayISO() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Porto-Novo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function frToIso(s) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s || '').slice(0, 10);
  }
  function persist() {
    if (typeof save === 'function') save();
    else { try { localStorage.setItem('mdzz_matches_v1', JSON.stringify(matches)); } catch (e) {} }
  }

  async function getJSON(url, tries) {
    var last;
    for (var t = 0; t < (tries || 2); t++) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 45000);
      try {
        var r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
        clearTimeout(timer);
        var ct = (r.headers && r.headers.get('content-type')) || '';
        if (ct.indexOf('json') === -1) throw new Error('Réponse inattendue du serveur (HTTP ' + r.status + ').');
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      } catch (e) {
        clearTimeout(timer);
        last = e;
        if (t < (tries || 2) - 1) await new Promise(function (res) { setTimeout(res, 1500); });
      }
    }
    throw last;
  }

  // ---------- Styles ----------
  var css = [
    '.sx{margin-top:10px;cursor:default;text-align:left}',
    '.sx-card{background:#0d0d0d;border:1px solid var(--line,#3c3218);border-radius:12px;padding:12px;margin:8px 0}',
    '.sx-t{color:var(--gold,#f6c945);font-weight:800;font-size:14px;margin:0 0 10px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
    '.sx-t small{color:var(--muted,#aaa69a);font-weight:500;font-size:11px;text-align:right}',
    '.sx-head{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;text-align:center}',
    '.sx-head img{width:36px;height:36px;object-fit:contain;display:block;margin:0 auto 4px}',
    '.sx-head b{font-size:13px;line-height:1.2;display:block}',
    '.sx-vs{color:var(--gold,#f6c945);font-weight:900;font-size:18px}',
    '.sx-head small{color:var(--muted,#aaa69a);font-size:11px}',
    '.sx-prob{display:flex;height:30px;border-radius:9px;overflow:hidden;background:#2a2a2a;font-size:12px;font-weight:800}',
    '.sx-prob span{display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;color:#101010;white-space:nowrap}',
    '.sx-prob .h{background:linear-gradient(90deg,#a87809,#ffe16a)}',
    '.sx-prob .d{background:#b9b3a2}',
    '.sx-prob .a{background:#7fb4e8}',
    '.sx-legend{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;font-size:11px;color:#d4c9a9;text-align:center}',
    '.sx-form{padding:8px 0;border-bottom:1px solid #29251b}',
    '.sx-form:last-child{border:0}',
    '.sx-form-top{display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '.sx-name{font-size:13px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sx-p{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-size:11px;font-weight:800;margin-left:3px;color:#111}',
    '.sx-p.V{background:#5cc98a}.sx-p.N{background:#b9b3a2}.sx-p.D{background:#e45d5d}',
    '.sx-sub{font-size:11px;color:var(--muted,#aaa69a);margin-top:4px}',
    '.sx-row{display:grid;grid-template-columns:48px 1fr 48px;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #29251b}',
    '.sx-row:last-child{border:0}',
    '.sx-v{font-weight:850;font-size:16px}.sx-v.r{text-align:right}',
    '.sx-c{text-align:center}.sx-lab{font-size:12px;color:#d4c9a9;margin-bottom:4px}',
    '.sx-bar{display:flex;height:6px;border-radius:9px;overflow:hidden;background:#2a2a2a}',
    '.sx-bar i{display:block;height:100%}.sx-bar .h{background:linear-gradient(90deg,#a87809,#ffe16a)}.sx-bar .a{background:#5b5b5b}',
    '.sx-row.na{display:flex;justify-content:space-between;gap:10px}',
    '.sx-na{font-size:12px;color:var(--muted,#aaa69a);text-align:right}',
    '.sx-est{display:grid;grid-template-columns:48px 1fr 48px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #29251b;font-size:13px}',
    '.sx-est:last-child{border:0}.sx-est b{text-align:center;font-weight:600;color:#d4c9a9;font-size:12px}.sx-est b em{color:var(--gold,#f6c945);font-style:normal;font-weight:800}',
    '.sx-est span{font-weight:800}.sx-est span:last-child{text-align:right}',
    '.sx-warn{font-size:12px;color:#e8d8a5;background:#171207;border:1px solid #684d16;border-radius:10px;padding:9px;margin:6px 0}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- Probabilités (Poisson) ----------
  function pois(k, l) { var p = Math.exp(-l); for (var i = 1; i <= k; i++) p *= l / i; return p; }

  function outcome(lh, la) {
    var h = 0, d = 0, a = 0;
    for (var i = 0; i <= 10; i++) {
      for (var j = 0; j <= 10; j++) {
        var p = pois(i, lh) * pois(j, la);
        if (i > j) h += p; else if (i === j) d += p; else a += p;
      }
    }
    var t = h + d + a;
    var ph = Math.round(h / t * 100), pa = Math.round(a / t * 100);
    return [ph, 100 - ph - pa, pa];
  }

  function computeLambdas(s, hf, af) {
    var ok = s && !s.error && s.home && s.home.all && s.away && s.away.all &&
      s.leagueAverages && s.leagueAverages.homeGoals > 0 && s.leagueAverages.awayGoals > 0;
    if (ok) {
      var L = s.leagueAverages, avg = (L.homeGoals + L.awayGoals) / 2, K = 4;
      var st = function (x, n) { return (n * (x / avg) + K) / (n + K); };
      var Hh = s.home.all, A = s.away.all;
      var lh = L.homeGoals * st(Hh.goalsFor, Hh.n) * st(A.goalsAgainst, A.n);
      var la = L.awayGoals * st(A.goalsFor, A.n) * st(Hh.goalsAgainst, Hh.n);
      var n = Math.min(Hh.n, A.n);
      return {
        lh: Math.max(0.1, lh), la: Math.max(0.1, la), n: n,
        basis: 'moyennes de la saison ' + s.season + ' (' + n + ' matchs minimum par équipe), corrigées par la moyenne du championnat',
        level: n >= 10 ? 'bonne' : n >= 5 ? 'moyenne' : 'faible'
      };
    }
    if (hf.xs.length >= 3 && af.xs.length >= 3) {
      var m = Math.min(hf.xs.length, af.xs.length);
      return {
        lh: Math.max(0.1, (hf.avgf + af.avga) / 2), la: Math.max(0.1, (af.avgf + hf.avga) / 2), n: m,
        basis: 'seulement les ' + m + ' derniers matchs de chaque équipe',
        level: 'faible'
      };
    }
    return null;
  }

  // ---------- Historique des 5 derniers matchs ----------
  async function recent(teamId, team) {
    if (teamId) {
      try {
        var d = await getJSON(BASE + '/teams/' + encodeURIComponent(teamId) + '/matches?status=FINISHED&limit=5', 1);
        var xs = (d.matches || []).map(function (x) {
          return {
            home: (x.homeTeam && x.homeTeam.name) || '', away: (x.awayTeam && x.awayTeam.name) || '',
            date: (x.utcDate || '').slice(0, 10),
            hg: num(x.score && x.score.fullTime && x.score.fullTime.home),
            ag: num(x.score && x.score.fullTime && x.score.fullTime.away)
          };
        }).filter(function (x) { return x.home && x.away && x.hg !== null && x.ag !== null; });
        if (xs.length) return summarize(xs, team, 'api');
      } catch (e) { /* on passe à l'historique local */ }
    }
    var local = matches.filter(function (x) {
      return String(x.status || '').toLowerCase().indexOf('termin') !== -1 &&
        num(x.hg) !== null && num(x.ag) !== null && (x.home === team || x.away === team);
    }).sort(function (a, b) { return String(frToIso(a.date)).localeCompare(String(frToIso(b.date))); })
      .slice(-5);
    return summarize(local, team, 'local');
  }

  function summarize(xs, team, src) {
    var gf = 0, ga = 0, w = 0, d = 0, l = 0;
    xs.forEach(function (x) {
      var home = x.home === team;
      var sc = num(home ? x.hg : x.ag), co = num(home ? x.ag : x.hg);
      if (sc === null || co === null) return;
      gf += sc; ga += co;
      if (sc > co) w++; else if (sc === co) d++; else l++;
    });
    return { xs: xs, src: src, w: w, d: d, l: l, avgf: xs.length ? gf / xs.length : null, avga: xs.length ? ga / xs.length : null };
  }

  function pills(t, team) {
    return t.xs.map(function (x) {
      var home = x.home === team;
      var g = home ? x.hg : x.ag, c = home ? x.ag : x.hg;
      var r = g > c ? 'V' : g === c ? 'N' : 'D';
      return '<span class="sx-p ' + r + '" title="' + H(x.home + ' ' + x.hg + '-' + x.ag + ' ' + x.away) + '">' + r + '</span>';
    }).join('');
  }

  // Moyenne locale (touches, hors-jeu…) à partir des matchs saisis ou importés
  function localAvg(team, hk, ak) {
    var vals = [];
    matches.forEach(function (m) {
      var h = num(m[hk]), a = num(m[ak]);
      if (h === null || a === null) return;
      if (m.home === team) vals.push([h, a]); else if (m.away === team) vals.push([a, h]);
    });
    if (!vals.length) return null;
    var n = vals.length;
    return {
      n: n,
      f: vals.reduce(function (s, v) { return s + v[0]; }, 0) / n,
      a: vals.reduce(function (s, v) { return s + v[1]; }, 0) / n
    };
  }

  // ---------- Rendu ----------
  function rowHtml(label, h, a) {
    if (h == null || a == null) {
      return '<div class="sx-row na"><div class="sx-lab" style="margin:0">' + label + '</div><div class="sx-na">Non disponible</div></div>';
    }
    var t = h + a, share = t > 0 ? Math.round(h / t * 100) : 50;
    return '<div class="sx-row"><div class="sx-v">' + f1(h) + '</div><div class="sx-c"><div class="sx-lab">' + label +
      '</div><div class="sx-bar"><i class="h" style="width:' + share + '%"></i><i class="a" style="width:' + (100 - share) + '%"></i></div></div><div class="sx-v r">' + f1(a) + '</div></div>';
  }

  function teamCell(name, logo) {
    return '<div>' + (logo ? '<img src="' + H(logo) + '" alt="">' : '') + '<b>' + H(name) + '</b></div>';
  }

  function render(i, f, hf, af, stats) {
    var out = '<div class="sx" onclick="event.stopPropagation()">';

    // 1) En-tête
    out += '<div class="sx-card"><div class="sx-head">' + teamCell(f.home, f.homeLogo) +
      '<div><div class="sx-vs">' + (f.hg != null && f.ag != null ? H(f.hg) + ' - ' + H(f.ag) : 'VS') + '</div><small>' + H(f.date) + '</small></div>' +
      teamCell(f.away, f.awayLogo) + '</div></div>';

    // 2) Probabilités
    var lam = computeLambdas(stats, hf, af);
    if (lam) {
      var p = outcome(lam.lh, lam.la);
      out += '<div class="sx-card"><div class="sx-t">Probabilités du match<small>Fiabilité : ' + lam.level + '</small></div>' +
        '<div class="sx-prob"><span class="h" style="width:' + p[0] + '%">' + p[0] + '%</span><span class="d" style="width:' + p[1] + '%">' + p[1] + '%</span><span class="a" style="width:' + p[2] + '%">' + p[2] + '%</span></div>' +
        '<div class="sx-legend"><span>Victoire<br>' + H(f.home) + '</span><span>Match nul</span><span>Victoire<br>' + H(f.away) + '</span></div>' +
        '<p class="hint" style="margin:10px 0 0">Buts attendus : ' + f2(lam.lh) + ' – ' + f2(lam.la) + '. Base de calcul : ' + H(lam.basis) +
        '. Estimation statistique indicative, sans cotes ni blessures : ce n’est pas une garantie.</p></div>';
    } else {
      out += '<div class="sx-card"><div class="sx-t">Probabilités du match</div><div class="sx-warn">Données insuffisantes : il faut les moyennes de saison du championnat, ou au moins 3 matchs récents pour chaque équipe. Aucun pourcentage n’est inventé.</div></div>';
    }

    // 3) Forme
    function formRow(name, t) {
      if (!t.xs.length) {
        return '<div class="sx-form"><div class="sx-form-top"><span class="sx-name">' + H(name) + '</span></div><div class="sx-sub">Historique indisponible (le serveur n’a rien renvoyé et aucun match n’est enregistré).</div></div>';
      }
      return '<div class="sx-form"><div class="sx-form-top"><span class="sx-name">' + H(name) + '</span><span>' + pills(t, name) + '</span></div>' +
        '<div class="sx-sub">' + t.w + ' V · ' + t.d + ' N · ' + t.l + ' D — buts marqués ' + f1(t.avgf) + ' / encaissés ' + f1(t.avga) + ' par match' +
        (t.src === 'local' ? ' (historique enregistré sur ton téléphone)' : '') + '</div></div>';
    }
    out += '<div class="sx-card"><div class="sx-t">Forme<small>5 derniers matchs, du plus ancien au plus récent</small></div>' + formRow(f.home, hf) + formRow(f.away, af) + '</div>';

    // 4) Statistiques moyennes par match
    var ok = stats && !stats.error && stats.home && stats.home.all && stats.away && stats.away.all;
    var defs = [
      ['Tirs', 'shotsFor', 'shotsAgainst'],
      ['Fautes', 'foulsFor', 'foulsAgainst'],
      ['Corners', 'cornersFor', 'cornersAgainst'],
      ['Cartons jaunes', 'yellowFor', 'yellowAgainst']
    ];
    var rows = '', est = '';
    var note = '';

    if (ok) {
      defs.forEach(function (d) {
        var hv = stats.home.all[d[1]], av = stats.away.all[d[1]];
        rows += rowHtml(d[0], hv, av);
        var eh = (stats.home.all[d[1]] + stats.away.all[d[2]]) / 2;
        var ea = (stats.away.all[d[1]] + stats.home.all[d[2]]) / 2;
        est += '<div class="sx-est"><span>' + f1(eh) + '</span><b>' + d[0] + ' · total <em>' + f1(eh + ea) + '</em></b><span>' + f1(ea) + '</span></div>';
      });
      note = 'Source : ' + H(stats.source) + ' · saison ' + H(stats.season) + ' · ' + H(stats.home.matched) + ' (' + stats.home.all.n + ' matchs) / ' + H(stats.away.matched) + ' (' + stats.away.all.n + ' matchs).';
    } else {
      var why = stats && stats.error ? stats.error : 'Équipe introuvable dans la source.';
      if (stats && !stats.error) {
        if (stats.home && !stats.home.matched) why = '« ' + stats.home.requested + ' » introuvable dans la source.';
        else if (stats.away && !stats.away.matched) why = '« ' + stats.away.requested + ' » introuvable dans la source.';
      }
      rows += '<div class="sx-warn">Statistiques détaillées indisponibles : ' + H(why) + '</div>';
      defs.forEach(function (d) { rows += rowHtml(d[0], null, null); });
    }

    // Touches et hors-jeu : jamais fournis par une source gratuite → historique local uniquement
    [['Touches', 'ht', 'at'], ['Hors-jeu', 'ho', 'ao']].forEach(function (d) {
      var hl = localAvg(f.home, d[1], d[2]), al = localAvg(f.away, d[1], d[2]);
      if (hl && al) {
        rows += rowHtml(d[0], hl.f, al.f);
        var eh2 = (hl.f + al.a) / 2, ea2 = (al.f + hl.a) / 2;
        est += '<div class="sx-est"><span>' + f1(eh2) + '</span><b>' + d[0] + ' · total <em>' + f1(eh2 + ea2) + '</em></b><span>' + f1(ea2) + '</span></div>';
      } else {
        rows += rowHtml(d[0], null, null);
      }
    });

    out += '<div class="sx-card"><div class="sx-t">Statistiques moyennes par match<small>domicile à gauche · extérieur à droite</small></div>' + rows +
      '<p class="hint" style="margin:8px 0 0">' + note + ' Touches et hors-jeu : aucune source gratuite ne les fournit ; elles ne s’affichent que si tu as enregistré des matchs avec ces valeurs pour les deux équipes.</p></div>';

    if (est) {
      out += '<div class="sx-card"><div class="sx-t">Estimation pour ce match<small>moyenne entre attaque et défense adverse</small></div>' + est +
        '<p class="hint" style="margin:8px 0 0">Calcul indicatif à partir des moyennes ci-dessus (domicile · total · extérieur).</p></div>';
    }

    out += '<button class="btn" onclick="event.stopPropagation();toggleFixtureStats(' + i + ')">Fermer les statistiques</button></div>';
    return out;
  }

  // ---------- Remplacement des fonctions de index.html ----------
  var origLoad = window.loadFixtures;
  window.loadFixtures = async function () {
    await origLoad.apply(this, arguments);
    var code = document.getElementById('fixtureLeague').value;
    var iso = document.getElementById('fixtureDate').value || todayISO();
    (loadedFixtures || []).forEach(function (f) { f.code = code; f.iso = iso; });
  };

  window.showFixtureStats = async function (i) {
    var f = loadedFixtures[i], root = document.getElementById('fixture-detail-' + i);
    if (!f || !root) return;
    root.innerHTML = '<div class="sx-card"><p class="hint" style="margin:0">Chargement… Le serveur gratuit peut mettre jusqu’à 30 secondes à se réveiller.</p></div>';

    var code = f.code || document.getElementById('fixtureLeague').value;
    var statsUrl = BASE + '/stats/match?league=' + encodeURIComponent(code) + '&home=' + encodeURIComponent(f.home) + '&away=' + encodeURIComponent(f.away);
    var res = await Promise.all([
      recent(f.homeId, f.home),
      recent(f.awayId, f.away),
      getJSON(statsUrl, 2).catch(function (e) { return { error: e.message }; })
    ]);
    if (root.dataset.open !== 'yes') return;
    root.innerHTML = render(i, f, res[0], res[1], res[2]);
  };

  function isoOf(f) { return f.iso || frToIso(f.date); }
  function appStatus(s) { return s === 'FINISHED' || s === 'AWARDED' ? 'Terminé' : 'À venir'; }

  function addFixture(i, silent) {
    var f = loadedFixtures[i];
    if (!f) return false;
    var iso = isoOf(f);
    var dup = matches.some(function (m) { return m.home === f.home && m.away === f.away && frToIso(m.date) === iso; });
    if (dup) { if (!silent) alert('Ce match est déjà dans ton historique.'); return false; }
    var done = appStatus(f.status) === 'Terminé';
    matches.unshift({
      id: Date.now() + Math.random(), league: f.league, home: f.home, away: f.away, date: iso,
      status: appStatus(f.status),
      hg: done && f.hg != null ? Number(f.hg) : null, ag: done && f.ag != null ? Number(f.ag) : null,
      hy: null, ay: null, hs: null, as: null, hf: null, af: null, ht: null, at: null, hc: null, ac: null, ho: null, ao: null,
      notes: 'Calendrier importé depuis une source publique ; statistiques détaillées non fournies automatiquement.'
    });
    if (!silent) { persist(); alert('Match ajouté. Les statistiques non fournies restent vides.'); }
    return true;
  }
  window.saveFixture = function (i) { addFixture(i, false); };

  window.saveVisibleFixtures = function () {
    if (!loadedFixtures.length) { alert('Charge d’abord les matchs.'); return; }
    var added = 0;
    loadedFixtures.forEach(function (f, i) { if (addFixture(i, true)) added++; });
    if (added) persist();
    alert(added + ' match(s) ajouté(s)' + (added < loadedFixtures.length ? ' · ' + (loadedFixtures.length - added) + ' déjà présent(s).' : '.'));
  };

  // Réparation unique des anciens matchs enregistrés (statut API et date « jj/mm/aaaa »)
  (function migrate() {
    var apiStatuses = ['FINISHED', 'AWARDED', 'SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'POSTPONED', 'SUSPENDED', 'CANCELLED', 'Programmé'];
    var changed = false;
    matches.forEach(function (m) {
      if (apiStatuses.indexOf(m.status) !== -1) { m.status = appStatus(m.status); changed = true; }
      if (/^\d{2}\/\d{2}\/\d{4}/.test(String(m.date || ''))) { m.date = frToIso(m.date); changed = true; }
    });
    if (changed) persist();
  })();
})();
