const C = require('./engine.js');
let fails = 0, passes = 0;
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) passes++; else { fails++; console.log('FAIL', msg, '\n  got', ja, '\n  exp', jb); }
}
const T = ids => ids.map(id => ({ id, val: C.rankOf(id) }));
const keys = opts => opts.map(o => o.idx.join(',')).sort();

// --- prese semplici ---
eq(keys(C.captureOptions(T(['S7']), 7)), ['0'], '7 prende 7');
eq(keys(C.captureOptions(T(['S2', 'C5']), 7)), ['0,1'], '7 prende 2+5');
eq(keys(C.captureOptions(T(['S2', 'C5', 'D7']), 7)), ['0,1', '2'], '7: può prendere il 7 oppure 2+5');
eq(keys(C.captureOptions(T(['S2', 'C5', 'D7', 'H1']), 7)), ['0,1', '0,1,3', '2', '2,3'], '7: 2+5, 7, e prese da 15 (2+5+1, 7+1)');
eq(keys(C.captureOptions(T(['S3']), 7)), [], 'nessuna presa');
// --- presa da 15 ---
eq(keys(C.captureOptions(T(['S5']), 10)), ['0'], 'K + 5 = 15');
eq(keys(C.captureOptions(T(['S3', 'C4']), 8)), ['0,1'], 'J + 3 + 4 = 15');
eq(keys(C.captureOptions(T(['S8', 'C4', 'D3']), 8)), ['0', '1,2'], 'J: presa singola J oppure 15 con 4+3');
eq(keys(C.captureOptions(T(['S10', 'C10', 'D6', 'H4']), 10)), ['0', '1', '2,3'], 'K con K, K, 6, 4: scegli uno dei due Re o 6+4');
// --- asso ---
eq(C.captureOptions(T(['S8', 'C4', 'D3']), 1), [{ idx: [0, 1, 2], kind: 'ace', scopa: true }], 'asso piglia tutto');
eq(keys(C.captureOptions(T(['S8', 'C4', 'D1']), 1)), ['2'], 'asso con asso in tavola: solo l\'asso');
eq(keys(C.captureOptions(T(['S10', 'C4', 'D1']), 1)), ['0,1', '2'], 'asso: asso oppure 15 (K+4+A)');
eq(C.captureOptions([], 1), [], 'asso su tavola vuota resta');
// scopa flag
eq(C.captureOptions(T(['S5']), 10)[0].scopa, true, 'scopa flag');
eq(C.captureOptions(T(['S5', 'C2']), 10)[0].scopa, false, 'no scopa flag');

// --- buone ---
eq(C.buonaOptions(['S1', 'C2', 'D3']).map(o => o.type), ['barsega'], 'barsega 1+2+3');
eq(C.buonaOptions(['S2', 'C3', 'D4']).map(o => [o.type, o.poveri]), [['barsega', true]], 'buona dei poveri');
eq(C.buonaOptions(['S3', 'C3', 'D4']).length, 0, 'somma 10: niente');
eq(C.buonaOptions(['S5', 'C5', 'D5']).map(o => o.type), ['decino'], 'decino');
eq(C.buonaOptions(['S1', 'C1', 'D1']).map(o => o.type), ['decino'], 'tris di assi: solo decino');
eq(C.buonaOptions(['S5', 'C5', 'H7']).map(o => [o.type, o.mattaAs]), [['decino', 5]], 'decino con matta');
eq(C.buonaOptions(['S2', 'C3', 'H7']).map(o => [o.type, o.mattaAs]), [['barsega', 1], ['barsega', 2], ['barsega', 3], ['barsega', 4]], 'barsega con matta: valori 1..4');
eq(C.buonaOptions(['S9', 'C3', 'H7']).length, 0, 'matta non basta');
eq(C.buonaOptions(['D8', 'D9', 'D10'], { grandeInMano: true }).map(o => o.type), ['grande'], 'grande in mano');
// --- buona mazziere ---
eq(C.dealerBuona(['S5', 'C5', 'D3', 'H2']), { points: 1, mattaAs: null }, '15 al mazziere');
eq(C.dealerBuona(['S10', 'C10', 'D9', 'H1']), { points: 2, mattaAs: null }, '30 al mazziere');
eq(C.dealerBuona(['S10', 'C10', 'D9', 'H7']), { points: 2, mattaAs: 1 }, '30 con matta come asso');
eq(C.dealerBuona(['S5', 'C5', 'D3', 'H7']), { points: 1, mattaAs: 2 }, '15 con matta');
eq(C.dealerBuona(['S5', 'C5', 'D9', 'H3']), null, 'nessuna buona mazziere');

