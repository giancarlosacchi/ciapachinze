/* Ciapachinze — modalità Arcade: "Il giro della Liguria"
 * Tappe lungo la costa, avversari sempre più forti, obiettivi e stelle, achievement.
 * Dipende da engine.js (Cirulla) ed è usato da app.js.
 */
(function (root) {
  'use strict';
  const C = root.Cirulla;

  /* ---------- livelli di intelligenza del computer ----------
   * 0 = ingenuo: gioca la prima carta utile, non pensa a cosa lascia
   * 1 = medio: valuta prese, denari, settebello, scope (il bot storico)
   * 2 = furbo: come medio + evita di lasciare in tavola somme che l'avversario può fare 15/prendere,
   *     tiene il settebello, conta le carte uscite, sfrutta l'asso
   * 3 = campione: furbo + guarda avanti di una mossa con simulazione leggera
   */
  const BOT_NAMES = {
    0: ['Bacci', 'Rina', 'Tugnin', 'Ciccio'],
    1: ['Bacci', 'Rina', 'Tugnin', 'Ciccio'],
    2: ['Bacci', 'Rina', 'Tugnin', 'Ciccio'],
    3: ['Bacci', 'Rina', 'Tugnin', 'Ciccio'],
  };

  function seenCards(g) {
    const s = new Set();
    g.captured.forEach(c => c.forEach(id => s.add(id)));
    g.table.forEach(t => s.add(t.id));
    return s;
  }

  /** ritorna {card, idx} per il posto seat con la difficoltà data */
  function chooseMove(g, seat, level, rng) {
    rng = rng || Math.random;
    const hand = g.hands[seat];
    const team = C.teamOf(g, seat);
    const seen = seenCards(g);
    hand.forEach(id => seen.add(id));
    const unseen = C.fullDeck().filter(id => !seen.has(id));
    const unseenVals = unseen.map(C.rankOf);
    const cands = [];
    for (const card of hand) {
      const opts = C.optionsFor(g, seat, card);
      const v = C.playValue(g, card);
      if (!opts.length) cands.push({ card, idx: null, taken: [], v, leaveTable: g.table.map(t => t.val).concat(v) });
      else for (const o of opts) cands.push({ card, idx: o.idx, taken: o.idx.map(i => g.table[i].id), v, scopa: o.scopa, kind: o.kind, leaveTable: g.table.filter((_, i) => !o.idx.includes(i)).map(t => t.val) });
    }
    if (!cands.length) return null;

    if (level === 0) {
      // ingenuo: prende se può (la presa più grossa a caso), altrimenti carta a caso
      const takes = cands.filter(c => c.idx);
      if (takes.length && rng() < .85) return takes[Math.floor(rng() * takes.length)];
      return cands[Math.floor(rng() * cands.length)];
    }

    const score = c => {
      let s = 0;
      const mine = c.taken.concat(c.idx ? [c.card] : []);
      if (c.idx) {
        s += mine.length * 1.2;
        s += mine.filter(id => C.suitOf(id) === 'D').length * 2.2;
        if (mine.includes(C.SETTEBELLO)) s += 9;
        if (c.scopa && g.cardsPlayed < 35) s += 6;
        s += mine.reduce((a, id) => a + C.PRIMIERA[C.rankOf(id)], 0) / 25;
        // grande / piccola
        const dRanks = mine.filter(id => C.suitOf(id) === 'D').map(C.rankOf);
        if (dRanks.some(r => r >= 8)) s += 1.2; if (dRanks.some(r => r <= 3)) s += 1;
      } else {
        s -= 0.5;
        if (c.card === C.SETTEBELLO) s -= 12;
        if (C.suitOf(c.card) === 'D') s -= 2.5;
        if (c.v === 1) s -= 4;               // non buttare via l'asso
        if (c.card === C.MATTA && g.mattaVal) s -= 3;
      }
      if (level >= 2) {
        // rischio: cosa può fare l'avversario con le carte che restano in tavola
        const table = c.leaveTable;
        const sum = table.reduce((a, b) => a + b, 0);
        let risk = 0;
        // scopa per l'avversario se ha una carta = somma o = 15 - somma, o un asso
        const needs = new Set([sum, 15 - sum]);
        const probHas = val => unseenVals.filter(x => x === val).length / Math.max(1, unseenVals.length) * 3; // ~3 carte in mano
        if (table.length) {
          needs.forEach(n => { if (n >= 1 && n <= 10) risk += probHas(n) * (table.length + 1) * 1.5; });
          risk += probHas(1) * (table.length + 1) * 1.2;   // asso piglia tutto
          // singole carte di valore lasciate
          table.forEach(val => { risk += probHas(val) * .8 + probHas(15 - val) * .8; });
          if (c.leaveTable.length && !c.idx && C.suitOf(c.card) === 'D') risk += 2;
          if (!c.idx && c.card === C.SETTEBELLO) risk += 6;
        }
        s -= risk;
        // preferisci lasciare carte alte quando devi lasciare
        if (!c.idx && c.v >= 8) s += .6;
      }
      if (level >= 3) {
        // guarda avanti: risposta avversaria attesa, pesata sulla probabilità che abbia quella carta
        const table = c.leaveTable;
        const tv = table.map((v, i) => ({ id: 'x' + i, val: v }));
        const counts = {}; unseenVals.forEach(v => counts[v] = (counts[v] || 0) + 1);
        const nU = Math.max(1, unseenVals.length);
        let expected = 0, worst = 0;
        for (const val in counts) {
          const opts = C.captureOptions(tv, +val);
          let best = 0;
          for (const o of opts) { const gain = o.idx.length * 1.2 + 1 + (o.scopa && g.cardsPlayed < 34 ? 6 : 0); if (gain > best) best = gain; }
          const pHas = 1 - Math.pow(1 - counts[val] / nU, 3);
          expected += pHas * best; if (best * pHas > worst) worst = best * pHas;
        }
        s -= expected * .6 + worst * .4;
        // ultima carta della mano: le carte in tavola andranno a chi ha preso per ultimo
        if (g.cardsPlayed === 35 && c.idx) s += table.length * .8;
        // tieni un asso per una scopa futura se il tavolo è ricco
        if (!c.idx && c.v === 1) s -= 3;
        // in fine mano, prendere denari conta doppio
        if (g.cardsPlayed >= 30 && c.idx) s += c.taken.concat([c.card]).filter(id => C.suitOf(id) === 'D').length;
      }
      return s + rng() * .3;
    };
    let best = null;
    for (const c of cands) { const sc = score(c); if (!best || sc > best.sc) best = { ...c, sc }; }
    return best;
  }

  /* ---------- obiettivi ----------
   * Ogni obiettivo è valutato sul risultato della smazzata/partita: (ctx) => {ok, progress, text}
   * ctx: { deal: history entry, my, ot, scores, won, dealsPlayed, streak, stats }
   */
  const GOALS = {
    winDeal:      { text: 'Vinci la smazzata', check: c => c.deal.teams[c.my].total > c.deal.teams[c.ot].total },
    winGame:      { text: t => `Arriva a ${t} punti prima di lui`, check: c => c.won },
    scope:        { text: n => `Fai almeno ${n} scop${n === 1 ? 'a' : 'e'} in una smazzata`, check: (c, n) => c.deal.teams[c.my].scope >= n },
    settebello:   { text: 'Prendi il settebello', check: c => c.deal.teams[c.my].settebello === 1 },
    denari:       { text: 'Vinci i denari', check: c => c.deal.teams[c.my].denari === 1 },
    primiera:     { text: 'Vinci la primiera', check: c => c.deal.teams[c.my].primiera === 1 },
    carte:        { text: 'Prendi più carte di lui', check: c => c.deal.teams[c.my].carte === 1 },
    piccola:      { text: 'Fai la piccola (A-2-3 di denari)', check: c => c.deal.teams[c.my].piccola >= 3 },
    grande:       { text: 'Fai la grande (J-Q-K di denari)', check: c => c.deal.teams[c.my].grande >= 5 },
    noScopeAgainst:{ text: 'Vinci la smazzata senza subire scope', check: c => c.deal.teams[c.my].total > c.deal.teams[c.ot].total && c.deal.teams[c.ot].scope === 0 },
    margin:       { text: n => `Vinci la smazzata con almeno ${n} punti di scarto`, check: (c, n) => c.deal.teams[c.my].total - c.deal.teams[c.ot].total >= n },
    points:       { text: n => `Fai almeno ${n} punti in una smazzata`, check: (c, n) => c.deal.teams[c.my].total >= n },
    allMazzo:     { text: 'Vinci carte, denari, settebello e primiera insieme', check: c => { const t = c.deal.teams[c.my]; return t.carte && t.denari && t.settebello && t.primiera; } },
    buona:        { text: 'Bussa una buona (in mano)', check: c => c.deal.buone.some(b => c.mySeats.includes(b.seat)) },
    handicap:     { text: n => `Vinci la partita partendo da ${n} punti sotto`, check: c => c.won },
    cappotto:     { text: 'Fai cappotto (tutti i denari)', check: c => c.deal.cappotto === c.my },
  };

  /* ---------- tappe: il giro della Liguria ---------- */
  const ZONES = [
    { name: 'Riviera di Ponente', color: '#e0a03a' },
    { name: 'Savonese', color: '#d9694a' },
    { name: 'Genova', color: '#c8202f' },
    { name: 'Golfo Paradiso e Tigullio', color: '#2f6f8f' },
    { name: 'Riviera di Levante', color: '#7f5fbf' },
  ];
  // level: bot; players: 2|4; target: punteggio partita (se goal richiede la partita); deals: max smazzate; goal: [key, arg]; bonus: [key,arg] per la 3ª stella; handicap: punti di partenza avversario
  const STAGES = [
    // Ponente — imparare
    { id: 1, zone: 0, town: 'Ventimiglia', who: 'Bacci il pescatore', level: 0, players: 2, deals: 1, goal: ['winDeal'], bonus: ['scope', 1], intro: 'Il tavolo del porto. Bacci gioca a caso: prendi tutto quello che puoi.' },
    { id: 2, zone: 0, town: 'Bordighera', who: 'Rina della pasticceria', level: 0, players: 2, deals: 1, goal: ['settebello'], bonus: ['denari'], intro: 'Il 7 di denari vale sempre un punto: prendilo.' },
    { id: 3, zone: 0, town: 'Sanremo', who: 'Tugnin del casinò', level: 0, players: 2, deals: 1, goal: ['scope', 2], bonus: ['scope', 3], intro: 'Svuota il tavolo due volte. L\'asso piglia tutto e vale scopa.' },
    { id: 4, zone: 0, town: 'Imperia', who: 'Ciccio dell\'oliveto', level: 1, players: 2, deals: 1, goal: ['denari'], bonus: ['carte'], intro: 'Da qui il computer inizia a ragionare. Punta ai denari.' },
    { id: 5, zone: 0, town: 'Alassio', who: 'la Marisa del Muretto', level: 1, players: 2, deals: 2, goal: ['primiera'], bonus: ['noScopeAgainst'], intro: 'Primiera: una carta per seme, i 7 valgono 21, i 6 18, gli assi 16.' },
    // Savonese — obiettivi doppi
    { id: 6, zone: 1, town: 'Albenga', who: 'Nino l\'ortolano', level: 1, players: 2, deals: 1, goal: ['margin', 3], bonus: ['margin', 6], intro: 'Non basta vincere: vinci di almeno 3.' },
    { id: 7, zone: 1, town: 'Finale', who: 'la banda della spiaggia', level: 1, players: 4, deals: 1, goal: ['winDeal'], bonus: ['scope', 2], intro: 'Prima tappa a coppie: il tuo compagno è un computer. Fidati, ma non troppo.' },
    { id: 8, zone: 1, town: 'Noli', who: 'il fra\' del convento', level: 1, players: 2, deals: 2, goal: ['buona'], bonus: ['winDeal'], intro: 'Tre carte che fanno 9 o meno: bussa. Serve un po\' di fortuna, hai due smazzate.' },
    { id: 9, zone: 1, town: 'Savona', who: 'Gigi del cantiere', level: 2, players: 2, deals: 1, goal: ['noScopeAgainst'], bonus: ['margin', 4], intro: 'Gigi calcola cosa lasci in tavola. Non lasciargli mai una scopa.' },
    { id: 10, zone: 1, town: 'Varazze', who: 'il Capitano', level: 2, players: 2, target: 21, goal: ['winGame', 21], bonus: ['settebello'], intro: 'Partita corta a 21. Chi arriva primo.' },
    // Genova — la città
    { id: 11, zone: 2, town: 'Voltri', who: 'la Teresa del focaccificio', level: 2, players: 2, deals: 1, goal: ['points', 8], bonus: ['points', 11], intro: 'Otto punti in una sola smazzata: scope, denari, primiera, tutto conta.' },
    { id: 12, zone: 2, town: 'Sampierdarena', who: 'i portuali', level: 2, players: 4, deals: 2, goal: ['winDeal'], bonus: ['denari'], intro: 'A coppie contro due portuali che si intendono a cenni.' },
    { id: 13, zone: 2, town: 'Porto Antico', who: 'Colombo', level: 2, players: 2, deals: 2, goal: ['piccola'], bonus: ['grande'], intro: 'Asso, due e tre di denari: la piccola vale 3 punti, di più se continui la scala.' },
    { id: 14, zone: 2, town: 'Boccadasse', who: 'la nonna Angela', level: 3, players: 2, deals: 1, goal: ['winDeal'], bonus: ['noScopeAgainst'], intro: 'Nonna Angela gioca da settant\'anni. Guarda avanti di una mossa come lei.' },
    { id: 15, zone: 2, town: 'Sori', who: 'il Campione di Sori', level: 3, players: 2, target: 31, goal: ['winGame', 31], bonus: ['margin', 8], intro: 'Il boss di Genova. Partita a 31, senza sconti.' },
    // Tigullio — pressione
    { id: 16, zone: 3, town: 'Recco', who: 'i fratelli della focaccia', level: 2, players: 4, deals: 2, goal: ['scope', 3], bonus: ['winDeal'], intro: 'Tre scope in coppia. Coordinati con il tuo compagno: lui non lascia assi in giro.' },
    { id: 17, zone: 3, town: 'Camogli', who: 'il Pittore', level: 3, players: 2, deals: 1, goal: ['allMazzo'], bonus: ['scope', 1], intro: 'Carte, denari, settebello e primiera: tutti e quattro i punti di mazzo.' },
    { id: 18, zone: 3, town: 'Portofino', who: 'lo Yachtista', level: 3, players: 2, target: 31, handicap: 10, goal: ['handicap', 10], bonus: ['settebello'], intro: 'Lui parte da 10. Tu da zero. Recupera.' },
    { id: 19, zone: 3, town: 'Rapallo', who: 'le signore del circolo', level: 3, players: 4, target: 31, goal: ['winGame', 31], bonus: ['scope', 2], intro: 'Una partita intera a coppie contro chi gioca ogni pomeriggio.' },
    { id: 20, zone: 3, town: 'Chiavari', who: 'il Notaio', level: 3, players: 2, deals: 1, goal: ['margin', 7], bonus: ['grande'], intro: 'Il Notaio non sbaglia un conto. Vinci di sette.' },
    // Levante — maestria
    { id: 21, zone: 4, town: 'Sestri Levante', who: 'la Sirena', level: 3, players: 2, target: 51, handicap: 15, goal: ['handicap', 15], bonus: ['noScopeAgainst'], intro: 'Partita a 51 partendo 15 punti sotto.' },
    { id: 22, zone: 4, town: 'Monterosso', who: 'i vignaioli', level: 3, players: 4, target: 51, goal: ['winGame', 51], bonus: ['piccola'], intro: 'La partita vera a coppie, fino a 51.' },
    { id: 23, zone: 4, town: 'Portovenere', who: 'il Poeta', level: 3, players: 2, deals: 3, goal: ['cappotto'], bonus: ['grande'], intro: 'Tutti e dieci i denari in una smazzata. Tre tentativi. Quasi impossibile.' },
    { id: 24, zone: 4, town: 'La Spezia', who: 'l\'Ammiraglio', level: 3, players: 2, target: 71, handicap: 20, goal: ['handicap', 20], bonus: ['margin', 15], intro: 'L\'ultima tappa: 71 punti, lui parte da 20. Se vinci, sei il re della cirulla.' },
  ];

  /* ---------- achievement ---------- */
  const ACHIEVEMENTS = [
    { id: 'first', name: 'Primo sangue', desc: 'Vinci la prima tappa', icon: '🎣', check: s => s.stagesDone >= 1 },
    { id: 'scopa10', name: 'Scopatore', desc: 'Fai 10 scope in totale', icon: '🧹', check: s => s.scope >= 10 },
    { id: 'scopa100', name: 'Ramazza d\'oro', desc: 'Fai 100 scope in totale', icon: '✨', check: s => s.scope >= 100 },
    { id: 'sette10', name: 'Collezionista', desc: 'Prendi il settebello 10 volte', icon: '⭐', check: s => s.settebello >= 10 },
    { id: 'buona', name: 'Bussa!', desc: 'Dichiara una buona', icon: '✊', check: s => s.buone >= 1 },
    { id: 'decino', name: 'Decino', desc: 'Dichiara una buona da dieci', icon: '🔟', check: s => s.decini >= 1 },
    { id: 'piccola', name: 'Scala piccola', desc: 'Fai la piccola', icon: '🪜', check: s => s.piccola >= 1 },
    { id: 'grande', name: 'Scala grande', desc: 'Fai la grande', icon: '👑', check: s => s.grande >= 1 },
    { id: 'cappotto', name: 'Cappotto!', desc: 'Prendi tutti i denari in una smazzata', icon: '🧥', check: s => s.cappotti >= 1 },
    { id: 'clean', name: 'Muro', desc: 'Vinci 5 smazzate senza subire scope', icon: '🧱', check: s => s.cleanDeals >= 5 },
    { id: 'streak5', name: 'In serie', desc: 'Vinci 5 tappe di fila', icon: '🔥', check: s => s.bestStreak >= 5 },
    { id: 'zone1', name: 'Ponentino', desc: 'Completa la Riviera di Ponente', icon: '🌅', check: s => s.zonesDone.includes(0) },
    { id: 'zone3', name: 'Zeneise', desc: 'Completa Genova', icon: '⚓', check: s => s.zonesDone.includes(2) },
    { id: 'stars3x5', name: 'Tre stelle', desc: 'Prendi 3 stelle in 5 tappe', icon: '🌟', check: s => s.threeStars >= 5 },
    { id: 'all', name: 'Re della cirulla', desc: 'Completa tutte le tappe', icon: '🏆', check: s => s.stagesDone >= STAGES.length },
    { id: 'perfect', name: 'Giro perfetto', desc: '3 stelle su tutte le tappe', icon: '💎', check: s => s.threeStars >= STAGES.length },
  ];

  /* ---------- progresso salvato ---------- */
  const KEY = 'cpz-arcade';
  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return blank(); }
  }
  function blank() { return { stars: {}, unlocked: [], stats: { stagesDone: 0, scope: 0, settebello: 0, buone: 0, decini: 0, piccola: 0, grande: 0, cappotti: 0, cleanDeals: 0, streak: 0, bestStreak: 0, zonesDone: [], threeStars: 0, dealsWon: 0, dealsLost: 0 } }; }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function isUnlocked(p, id) { return id === 1 || (p.stars[id - 1] || 0) >= 1; }
  function totalStars(p) { return Object.values(p.stars).reduce((a, b) => a + b, 0); }

  /** aggiorna statistiche dopo una smazzata giocata in arcade; ritorna gli achievement appena sbloccati */
  function recordDeal(p, deal, my, mySeats) {
    const t = deal.teams[my], o = deal.teams[1 - my];
    const s = p.stats;
    s.scope += t.scope; s.settebello += t.settebello;
    deal.buone.forEach(b => { if (mySeats.includes(b.seat)) { s.buone++; if (b.type === 'decino') s.decini++; } });
    if (t.piccola) s.piccola++; if (t.grande) s.grande++;
    if (deal.cappotto === my) s.cappotti++;
    if (t.total > o.total) { s.dealsWon++; if (o.scope === 0) s.cleanDeals++; } else if (t.total < o.total) s.dealsLost++;
    return unlockAchievements(p);
  }
  function recordStage(p, stage, stars) {
    const s = p.stats;
    const prev = p.stars[stage.id] || 0;
    if (stars > prev) p.stars[stage.id] = stars;
    if (stars >= 1) {
      if (prev === 0) s.stagesDone++;
      s.streak++; if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    } else s.streak = 0;
    s.threeStars = Object.values(p.stars).filter(v => v === 3).length;
    ZONES.forEach((z, zi) => { if (!s.zonesDone.includes(zi) && STAGES.filter(st => st.zone === zi).every(st => (p.stars[st.id] || 0) >= 1)) s.zonesDone.push(zi); });
    return unlockAchievements(p);
  }
  function unlockAchievements(p) {
    const fresh = [];
    for (const a of ACHIEVEMENTS) if (!p.unlocked.includes(a.id) && a.check(p.stats)) { p.unlocked.push(a.id); fresh.push(a); }
    save(p);
    return fresh;
  }
  function goalText(g) { const G = GOALS[g[0]]; return typeof G.text === 'function' ? G.text(g[1]) : G.text; }
  function goalCheck(g, ctx) { return !!GOALS[g[0]].check(ctx, g[1]); }

  root.Arcade = { STAGES, ZONES, GOALS, ACHIEVEMENTS, BOT_NAMES, chooseMove, load, save, blank, isUnlocked, totalStars, recordDeal, recordStage, goalText, goalCheck, unlockAchievements };
})(typeof self !== 'undefined' ? self : this);
