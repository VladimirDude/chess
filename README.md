# Chess

A full-rules chess site. Play on one device, or send a room invite and play peer-to-peer. After a game, Stockfish can analyze the position in your browser.

Nothing is uploaded to GitHub unless you do that yourself.

## Play on your computer

From this folder:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

- **Play on this device** — two people take turns on one board.
- **Create room link** — copies an invite. You are White. Your opponent opens that URL and is Black.
- After checkmate, resign, draw, or timeout, **Stockfish** loads and shows an eval bar plus a suggested line. Click a move in the list to jump there and re-analyze.

## Put it on GitHub Pages (you do this)

GitHub only hosts the files. It does not run a game server.

1. On [github.com/new](https://github.com/new), create a **public** repository (for example `chess`). Do not add a README if you are uploading this folder as-is.
2. Upload **every file in this folder**, including `index.html` at the **root** of the repo (not inside a nested `Chess` directory). Also include `.nojekyll`.
3. Open the repo → **Settings** → **Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Branch: `main` (or `master`). Folder: `/ (root)`. Save.
6. Wait one or two minutes, then open the URL GitHub shows:
   - `https://YOUR_USERNAME.github.io/REPO_NAME/`
7. Test the site on that URL, then **Create room link** and send *that* GitHub URL to your opponent — not `localhost`.

If the board is blank, the usual cause is `index.html` sitting in a subfolder. It must be at the repo root.

If you prefer the command line from this folder:

```bash
git init
git add .
git commit -m "Chess site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git push -u origin main
```

Then do steps 3–6 above.

## Online play

Works best when both people are on ordinary home Wi‑Fi. Distance (including Mexico) is fine. Cellular data and some ISP CGNAT setups may fail because there is no paid relay.

## Analysis

Post-game analysis uses [Stockfish](https://stockfishchess.org/) in your browser (Stockfish.js 10 from a public CDN). GitHub Pages cannot send the special headers a multi-thread WASM engine needs, so this build is single-thread. It is still far stronger than a human. The engine is GPL-3.0; it is loaded only after a game ends.