// --- punteggio ---
{
  const all = C.fullDeck();
  const d = all.filter(c => C.suitOf(c) === 'D');
  const rest = all.filter(c => C.suitOf(c) !== 'D');
  const r = C.scoreDeal([d.concat(rest.slice(0, 15)), rest.slice(15)], [2, 1]);
  eq(r.cappotto, 0, 'cappotto');
  eq([r.teams[0].carte, r.teams[0].denari, r.teams[0].settebello, r.teams[0].grande, r.teams[0].piccola], [1, 1, 1, 5, 6], 'carte/denari/7bello/grande/piccola');
  eq(r.teams[0].total, 1 + 1 + 1 + r.teams[0].primiera + 2 + 5 + 6, 'totale');
}
eq(C.piccolaPoints(['D1', 'D2', 'D3', 'D5', 'D6']), 3, 'piccola rotta al 4');
eq(C.piccolaPoints(['D1', 'D2', 'D3', 'D4', 'D5']), 5, 'piccola fino al 5');
eq(C.piccolaPoints(['D1', 'D2']), 0, 'piccola assente');
eq(C.primieraValue(['S7', 'H7', 'D7', 'C7']), 84, 'primiera max');
eq(C.primieraValue(['S7', 'S6', 'H1']), 37, 'primiera 2 semi');
{
  const r = C.scoreDeal([['S7', 'H7', 'D7', 'C7'], ['S6', 'H6', 'D6', 'C6']], [0, 0]);
  eq([r.teams[0].primiera, r.teams[1].primiera, r.teams[0].carte, r.teams[1].carte], [1, 0, 0, 0], 'primiera vinta, carte pari');
}

// --- simulazione partite complete (2 e 4 giocatori) con politica casuale ---
function simulate(players, seed) {
  const st = C.newGame({ players, target: 51 }, C.seededRng(seed));
  let deals = 0;
  while (st.phase !== 'gameEnd' && deals < 60) {
    C.startDeal(st); deals++;
    let guard = 0;
    while (st.phase === 'play' && guard++ < 500) {
      if (st.pendingBuona) { const r = C.declareBuona(st, st.pendingBuona.seat, 0); if (!r.ok) throw new Error(r.error); continue; }
      const seat = st.turn, hand = st.hands[seat];
      const card = hand[Math.floor(st.rng() * hand.length)];
      const opts = C.optionsFor(st, seat, card);
      const choice = opts.length ? opts[Math.floor(st.rng() * opts.length)].idx : null;
      const r = C.play(st, seat, card, choice);
      if (!r.ok) throw new Error(r.error + ' ' + JSON.stringify({ seat, card, choice, table: st.table }));
    }
    if (st.phase === 'play') throw new Error('smazzata non terminata');
    // invarianti a fine smazzata
    const total = st.captured[0].length + st.captured[1].length;
    if (total !== 40) throw new Error('carte totali ' + total);
    const uniq = new Set(st.captured[0].concat(st.captured[1]));
    if (uniq.size !== 40) throw new Error('carte duplicate');
  }
  return { deals, scores: st.scores, winner: st.winner, events: st.events.length };
}
for (let s = 1; s <= 30; s++) { const r = simulate(2, s); if (r.winner == null) { fails++; console.log('FAIL 2p seed', s, r); } else passes++; }
for (let s = 1; s <= 30; s++) { const r = simulate(4, s); if (r.winner == null) { fails++; console.log('FAIL 4p seed', s, r); } else passes++; }
console.log(JSON.stringify(simulate(2, 7)), JSON.stringify(simulate(4, 7)));

// --- ultima carta non fa scopa ---
{
  const st = C.newGame({ players: 2 }, C.seededRng(3));
  C.startDeal(st);
  let lastEv = null;
  while (st.phase === 'play') {
    if (st.pendingBuona) { C.declareBuona(st, st.pendingBuona.seat, 0); continue; }
    const seat = st.turn, hand = st.hands[seat], card = hand[0];
    const opts = C.optionsFor(st, seat, card);
    const r = C.play(st, seat, card, opts.length ? opts[0].idx : null);
    lastEv = r.event;
  }
  eq(lastEv.lastCard, true, 'ultima carta segnalata');
  eq(lastEv.scopa, false, 'ultima carta mai scopa');
}

// --- matta dichiarata come asso e giocata ---
{
  const st = C.newGame({ players: 2 }, C.seededRng(1));
  C.startDeal(st);
  st.hands[st.turn] = ['S1', 'C1', 'H7'];
  st.table = T(['S5', 'C9', 'D3']);
  st.declared[st.turn] = false; st.pendingBuona = null;
  // ricontrolla buone
  const opts = C.buonaOptions(st.hands[st.turn]);
  eq(opts.map(o => [o.type, o.mattaAs]), [['decino', 1]], 'decino con matta come asso');
  const r = C.declareBuona(Object.assign(st, { pendingBuona: { seat: st.turn, options: opts } }), st.turn, 0);
  eq(r.ok, true, 'dichiarata');
  eq(st.mattaVal, 1, 'matta vale 1');
  const o = C.optionsFor(st, st.turn, 'H7');
  eq(o, [{ idx: [0, 1, 2], kind: 'ace', scopa: true }], 'la matta-asso piglia tutto');
  const p = C.play(st, st.turn, 'H7', null);
  eq(p.ok && p.event.scopa, true, 'scopa con matta-asso');
  eq(st.mattaVal, null, 'matta torna 7 dopo la presa');
}

console.log(`\n${passes} test ok, ${fails} falliti`);
process.exit(fails ? 1 : 0);
