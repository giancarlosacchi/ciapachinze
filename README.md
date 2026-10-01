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

## Server ponte (TURN) per giocare da reti diverse

Il gioco è peer-to-peer. Quando le due reti non si parlano direttamente (tipico fra due telefoni su rete mobile) serve un server
TURN. In `app.js` ci sono due posti dove configurarlo:

- `TURN_STATIC`: credenziali fisse, es. da un account gratuito [ExpressTURN](https://www.expressturn.com/) (1000 GB/mese):
  `{ urls: ['turn:relay1.expressturn.com:3478', 'turn:relay1.expressturn.com:3478?transport=tcp'], username: '…', credential: '…' }`
- `METERED`: `{ app: 'nome-app', key: 'chiave-api' }` da un account gratuito [Metered](https://www.metered.ca/) (500 MB/mese):
  l'app chiede le credenziali temporanee all'API di Metered a ogni apertura.

Senza nessuno dei due si usa solo STUN: funziona quando almeno uno dei due è su una rete "aperta" (molti Wi‑Fi di casa).
