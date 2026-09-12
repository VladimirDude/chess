# Chess

A full-rules chess site. Play on one device, or send a room invite and play peer-to-peer. After a game, Stockfish can analyze the position in your browser.

## Play on your computer

- **Play on this device** — two people take turns on one board.
- **Create room link** — copies an invite. You are White. Your opponent opens that URL and is Black.
- After checkmate, resign, draw, or timeout, **Stockfish** loads and shows an eval bar plus a suggested line. Click a move in the list to jump there and re-analyze.

## Online play

Works best when both people are on ordinary home Wi‑Fi. Distance is fine. Cellular data and some ISP CGNAT setups may fail because there is no paid relay.

## Analysis

Post-game analysis uses [Stockfish](https://stockfishchess.org/) in your browser (Stockfish.js 10 from a public CDN). GitHub Pages cannot send the special headers a multi-thread WASM engine needs, so this build is single-thread. It is still far stronger than a human. The engine is GPL-3.0; it is loaded only after a game ends.
