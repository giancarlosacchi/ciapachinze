/* Ciapachinze — motore di gioco della Cirulla (puro, senza DOM)
 * Usato sia dal browser (window.Cirulla) sia da node (module.exports) per i test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cirulla = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['H', 'D', 'C', 'S'];            // ♥ ♦ ♣ ♠  (D = quadri = denari)
  const SUIT_SYMBOL = { H: '♥', D: '♦', C: '♣', S: '♠' };
  const SUIT_NAME = { H: 'cuori', D: 'quadri', C: 'fiori', S: 'picche' };
  const RANK_LABEL = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: 'J', 9: 'Q', 10: 'K' };
  const RANK_NAME = { 1: 'Asso', 2: 'Due', 3: 'Tre', 4: 'Quattro', 5: 'Cinque', 6: 'Sei', 7: 'Sette', 8: 'Fante', 9: 'Donna', 10: 'Re' };
  const PRIMIERA = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };
  const MATTA = 'H7';
  const SETTEBELLO = 'D7';

  const suitOf = id => id[0];
  const rankOf = id => parseInt(id.slice(1), 10);
  const cardName = id => `${RANK_NAME[rankOf(id)]} di ${SUIT_NAME[suitOf(id)]}`;

  function fullDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 1; r <= 10; r++) d.push(s + r);
    return d;
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Semplice PRNG seedabile (mulberry32) per test riproducibili
  function seededRng(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- combinatoria prese ---------- */

  // tutti i sottoinsiemi (come array di indici) con somma = target
  function subsetsWithSum(vals, target) {
    const out = [];
    const n = vals.length;
    (function rec(i, sum, chosen) {
      if (sum === target && chosen.length) out.push(chosen.slice());
      if (i >= n || sum >= target) return;
      for (let k = i; k < n; k++) {
        if (sum + vals[k] > target) continue;
        chosen.push(k);
        rec(k + 1, sum + vals[k], chosen);
        chosen.pop();
      }
    })(0, 0, []);
    return out;
  }

  function keyOf(idx) { return idx.slice().sort((a, b) => a - b).join(','); }

  /**
   * Opzioni di presa per una carta di valore `val` calata sul tavolo.
   * table: array di {id, val}. Ritorna array di {idx:[...], kind:'ace'|'simple'|'fifteen', scopa:bool}
   */
  function captureOptions(table, val) {
    const n = table.length;
    if (n === 0) return [];
    const vals = table.map(t => t.val);
    const seen = new Set();
    const out = [];
    const push = (idx, kind) => {
      const k = keyOf(idx);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ idx: idx.slice().sort((a, b) => a - b), kind, scopa: idx.length === n });
    };

    if (val === 1) {
      const aces = [];
      vals.forEach((v, i) => { if (v === 1) aces.push(i); });
      if (aces.length === 0) {
        push(vals.map((_, i) => i), 'ace');
        return out;
      }
      aces.forEach(i => push([i], 'simple'));
      subsetsWithSum(vals, 14).forEach(s => push(s, 'fifteen'));
      return out;
    }

    const singles = [];
    vals.forEach((v, i) => { if (v === val) singles.push(i); });
    if (singles.length) singles.forEach(i => push([i], 'simple'));
    else subsetsWithSum(vals, val).forEach(s => push(s, 'simple'));
    if (15 - val >= 1) subsetsWithSum(vals, 15 - val).forEach(s => push(s, 'fifteen'));
    return out;
  }

  /* ---------- buone in mano ---------- */

  /**
   * hand: array di id. Ritorna lista di {type:'barsega'|'decino'|'grande', points, mattaAs:null|number, label}
   */
  function buonaOptions(hand, cfg) {
    cfg = cfg || {};
    if (hand.length !== 3) return [];
    const hasMatta = hand.includes(MATTA);
    const others = hand.filter(c => c !== MATTA).map(rankOf);
    const out = [];

    // decino
    if (!hasMatta) {
      if (others[0] === others[1] && others[1] === others[2]) out.push({ type: 'decino', points: 10, mattaAs: null });
    } else if (others[0] === others[1]) {
      out.push({ type: 'decino', points: 10, mattaAs: others[0] });
    }
    // barsega (solo se non è già un decino: tris di A/2/3 vale solo decino)
    if (!out.length) {
      if (!hasMatta) {
        const s = others.reduce((a, b) => a + b, 0);
        if (s <= 9) out.push({ type: 'barsega', points: 3, mattaAs: null, poveri: !hand.some(c => rankOf(c) === 1) });
      } else {
        const s = others.reduce((a, b) => a + b, 0);
        for (let v = 1; v <= 9 - s; v++) out.push({ type: 'barsega', points: 3, mattaAs: v });
      }
    } else if (hasMatta && others[0] <= 3) {
      // matta usata per decino di A/2/3: solo decino, nessuna aggiunta
    }
    // grande in mano (variante)
    if (cfg.grandeInMano) {
      const ranks = hand.map(rankOf), suits = hand.map(suitOf);
      if (suits.every(s => s === 'D') && [8, 9, 10].every(r => ranks.includes(r))) out.push({ type: 'grande', points: 30, mattaAs: null });
    }
    return out.map(o => Object.assign({ label: buonaLabel(o) }, o));
  }

  function buonaLabel(o) {
    if (o.type === 'decino') return 'Buona da dieci (decino)' + (o.mattaAs ? ` — Matta come ${RANK_LABEL[o.mattaAs]}` : '');
    if (o.type === 'barsega') return (o.poveri ? 'Buona dei poveri' : 'Buona da tre (bàrsega)') + (o.mattaAs ? ` — Matta come ${RANK_LABEL[o.mattaAs]}` : '');
    if (o.type === 'grande') return 'Grande in mano!';
    return o.type;
  }

  /** Buona del mazziere sulle 4 carte iniziali: ritorna {points, mattaAs} o null */
  function dealerBuona(cards) {
    const hasMatta = cards.includes(MATTA);
    const others = cards.filter(c => c !== MATTA).map(rankOf);
    const s = others.reduce((a, b) => a + b, 0);
    if (!hasMatta) {
      if (s === 15) return { points: 1, mattaAs: null };
      if (s === 30) return { points: 2, mattaAs: null };
      return null;
    }
    // preferisci il 30 (2 scope) se raggiungibile
    if (30 - s >= 1 && 30 - s <= 10) return { points: 2, mattaAs: 30 - s };
    if (15 - s >= 1 && 15 - s <= 10) return { points: 1, mattaAs: 15 - s };
    return null;
  }

  /* ---------- punteggio ---------- */

  function primieraValue(cards) {
    const best = {};
    for (const c of cards) {
      const s = suitOf(c), v = PRIMIERA[rankOf(c)];
      if (!best[s] || v > best[s]) best[s] = v;
    }
    return Object.values(best).reduce((a, b) => a + b, 0);
  }

  function piccolaPoints(cards, maxRank) {
    const d = new Set(cards.filter(c => suitOf(c) === 'D').map(rankOf));
    if (!(d.has(1) && d.has(2) && d.has(3))) return 0;
    let pts = 3;
    for (let r = 4; r <= (maxRank || 6); r++) { if (d.has(r)) pts++; else break; }
    return pts;
  }

  function grandePoints(cards) {
    const d = new Set(cards.filter(c => suitOf(c) === 'D').map(rankOf));
    return (d.has(8) && d.has(9) && d.has(10)) ? 5 : 0;
  }

  /**
   * captured: [cardsTeam0, cardsTeam1]; scope: [n0, n1] (scope + buone)
   * ritorna {teams:[{...breakdown,total}], cappotto: teamIdx|null}
   */
  function scoreDeal(captured, scope, cfg) {
    cfg = cfg || {};
    const t = captured.map((cards, i) => ({
      carte: 0, denari: 0, settebello: 0, primiera: 0, scope: scope[i] || 0, grande: 0, piccola: 0,
      nCarte: cards.length,
      nDenari: cards.filter(c => suitOf(c) === 'D').length,
      primieraVal: primieraValue(cards),
      hasSettebello: cards.includes(SETTEBELLO),
    }));
    let cappotto = null;
    t.forEach((x, i) => {
      if (x.hasSettebello) x.settebello = 1;
      x.grande = grandePoints(captured[i]);
      x.piccola = piccolaPoints(captured[i], cfg.piccolaMax || 6);
      if (x.nDenari === 10) cappotto = i;
    });
    const award = (key, val) => {
      const a = t[0][val], b = t[1][val];
      if (a > b) t[0][key] = 1; else if (b > a) t[1][key] = 1;
    };
    award('carte', 'nCarte');
    award('denari', 'nDenari');
    award('primiera', 'primieraVal');
    t.forEach(x => { x.total = x.carte + x.denari + x.settebello + x.primiera + x.scope + x.grande + x.piccola; });
    return { teams: t, cappotto };
  }

  /* ---------- stato di gioco ---------- */

  function newGame(cfg, rng) {
    const players = cfg.players === 4 ? 4 : 2;
    return {
      cfg: {
        players,
        target: cfg.target || 51,
        grandeInMano: !!cfg.grandeInMano,
        piccolaMax: cfg.piccolaMax || 6,
      },
      rng: rng || Math.random,
      names: cfg.names || (players === 4 ? ['Nord', 'Est', 'Sud', 'Ovest'] : ['Giocatore 1', 'Giocatore 2']),
      teams: players === 4 ? [[0, 2], [1, 3]] : [[0], [1]],
      scores: [0, 0],
      history: [],           // punteggi per smazzata
      dealNo: 0,
      dealer: players === 4 ? 3 : 1,
      phase: 'lobby',
      deck: [], table: [], hands: [], faceUp: [], declared: [],
      captured: [[], []], scope: [0, 0], scopeCards: [[], []],
      buone: [], lastCapturer: null, lastCapture: null,
      turn: 0, round: 0, cardsPlayed: 0,
      pendingBuona: null,
      events: [], eventId: 0,
      winner: null,
    };
  }

  function teamOf(st, seat) { return st.teams.findIndex(t => t.includes(seat)); }

  function emit(st, ev) {
    ev.id = ++st.eventId;
    st.events.push(ev);
    if (st.events.length > 200) st.events.splice(0, st.events.length - 200);
    return ev;
  }

  function startDeal(st) {
    const n = st.cfg.players;
    st.dealNo++;
    st.dealer = (st.dealer + 1) % n;
    st.phase = 'play';
    st.captured = [[], []]; st.scope = [0, 0]; st.scopeCards = [[], []];
    st.buone = []; st.lastCapturer = null; st.lastCapture = null;
    st.round = 0; st.cardsPlayed = 0; st.pendingBuona = null;
    st.faceUp = new Array(n).fill(false);
    st.mattaVal = null;
    let attempts = 0;
    while (true) {
      attempts++;
      st.deck = shuffle(fullDeck(), st.rng);
      st.hands = []; for (let i = 0; i < n; i++) st.hands.push([]);
      // distribuzione una alla volta partendo dal giocatore dopo il mazziere
      for (let k = 0; k < 3; k++) for (let i = 1; i <= n; i++) st.hands[(st.dealer + i) % n].push(st.deck.pop());
      const tableCards = [st.deck.pop(), st.deck.pop(), st.deck.pop(), st.deck.pop()];
      const aces = tableCards.filter(c => rankOf(c) === 1).length;
      if (aces >= 2) {
        emit(st, { type: 'monte', dealer: st.dealer, cards: tableCards });
        if (attempts > 50) throw new Error('impossibile distribuire');
        continue;
      }
      st.table = tableCards.map(id => ({ id, val: rankOf(id) }));
      emit(st, { type: 'deal', dealNo: st.dealNo, dealer: st.dealer, round: 0, table: tableCards, hands: st.hands.map(h => h.length) });
      // buona del mazziere
      const db = dealerBuona(tableCards);
      if (db) {
        const dt = teamOf(st, st.dealer);
        st.captured[dt].push(...tableCards);
        st.scope[dt] += db.points;
        st.scopeCards[dt].push(...tableCards.slice(0, db.points));
        st.lastCapturer = st.dealer;
        st.lastCapture = { seat: st.dealer, cards: tableCards.slice(), played: null, scopa: true };
        emit(st, { type: 'dealer-buona', seat: st.dealer, points: db.points, cards: tableCards, mattaAs: db.mattaAs, sum: db.points === 2 ? 30 : 15 });
        st.table = [];
      }
      break;
    }
    st.turn = (st.dealer + 1) % n;
    st.declared = new Array(n).fill(false);
    checkBuonaAtTurn(st);
    return st;
  }

  function nextRound(st) {
    const n = st.cfg.players;
    st.round++;
    for (let k = 0; k < 3; k++) for (let i = 1; i <= n; i++) st.hands[(st.dealer + i) % n].push(st.deck.pop());
    st.declared = new Array(n).fill(false);
    st.faceUp = new Array(n).fill(false);
    emit(st, { type: 'deal', dealNo: st.dealNo, dealer: st.dealer, round: st.round, hands: st.hands.map(h => h.length) });
    st.turn = (st.dealer + 1) % n;
    checkBuonaAtTurn(st);
  }

  /** Al proprio turno con 3 carte in mano: controlla le buone. Se una sola → applica; se più → pending. */
  function checkBuonaAtTurn(st) {
    const seat = st.turn;
    if (st.declared[seat]) return;
    if (st.hands[seat].length !== 3) { st.declared[seat] = true; return; }
    const opts = buonaOptions(st.hands[seat], st.cfg);
    if (!opts.length) { st.declared[seat] = true; return; }
    if (opts.length === 1) { applyBuona(st, seat, opts[0]); return; }
    st.pendingBuona = { seat, options: opts };
  }

  function applyBuona(st, seat, opt) {
    const t = teamOf(st, seat);
    st.scope[t] += opt.points;
    st.declared[seat] = true;
    st.faceUp[seat] = true;
    st.pendingBuona = null;
    if (opt.mattaAs) st.mattaVal = opt.mattaAs;
    st.buone.push({ seat, type: opt.type, points: opt.points, mattaAs: opt.mattaAs, cards: st.hands[seat].slice() });
    emit(st, { type: 'buona', seat, kind: opt.type, points: opt.points, mattaAs: opt.mattaAs, cards: st.hands[seat].slice(), label: opt.label });
  }

  function declareBuona(st, seat, optionIndex) {
    if (!st.pendingBuona || st.pendingBuona.seat !== seat) return { ok: false, error: 'Nessuna buona da dichiarare' };
    const opt = st.pendingBuona.options[optionIndex];
    if (!opt) return { ok: false, error: 'Opzione non valida' };
    applyBuona(st, seat, opt);
    return { ok: true };
  }

  /** valore con cui una carta della mano viene calata (matta dichiarata) */
  function playValue(st, cardId) {
    if (cardId === MATTA && st.mattaVal) return st.mattaVal;
    return rankOf(cardId);
  }

  function optionsFor(st, seat, cardId) {
    return captureOptions(st.table, playValue(st, cardId));
  }

  /**
   * Gioca una carta. captureIdx: array di indici del tavolo scelti (o null se nessuna presa).
   */
  function play(st, seat, cardId, captureIdx) {
    if (st.phase !== 'play') return { ok: false, error: 'Non si sta giocando' };
    if (st.turn !== seat) return { ok: false, error: 'Non è il tuo turno' };
    if (st.pendingBuona) return { ok: false, error: 'Prima dichiara la buona' };
    const hand = st.hands[seat];
    if (!hand.includes(cardId)) return { ok: false, error: 'Carta non in mano' };
    const val = playValue(st, cardId);
    const opts = captureOptions(st.table, val);
    let chosen = null;
    if (opts.length) {
      if (!captureIdx || !captureIdx.length) {
        if (opts.length === 1) chosen = opts[0];
        else return { ok: false, error: 'Devi scegliere la presa', options: opts };
      } else {
        const k = keyOf(captureIdx);
        chosen = opts.find(o => keyOf(o.idx) === k) || null;
        if (!chosen) return { ok: false, error: 'Presa non valida', options: opts };
      }
    } else if (captureIdx && captureIdx.length) {
      return { ok: false, error: 'Nessuna presa possibile con questa carta' };
    }

    hand.splice(hand.indexOf(cardId), 1);
    st.cardsPlayed++;
    const totalCards = 40 - 4; // carte giocate dalle mani in una smazzata
    const isLastCard = st.cardsPlayed === totalCards;
    const t = teamOf(st, seat);
    let ev;
    if (chosen) {
      const takenIds = chosen.idx.map(i => st.table[i].id);
      st.table = st.table.filter((_, i) => !chosen.idx.includes(i));
      st.captured[t].push(...takenIds, cardId);
      if (cardId === MATTA) st.mattaVal = null;   // la matta presa/usata torna 7
      if (takenIds.includes(MATTA)) st.mattaVal = null;
      const scopa = chosen.scopa && !isLastCard;
      if (scopa) { st.scope[t]++; st.scopeCards[t].push(cardId); }
      st.lastCapturer = seat;
      st.lastCapture = { seat, cards: takenIds, played: cardId, scopa };
      ev = emit(st, { type: 'play', seat, card: cardId, val, captured: takenIds, kind: chosen.kind, scopa, lastCard: isLastCard });
    } else {
      st.table.push({ id: cardId, val });
      ev = emit(st, { type: 'play', seat, card: cardId, val, captured: [], scopa: false, lastCard: isLastCard });
    }

    // avanzamento
    const n = st.cfg.players;
    if (st.hands.every(h => h.length === 0)) {
      if (st.deck.length > 0) nextRound(st);
      else endDeal(st);
    } else {
      st.turn = (seat + 1) % n;
      checkBuonaAtTurn(st);
    }
    return { ok: true, event: ev };
  }

  function endDeal(st) {
    // carte rimaste in tavola all'ultimo che ha preso
    let leftover = [];
    if (st.table.length) {
      leftover = st.table.map(x => x.id);
      const lc = st.lastCapturer != null ? teamOf(st, st.lastCapturer) : teamOf(st, st.dealer);
      st.captured[lc].push(...leftover);
      st.table = [];
    }
    const res = scoreDeal(st.captured, st.scope, st.cfg);
    const before = st.scores.slice();
    st.scores[0] += res.teams[0].total;
    st.scores[1] += res.teams[1].total;
    st.history.push({ dealNo: st.dealNo, teams: res.teams, cappotto: res.cappotto, before, after: st.scores.slice(), buone: st.buone.slice(), captured: st.captured.map(c => c.slice()) });
    st.phase = 'dealEnd';
    st.lastDeal = st.history[st.history.length - 1];
    // vittoria
    const T = st.cfg.target;
    if (res.cappotto != null) st.winner = res.cappotto;
    else if (st.scores[0] >= T || st.scores[1] >= T) {
      if (st.scores[0] !== st.scores[1]) st.winner = st.scores[0] > st.scores[1] ? 0 : 1;
    }
    if (st.winner != null) st.phase = 'gameEnd';
    emit(st, { type: 'deal-end', leftover, lastCapturer: st.lastCapturer, result: res, scores: st.scores.slice(), winner: st.winner, cappotto: res.cappotto });
  }

  /** Vista "redatta" per un posto (nasconde le mani coperte degli altri) */
  function viewFor(st, seat) {
    const v = {
      cfg: st.cfg, names: st.names, teams: st.teams, scores: st.scores, history: st.history,
      dealNo: st.dealNo, dealer: st.dealer, phase: st.phase, round: st.round,
      deckCount: st.deck.length, table: st.table, faceUp: st.faceUp,
      hands: st.hands.map((h, i) => (i === seat || st.faceUp[i]) ? h.slice() : h.map(() => null)),
      handCounts: st.hands.map(h => h.length),
      captured: st.captured, scope: st.scope, scopeCards: st.scopeCards, buone: st.buone,
      lastCapturer: st.lastCapturer, lastCapture: st.lastCapture, turn: st.turn,
      pendingBuona: st.pendingBuona && st.pendingBuona.seat === seat ? st.pendingBuona : (st.pendingBuona ? { seat: st.pendingBuona.seat } : null),
      mattaVal: st.mattaVal, events: st.events, eventId: st.eventId, winner: st.winner, lastDeal: st.lastDeal,
      cardsPlayed: st.cardsPlayed,
    };
    return v;
  }

  return {
    SUITS, SUIT_SYMBOL, SUIT_NAME, RANK_LABEL, RANK_NAME, PRIMIERA, MATTA, SETTEBELLO,
    suitOf, rankOf, cardName, fullDeck, shuffle, seededRng,
    captureOptions, buonaOptions, dealerBuona, scoreDeal, primieraValue, piccolaPoints, grandePoints,
    newGame, startDeal, play, declareBuona, optionsFor, playValue, viewFor, teamOf,
  };
});
