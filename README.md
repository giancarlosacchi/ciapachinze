# Ciapachinze

**La cirulla genovese, online, con la voce degli amici al tavolo.**

Gioca a Cirulla in 2 (uno contro uno) o in 4 a coppie, dal telefono o dal computer, invitando gli amici con un codice o un link. Niente account, niente server: le partite e la voce viaggiano direttamente tra i browser (WebRTC).

## Come si usa

1. Apri il sito, scrivi il tuo nome e **Apri il tavolo** (scegli 2 o 4 giocatori e il punteggio: 51, 71 o 101).
2. Manda agli amici il **link d'invito** (o il codice di 6 lettere).
3. Quando tutti sono seduti, **Inizia la partita**.
4. Al tuo turno tocca una carta: il tavolo ti mostra cosa puoi prendere. Se ci sono più prese possibili, scegli quella che vuoi.

### Voce

- **📞 Chiamata**: microfono sempre aperto, vi sentite tutti.
- **🎙 Walkie-talkie**: tieni premuto il pulsante (o la barra spaziatrice) per parlare; quando lasci, il microfono si chiude.
- **🎤/🔇**: silenzia il tuo microfono.

La voce funziona tra tutti i giocatori seduti al tavolo (fino a 4).

### Allenamento

Dalla home puoi **allenarti contro il computer** (2 o 4 giocatori) per imparare le regole.

## Regole

Le regole implementate sono in [REGOLE.md](REGOLE.md) e nel pulsante **?** dentro l'app: prese semplici, da 15 e d'asso, scopa, buone (bàrsega e decino) con la Matta, buona del mazziere, settebello, primiera, denari, grande, piccola e cappotto.

## Struttura

- `index.html`, `style.css`, `app.js` — interfaccia, animazioni, rete P2P (PeerJS) e voce.
- `engine.js` — motore di gioco puro (regole, prese, punteggi), senza DOM.
- `test.js` — test del motore: `node test.js`.

Il sito è statico e si pubblica su GitHub Pages così com'è. L'unica dipendenza esterna è PeerJS (caricata da CDN) per lo scambio dei dati e della voce tra i browser.
