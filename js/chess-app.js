import { Chess } from "./vendor/chess.js";
import { connectRoom, randomRoomId } from "./net.js";
import { classifyMove, material, whiteCpFromInfo } from "./review.js";

const FILES = "abcdefgh";

const els = {
  menu: document.getElementById("menu"),
  game: document.getElementById("game"),
  board: document.getElementById("board"),
  promo: document.getElementById("promo"),
  status: document.getElementById("status"),
  moves: document.getElementById("moves"),
  connection: document.getElementById("connection"),
  copyLink: document.getElementById("copy-link"),
  topClock: document.getElementById("top-clock"),
  bottomClock: document.getElementById("bottom-clock"),
  topWho: document.getElementById("top-who"),
  bottomWho: document.getElementById("bottom-who"),
  topCaptured: document.getElementById("top-captured"),
  bottomCaptured: document.getElementById("bottom-captured"),
  offerBanner: document.getElementById("offer-banner"),
  toast: document.getElementById("toast"),
  timeControl: document.getElementById("time-control"),
  playerName: document.getElementById("player-name"),
  boardTheme: document.getElementById("board-theme"),
  rematch: document.getElementById("rematch"),
  joinCode: document.getElementById("join-code"),
  files: document.getElementById("files"),
  ranks: document.getElementById("ranks"),
  topAvatar: document.getElementById("top-avatar"),
  bottomAvatar: document.getElementById("bottom-avatar"),
  evalTrack: document.getElementById("eval-track"),
  evalFill: document.getElementById("eval-fill"),
  analysis: document.getElementById("analysis"),
  analysisStatus: document.getElementById("analysis-status"),
  analysisLine: document.getElementById("analysis-line"),
  boardFrame: document.getElementById("board-frame"),
  endModal: document.getElementById("end-modal"),
  endKicker: document.getElementById("end-kicker"),
  endTitle: document.getElementById("end-title"),
  endDetail: document.getElementById("end-detail"),
  roomModal: document.getElementById("room-modal"),
  roomTime: document.getElementById("room-time"),
  roomInc: document.getElementById("room-inc"),
  roomSide: document.getElementById("room-side"),
  waitCard: document.getElementById("wait-card"),
  waitText: document.getElementById("wait-text"),
  waitCopy: document.getElementById("wait-copy"),
};

const state = {
  chess: new Chess(),
  mode: "menu",
  color: "w",
  orientation: "w",
  selected: null,
  legal: [],
  lastMove: null,
  pendingPromo: null,
  timeLimitMs: 10 * 60 * 1000,
  incrementMs: 0,
  whiteMs: 10 * 60 * 1000,
  blackMs: 10 * 60 * 1000,
  clockSide: null,
  clockAt: null,
  over: false,
  endClosed: false,
  roomId: null,
  isHost: false,
  hostColor: "w",
  net: null,
  peerId: null,
  seq: 0,
  drawFrom: null,
  newGameFrom: null,
  tape: [],
  reviewPly: null,
  engine: null,
  engineStarted: false,
  reviewMode: false,
  reviewReport: null,
  positionEvals: null,
  reviewRunning: false,
  gradeToken: 0,
  playerName: "",
  opponentName: "",
};

const NAME_COOKIE = "chess_player_name";
const THEME_COOKIE = "chess_board_theme";
const NAME_MAX = 20;
const THEMES = ["classic", "forest", "ocean", "slate", "sand"];

let ghost = null;

function readCookie(key) {
  const parts = document.cookie.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (!part.startsWith(`${key}=`)) continue;
    try {
      return decodeURIComponent(part.slice(key.length + 1));
    } catch {
      return part.slice(key.length + 1);
    }
  }
  return "";
}

function writeCookie(key, value, days = 400) {
  const maxAge = Math.floor(days * 24 * 60 * 60);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function clearCookie(key) {
  document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function sanitizeName(raw) {
  return String(raw || "")
    .replace(/[^\p{L}\p{N} _.'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

function savePlayerName(raw) {
  const clean = sanitizeName(raw);
  state.playerName = clean;
  if (clean) writeCookie(NAME_COOKIE, clean);
  else clearCookie(NAME_COOKIE);
  if (els.playerName && els.playerName.value !== clean) els.playerName.value = clean;
  return clean;
}

function loadPlayerName() {
  const saved = sanitizeName(readCookie(NAME_COOKIE));
  state.playerName = saved;
  if (els.playerName) els.playerName.value = saved;
  return saved;
}

function applyBoardTheme(theme) {
  const id = THEMES.includes(theme) ? theme : "classic";
  document.documentElement.dataset.board = id;
  if (els.boardTheme) {
    for (const btn of els.boardTheme.querySelectorAll("[data-theme]")) {
      btn.classList.toggle("selected", btn.dataset.theme === id);
    }
  }
  return id;
}

function saveBoardTheme(theme) {
  const id = applyBoardTheme(theme);
  writeCookie(THEME_COOKIE, id);
  return id;
}

function loadBoardTheme() {
  return applyBoardTheme(readCookie(THEME_COOKIE) || "classic");
}

function requestRematch() {
  if (state.mode === "local") {
    startLocal();
    return;
  }
  if (state.mode !== "online" || !state.net) return;
  if (waitingForPeer()) {
    toast("Waiting for opponent");
    return;
  }
  state.net.send({ type: "new-game-offer", seq: ++state.seq });
  toast("Rematch offered");
}

function pieceSvg(type, color, cls = "piece") {
  const shade = color === "w" ? "lt" : "dt";
  return `<img class="${cls}" src="./js/pieces/${type}${shade}.svg" alt="" draggable="false" />`;
}

function sqName(file, rank) {
  return FILES[file] + (rank + 1);
}

function indexToSquare(i, orientation) {
  const file = i % 8;
  const rank = 7 - Math.floor(i / 8);
  if (orientation === "w") return sqName(file, rank);
  return sqName(7 - file, 7 - rank);
}

function describeEnd(text) {
  if (!text || text === true) return null;
  if (text.includes("checkmate")) {
    const winner = text.startsWith("White") ? "White" : "Black";
    return { kicker: "Game over", title: "Checkmate", detail: `${winner} wins` };
  }
  if (text.includes("resigned")) {
    const loser = text.startsWith("White") ? "White" : "Black";
    const winner = loser === "White" ? "Black" : "White";
    return { kicker: "Game over", title: "Resignation", detail: `${loser} resigned · ${winner} wins` };
  }
  if (text.includes("on time")) {
    return { kicker: "Game over", title: "Time", detail: text };
  }
  if (/draw/i.test(text)) {
    let detail = "The game is drawn";
    if (/stalemate/i.test(text)) detail = "Stalemate";
    else if (/repetition/i.test(text)) detail = "Threefold repetition";
    else if (/insufficient/i.test(text)) detail = "Insufficient material";
    else if (/50-move/i.test(text)) detail = "50-move rule";
    else if (/agreement/i.test(text)) detail = "By agreement";
    return { kicker: "Game over", title: "Draw", detail };
  }
  return { kicker: "Game over", title: "Game over", detail: String(text) };
}

function showEndModal() {
  const info = describeEnd(state.over === true ? gameStatus() : state.over);
  if (!info || state.endClosed) {
    els.endModal.classList.add("hidden");
    return;
  }
  els.endKicker.textContent = info.kicker;
  els.endTitle.textContent = info.title;
  els.endDetail.textContent = info.detail;
  els.endModal.classList.remove("hidden");
}

function hideEndModal(closed = true) {
  state.endClosed = closed;
  els.endModal.classList.add("hidden");
}

function waitingForPeer() {
  return state.mode === "online" && !state.peerId && !state.over;
}

function syncWaitCard() {
  if (!els.waitCard) return;
  const wait = waitingForPeer();
  els.waitCard.classList.toggle("hidden", !wait);
  if (!wait) return;
  els.waitText.textContent = state.isHost ? "Waiting for opponent…" : "Connecting…";
  els.waitCopy.classList.toggle("hidden", !state.isHost);
}

function oppositeColor(color) {
  return color === "w" ? "b" : "w";
}

function addIncrement(mover) {
  if (!state.incrementMs || state.over) return;
  if (mover === "w") state.whiteMs += state.incrementMs;
  else state.blackMs += state.incrementMs;
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.add("hidden"), 2200);
}

function formatTime(ms) {
  if (!state.timeLimitMs) return "∞";
  const n = Math.max(0, Math.ceil(ms / 100));
  const tenths = n % 10;
  const totalSec = Math.floor(n / 10);
  const m = Math.floor(totalSec / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  if (totalSec < 10) return `${m}:${s}.${tenths}`;
  return `${m}:${s}`;
}

function remaining(color) {
  let ms = color === "w" ? state.whiteMs : state.blackMs;
  if (state.clockSide === color && state.clockAt && !state.over) {
    ms -= Date.now() - state.clockAt;
  }
  return ms;
}

function stopClock() {
  if (!state.clockSide || !state.clockAt) {
    state.clockSide = null;
    state.clockAt = null;
    return;
  }
  const elapsed = Date.now() - state.clockAt;
  if (state.clockSide === "w") state.whiteMs -= elapsed;
  else state.blackMs -= elapsed;
  state.clockSide = null;
  state.clockAt = null;
}

function startClock(color) {
  if (!state.timeLimitMs || state.over || waitingForPeer()) return;
  state.clockSide = color;
  state.clockAt = Date.now();
}

function playTap() {
  try {
    const ctx = playTap.ctx || (playTap.ctx = new AudioContext());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch {
    /* ignore */
  }
}

function countOnBoard(color, type) {
  return state.chess.board().flat().filter((p) => p && p.color === color && p.type === type).length;
}

function gameStatus() {
  if (state.over && state.over !== true) return state.over;
  if (state.chess.isCheckmate()) {
    const winner = state.chess.turn() === "w" ? "Black" : "White";
    return `${winner} wins by checkmate`;
  }
  if (state.chess.isStalemate()) return "Draw by stalemate";
  if (state.chess.isThreefoldRepetition()) return "Draw by repetition";
  if (state.chess.isInsufficientMaterial()) return "Draw — insufficient material";
  if (state.chess.isDrawByFiftyMoves()) return "Draw by 50-move rule";
  if (state.chess.isDraw()) return "Draw";
  const side = state.chess.turn() === "w" ? "White" : "Black";
  return state.chess.isCheck() ? `${side} is in check` : `${side} to move`;
}

function updateClocks() {
  if (state.over) return;
  if (state.timeLimitMs && remaining("w") <= 0) {
    flag("w");
    return;
  }
  if (state.timeLimitMs && remaining("b") <= 0) {
    flag("b");
    return;
  }
  const bottomIsWhite = state.orientation === "w";
  const whiteEl = bottomIsWhite ? els.bottomClock : els.topClock;
  const blackEl = bottomIsWhite ? els.topClock : els.bottomClock;
  whiteEl.textContent = formatTime(remaining("w"));
  blackEl.textContent = formatTime(remaining("b"));
  whiteEl.classList.toggle("active", state.clockSide === "w");
  blackEl.classList.toggle("active", state.clockSide === "b");
}

function flag(color) {
  stopClock();
  state.over = `${color === "w" ? "Black" : "White"} wins on time`;
  state.endClosed = false;
  render();
}

function renderMoves() {
  const hist = state.tape.length ? state.tape.map((m) => m.san) : state.chess.history();
  const active = state.reviewPly == null ? hist.length : state.reviewPly;
  const rows = [];
  for (let i = 0; i < hist.length; i += 2) {
    const cell = (idx) => {
      if (!hist[idx]) return "";
      const tag = state.reviewReport?.[idx]?.tag;
      const badge = tag ? `<span class="move-tag ${tag}">${tag}</span>` : "";
      return `<span class="ply${active === idx + 1 ? " active" : ""}${tag ? " has-tag" : ""}" data-ply="${idx + 1}">${hist[idx]}${badge}</span>`;
    };
    rows.push(`<li><span class="n">${i / 2 + 1}</span>${cell(i)}${cell(i + 1)}</li>`);
  }
  els.moves.innerHTML = rows.join("");
  if (!state.reviewMode) els.moves.scrollTop = els.moves.scrollHeight;
}

function renderCoords() {
  const files = state.orientation === "w" ? "abcdefgh" : "hgfedcba";
  const ranks = state.orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  els.files.innerHTML = [...files].map((f) => `<span>${f}</span>`).join("");
  els.ranks.innerHTML = ranks.map((r) => `<span>${r}</span>`).join("");
}

function materialOnBoard(color) {
  const vals = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let total = 0;
  for (const row of state.chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) total += vals[piece.type] || 0;
    }
  }
  return total;
}

function capturedHtml(victimColor, advantage) {
  const start = { q: 1, r: 2, b: 2, n: 2, p: 8 };
  const pieces = ["q", "r", "b", "n", "p"]
    .flatMap((t) => Array.from({ length: Math.max(0, start[t] - countOnBoard(victimColor, t)) }, () => pieceSvg(t, victimColor, "cap-piece")))
    .join("");
  const score = advantage > 0 ? `<span class="cap-score">+${advantage}</span>` : "";
  if (!pieces && !score) return "";
  return `<span class="cap-row">${pieces}${score}</span>`;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function castlingRookMove(move) {
  const flags = move.flags || "";
  if (flags.includes("k")) {
    return move.color === "w"
      ? { from: "h1", to: "f1" }
      : { from: "h8", to: "f8" };
  }
  if (flags.includes("q")) {
    return move.color === "w"
      ? { from: "a1", to: "d1" }
      : { from: "a8", to: "d8" };
  }
  return null;
}

function animatePieceSlide(from, to) {
  const fromEl = els.board.querySelector(`[data-square="${from}"]`);
  const toEl = els.board.querySelector(`[data-square="${to}"]`);
  const piece = toEl?.querySelector(".piece");
  if (!fromEl || !toEl || !piece) return;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  piece.classList.add("sliding");
  piece.style.transition = "none";
  piece.style.transform = `translate(${dx}px, ${dy}px)`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      piece.style.transition = "transform 0.2s cubic-bezier(0.22, 0.9, 0.25, 1)";
      piece.style.transform = "translate(0, 0)";
    });
  });
  const clear = () => {
    piece.style.transition = "";
    piece.style.transform = "";
    piece.classList.remove("sliding");
  };
  piece.addEventListener("transitionend", clear, { once: true });
  setTimeout(clear, 280);
}

function animateLastMove(move) {
  if (!move || prefersReducedMotion()) return;
  animatePieceSlide(move.from, move.to);
  const rook = castlingRookMove(move);
  if (rook) animatePieceSlide(rook.from, rook.to);
}

function renderBoard() {
  const board = state.chess.board();
  const checks = kingSquare();
  els.board.innerHTML = "";
  for (let i = 0; i < 64; i++) {
    const square = indexToSquare(i, state.orientation);
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const light = (file + rank) % 2 === 1;
    const piece = board[7 - rank][file];
    const sq = document.createElement("div");
    sq.className = `sq ${light ? "light" : "dark"}`;
    sq.dataset.square = square;
    sq.setAttribute("role", "gridcell");
    sq.setAttribute("aria-label", piece ? `${piece.color === "w" ? "white" : "black"} ${piece.type} ${square}` : square);
    if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) sq.classList.add("last");
    if (state.selected === square) sq.classList.add("selected");
    if (checks && square === checks && state.chess.isCheck()) sq.classList.add("check");

    const legalHere = state.legal.find((m) => m.to === square);
    if (legalHere) {
      const mark = document.createElement("span");
      mark.className = piece || legalHere.flags?.includes("e") ? "ring" : "dot";
      sq.append(mark);
    }

    if (piece) sq.insertAdjacentHTML("beforeend", pieceSvg(piece.type, piece.color));
    els.board.append(sq);
  }
}

function kingSquare() {
  const turn = state.chess.turn();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = state.chess.board()[r][f];
      if (p && p.type === "k" && p.color === turn) return sqName(f, 7 - r);
    }
  }
  return null;
}

function renderMeta() {
  els.status.textContent = gameStatus();
  const bottomIsWhite = state.orientation === "w";
  els.bottomWho.textContent = bottomIsWhite ? labelFor("w") : labelFor("b");
  els.topWho.textContent = bottomIsWhite ? labelFor("b") : labelFor("w");
  els.bottomAvatar.className = `avatar ${bottomIsWhite ? "white" : "black"}`;
  els.topAvatar.className = `avatar ${bottomIsWhite ? "black" : "white"}`;
  const whiteAdv = materialOnBoard("w") - materialOnBoard("b");
  const blackAdv = -whiteAdv;
  // Under each name: pieces they captured (opponent's missing pieces) + their material lead
  els.bottomCaptured.innerHTML = bottomIsWhite
    ? capturedHtml("b", whiteAdv)
    : capturedHtml("w", blackAdv);
  els.topCaptured.innerHTML = bottomIsWhite
    ? capturedHtml("w", blackAdv)
    : capturedHtml("b", whiteAdv);
  renderCoords();
  renderMoves();
  updateClocks();
}

function labelFor(color) {
  const side = color === "w" ? "White" : "Black";
  if (state.mode === "online") {
    if (color === state.color) return state.playerName || side;
    return state.opponentName || side;
  }
  return side;
}

function render() {
  renderBoard();
  renderMeta();
  syncAnalysis();
  syncWaitCard();
  showEndModal();
}

function canControl(pieceColor) {
  if (state.over) return false;
  if (waitingForPeer()) return false;
  if (state.mode === "online") return pieceColor === state.color && state.chess.turn() === state.color;
  return pieceColor === state.chess.turn();
}

function selectSquare(square) {
  if (!square) {
    state.selected = null;
    state.legal = [];
    renderBoard();
    return;
  }
  const piece = pieceAt(square);
  if (piece && canControl(piece.color)) {
    state.selected = square;
    state.legal = state.chess.moves({ square, verbose: true });
  } else {
    state.selected = null;
    state.legal = [];
  }
  renderBoard();
}

function pieceAt(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return state.chess.board()[7 - rank][file];
}

function tryMove(from, to, promotion) {
  if (state.over || waitingForPeer()) return false;
  const legal = state.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!legal.length) return false;
  const needsPromo = legal.some((m) => m.promotion);
  if (needsPromo && !promotion) {
    state.pendingPromo = { from, to, color: legal[0].color };
    showPromo(legal[0].color);
    return false;
  }
  const move = state.chess.move({ from, to, promotion: promotion || undefined });
  if (!move) return false;
  hidePromo();
  state.selected = null;
  state.legal = [];
  state.lastMove = { from, to };
  playTap();
  stopClock();
  addIncrement(move.color);
  if (state.chess.isGameOver()) {
    state.over = gameStatus();
    state.endClosed = false;
  } else {
    startClock(state.chess.turn());
  }
  render();
  animateLastMove(move);
  return move;
}

function showPromo(color) {
  els.promo.classList.remove("hidden");
  els.promo.innerHTML = "";
  for (const type of ["q", "r", "b", "n"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = pieceSvg(type, color);
    btn.addEventListener("click", () => {
      const { from, to } = state.pendingPromo;
      const move = tryMove(from, to, type);
      if (move && state.mode === "online") sendMove(move);
    });
    els.promo.append(btn);
  }
}

function hidePromo() {
  state.pendingPromo = null;
  els.promo.classList.add("hidden");
  els.promo.innerHTML = "";
}

function sendMove(move) {
  if (!state.net) return;
  state.seq += 1;
  state.net.send({
    type: "move",
    seq: state.seq,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    fen: state.chess.fen(),
    whiteMs: remaining("w"),
    blackMs: remaining("b"),
  });
}

function applyRemoteMove(msg) {
  if (msg.fen && msg.fen.split(" ")[0] === state.chess.fen().split(" ")[0] && !msg.from) return;
  const already = state.chess.history({ verbose: true }).at(-1);
  if (already && already.from === msg.from && already.to === msg.to) return;
  const move = state.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || undefined });
  if (!move) return;
  state.lastMove = { from: msg.from, to: msg.to };
  playTap();
  stopClock();
  if (typeof msg.whiteMs === "number") state.whiteMs = msg.whiteMs;
  if (typeof msg.blackMs === "number") state.blackMs = msg.blackMs;
  if (state.chess.isGameOver()) {
    state.over = gameStatus();
    state.endClosed = false;
  } else startClock(state.chess.turn());
  render();
  animateLastMove(move);
}

function snapshot() {
  return {
    type: "hello",
    seq: ++state.seq,
    fen: state.chess.fen(),
    pgn: state.chess.pgn(),
    color: state.color,
    whiteMs: remaining("w"),
    blackMs: remaining("b"),
    timeLimitMs: state.timeLimitMs,
    lastMove: state.lastMove,
    over: state.over,
    incrementMs: state.incrementMs,
    hostColor: state.hostColor,
    name: state.playerName || "",
  };
}

function loadSnapshot(msg) {
  try {
    if (msg.pgn) state.chess.loadPgn(msg.pgn);
    else if (msg.fen) state.chess.load(msg.fen);
  } catch {
    if (msg.fen) state.chess.load(msg.fen);
  }
  if (typeof msg.whiteMs === "number") state.whiteMs = msg.whiteMs;
  if (typeof msg.blackMs === "number") state.blackMs = msg.blackMs;
  if (msg.timeLimitMs != null) state.timeLimitMs = msg.timeLimitMs;
  if (typeof msg.incrementMs === "number") state.incrementMs = msg.incrementMs;
  if (msg.hostColor === "w" || msg.hostColor === "b") state.hostColor = msg.hostColor;
  if (typeof msg.name === "string") {
    const theirs = sanitizeName(msg.name);
    if (theirs) state.opponentName = theirs;
  }
  state.lastMove = msg.lastMove || null;
  state.over = msg.over || (state.chess.isGameOver() ? gameStatus() : false);
  if (state.over) state.endClosed = false;
  if (!state.over && state.timeLimitMs && state.chess.history().length) startClock(state.chess.turn());
  render();
}

function showGame() {
  els.menu.classList.add("hidden");
  els.game.classList.remove("hidden");
}

function resetPosition(timeMin, incrementSec = 0) {
  state.chess.reset();
  state.selected = null;
  state.legal = [];
  state.lastMove = null;
  state.over = false;
  state.endClosed = false;
  state.drawFrom = null;
  state.newGameFrom = null;
  state.tape = [];
  state.reviewPly = null;
  state.engineStarted = false;
  state.reviewMode = false;
  state.reviewReport = null;
  state.positionEvals = null;
  state.reviewRunning = false;
  state.gradeToken += 1;
  stopEngine();
  hidePromo();
  els.endModal.classList.add("hidden");
  hideAnalysisUi();
  state.timeLimitMs = timeMin * 60 * 1000;
  state.incrementMs = Number(incrementSec) * 1000 || 0;
  state.whiteMs = state.timeLimitMs || 0;
  state.blackMs = state.timeLimitMs || 0;
  stopClock();
}

function startLocal() {
  disconnect();
  savePlayerName(els.playerName?.value);
  const timeMin = Number(els.timeControl.value);
  resetPosition(timeMin);
  state.mode = "local";
  state.color = "w";
  state.orientation = "w";
  els.copyLink.classList.add("hidden");
  setConnection("");
  showGame();
  if (state.timeLimitMs) startClock("w");
  render();
}

async function startOnline({ roomId, isHost, timeMin, incrementSec = 0, hostColor = "w" }) {
  disconnect();
  savePlayerName(els.playerName?.value);
  resetPosition(timeMin, incrementSec);
  state.mode = "online";
  state.roomId = roomId;
  state.isHost = isHost;
  state.hostColor = hostColor === "b" ? "b" : "w";
  state.color = isHost ? state.hostColor : oppositeColor(state.hostColor);
  state.orientation = state.color;
  state.peerId = null;
  state.opponentName = "";
  const url = new URL(location.href);
  url.search = `room=${roomId}&t=${timeMin}&i=${Number(incrementSec) || 0}&s=${state.hostColor}${isHost ? "&host=1" : ""}`;
  history.replaceState({}, "", url);
  showGame();
  els.copyLink.classList.remove("hidden");
  setConnection("wait", isHost ? "Waiting for opponent" : "Connecting…");
  render();

  const connectWatch = setTimeout(() => {
    if (!state.peerId) setConnection("bad", "Still searching on this network");
  }, 12000);

  state.net = await connectRoom(roomId, {
    onRelayReady() {
      if (!state.peerId) setConnection("wait", isHost ? "Waiting for opponent" : "Connecting…");
    },
    onRelayError() {
      if (!state.peerId) setConnection("bad", "Could not reach matchmaking relays");
    },
    onPeerJoin(peerId) {
      if (state.peerId && peerId !== state.peerId) return;
      clearTimeout(connectWatch);
      state.peerId = peerId;
      setConnection("live", "Opponent connected");
      state.net?.send(snapshot());
      if (!state.over && state.timeLimitMs && !state.clockSide && !state.chess.history().length) {
        startClock("w");
      }
      render();
    },
    onPeerLeave(peerId) {
      if (peerId !== state.peerId) return;
      state.peerId = null;
      stopClock();
      setConnection("bad", "Opponent left");
    },
    onMessage(msg) {
      handleNet(msg);
    },
  });
  if (state.peerId) state.net.send(snapshot());
}

function handleNet(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hello") {
    if (!state.peerId) {
      state.peerId = "peer";
      setConnection("live", "Opponent connected");
      if (!state.over && state.timeLimitMs && !state.clockSide && !state.chess.history().length) {
        startClock("w");
      }
    }
    if (typeof msg.name === "string") {
      const theirs = sanitizeName(msg.name);
      if (theirs) state.opponentName = theirs;
    }
    if (msg.color === state.color && !state.isHost) {
      state.color = oppositeColor(msg.color);
      state.orientation = state.color;
    }
    if ((msg.pgn && msg.pgn.length >= state.chess.pgn().length) || state.chess.history().length === 0) {
      loadSnapshot(msg);
    } else {
      render();
    }
    return;
  }
  if (msg.type === "move") {
    applyRemoteMove(msg);
    return;
  }
  if (msg.type === "resign") {
    stopClock();
    state.over = `${msg.color === "w" ? "White" : "Black"} resigned`;
    state.endClosed = false;
    render();
    return;
  }
  if (msg.type === "draw-offer") {
    state.drawFrom = "them";
    showOffer("Opponent offers a draw", () => {
      stopClock();
      state.over = "Draw by agreement";
      state.endClosed = false;
      state.net?.send({ type: "draw-accept", seq: ++state.seq });
      hideOffer();
      render();
    }, () => {
      state.net?.send({ type: "draw-decline", seq: ++state.seq });
      hideOffer();
    });
    return;
  }
  if (msg.type === "draw-accept") {
    stopClock();
    state.over = "Draw by agreement";
    state.endClosed = false;
    hideOffer();
    render();
    return;
  }
  if (msg.type === "draw-decline") {
    hideOffer();
    toast("Draw declined");
    return;
  }
  if (msg.type === "new-game-offer") {
    showOffer("Opponent wants a rematch", () => {
      const timeMin = state.timeLimitMs ? state.timeLimitMs / 60000 : 0;
      const incrementSec = state.incrementMs ? state.incrementMs / 1000 : 0;
      resetPosition(timeMin, incrementSec);
      state.net?.send({ type: "new-game-accept", seq: ++state.seq, ...snapshot() });
      hideOffer();
      if (state.timeLimitMs) startClock("w");
      render();
    }, () => {
      state.net?.send({ type: "new-game-decline", seq: ++state.seq });
      hideOffer();
    });
    return;
  }
  if (msg.type === "new-game-accept") {
    hideOffer();
    loadSnapshot(msg);
    if (!state.over && state.timeLimitMs) startClock("w");
    toast("Rematch");
    return;
  }
  if (msg.type === "new-game-decline") {
    hideOffer();
    toast("Rematch declined");
  }
}

function showOffer(text, onYes, onNo) {
  els.offerBanner.classList.remove("hidden");
  els.offerBanner.innerHTML = `<div>${text}</div>`;
  const yes = document.createElement("button");
  yes.className = "btn primary";
  yes.textContent = "Accept";
  yes.onclick = onYes;
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "Decline";
  no.onclick = onNo;
  els.offerBanner.append(yes, no);
}

function hideOffer() {
  state.drawFrom = null;
  els.offerBanner.classList.add("hidden");
  els.offerBanner.innerHTML = "";
}

function setConnection(kind, text) {
  if (!kind) {
    els.connection.className = "connection hidden";
    els.connection.textContent = "";
    return;
  }
  els.connection.className = `connection ${kind}`;
  els.connection.textContent = text;
}

function stopEngine() {
  try {
    state.engine?.destroy();
  } catch {
    /* ignore */
  }
  state.engine = null;
  state.engineStarted = false;
  hideAnalysisUi();
}

function hideAnalysisUi() {
  els.analysis?.classList.add("hidden");
  els.evalTrack?.classList.add("hidden");
  els.boardFrame?.classList.remove("with-eval");
  if (els.analysisStatus) els.analysisStatus.textContent = "";
  if (els.analysisLine) els.analysisLine.textContent = "";
  if (els.evalFill) els.evalFill.style.height = "50%";
}

function freezeTape() {
  if (!state.tape.length) state.tape = state.chess.history({ verbose: true });
}

function goToPly(n) {
  freezeTape();
  n = Math.max(0, Math.min(n, state.tape.length));
  state.chess.reset();
  for (let i = 0; i < n; i++) state.chess.move(state.tape[i]);
  const last = n ? state.tape[n - 1] : null;
  state.lastMove = last ? { from: last.from, to: last.to } : null;
  state.reviewPly = n;
  state.selected = null;
  state.legal = [];
  render();
  if (state.reviewMode && n > 0) gradePly(n);
  else syncAnalysis();
}

function pvToSan(fen, uciMoves) {
  const preview = new Chess(fen);
  const sans = [];
  for (const u of uciMoves.slice(0, 8)) {
    const move = preview.move({
      from: u.slice(0, 2),
      to: u.slice(2, 4),
      promotion: u[4] || undefined,
    });
    if (!move) break;
    sans.push(move.san);
  }
  return sans.join(" ");
}

function paintEvalBar(info) {
  if (!info || info.whiteCp == null) {
    els.evalTrack.classList.add("hidden");
    els.boardFrame.classList.remove("with-eval");
    return;
  }
  const whiteCp = info.whiteCp;
  let scoreText = "0.0";
  if (Math.abs(whiteCp) >= 9000) {
    const mate = Math.max(1, Math.round((10000 - Math.abs(whiteCp)) / 10));
    scoreText = whiteCp > 0 ? `M${mate}` : `-M${mate}`;
  } else {
    scoreText = `${whiteCp > 0 ? "+" : ""}${(whiteCp / 100).toFixed(1)}`;
  }
  const pct = 50 + 50 * Math.max(-1, Math.min(1, whiteCp / 800));
  els.evalFill.style.height = `${pct}%`;
  els.evalTrack.title = scoreText;
  els.evalTrack.classList.remove("hidden");
  els.boardFrame.classList.add("with-eval");
}

function syncAnalysis() {
  if (!state.reviewMode || !state.over) {
    hideAnalysisUi();
    return;
  }
  const ply = state.reviewPly == null ? state.tape.length : state.reviewPly;
  const row = ply > 0 ? state.reviewReport?.[ply - 1] : null;
  if (row) {
    els.analysis.classList.remove("hidden");
    els.analysisStatus.innerHTML = `<span class="move-tag ${row.tag}">${row.tag}</span>`;
    const score = state.positionEvals?.[ply];
    let scoreBit = "";
    if (score?.whiteCp != null) {
      const cp = score.whiteCp;
      scoreBit = Math.abs(cp) >= 9000
        ? (cp > 0 ? `M${Math.max(1, Math.round((10000 - cp) / 10))}` : `-M${Math.max(1, Math.round((10000 + cp) / 10))}`)
        : `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
      scoreBit = ` · ${scoreBit}`;
    }
    els.analysisLine.textContent = `${row.note}${scoreBit}`;
  } else if (state.reviewRunning) {
    els.analysis.classList.remove("hidden");
    els.analysisStatus.textContent = "Analyzing…";
    els.analysisLine.textContent = "Rating this move";
  } else {
    els.analysis.classList.remove("hidden");
    els.analysisStatus.textContent = "Review";
    els.analysisLine.textContent = "Click a move to rate it";
  }
  paintEvalBar(state.positionEvals?.[ply] || null);
}

async function ensureEngine() {
  if (state.engine) return state.engine;
  const mod = await import("./engine.js");
  state.engine = await mod.createEngine(() => {});
  state.engineStarted = true;
  return state.engine;
}

async function evalAtFen(fen) {
  const engine = await ensureEngine();
  const turn = fen.split(" ")[1];
  const info = await engine.evaluate(fen, { depth: 10, movetime: 160 });
  return {
    ...info,
    turn,
    fen,
    whiteCp: whiteCpFromInfo(info, turn),
  };
}

async function gradePly(ply) {
  if (!state.reviewMode || !state.over || ply < 1) return;
  freezeTape();
  const idx = ply - 1;
  if (state.reviewReport?.[idx]) {
    syncAnalysis();
    return;
  }
  const token = ++state.gradeToken;
  state.reviewRunning = true;
  syncAnalysis();
  try {
    if (!state.positionEvals) state.positionEvals = [];
    if (!state.reviewReport) state.reviewReport = [];
    const cursor = new Chess();
    for (let i = 0; i < idx; i++) cursor.move(state.tape[i]);
    const move = state.tape[idx];
    const beforeFen = cursor.fen();
    const beforeMat = material(cursor, move.color) - material(cursor, oppositeColor(move.color));
    if (!state.positionEvals[idx]) state.positionEvals[idx] = await evalAtFen(beforeFen);
    cursor.move(move);
    const afterMat = material(cursor, move.color) - material(cursor, oppositeColor(move.color));
    if (!state.positionEvals[ply]) state.positionEvals[ply] = await evalAtFen(cursor.fen());
    if (token !== state.gradeToken) return;
    const before = state.positionEvals[idx];
    const after = state.positionEvals[ply];
    const bestSan = pvToSan(beforeFen, before.pv || [before.bestmove]).split(" ")[0] || "";
    const grade = classifyMove({
      move,
      before,
      after,
      plyIndex: idx,
      bestSan,
      materialDrop: beforeMat - afterMat,
    });
    state.reviewReport[idx] = { san: move.san, color: move.color, ...grade };
  } catch {
    if (token === state.gradeToken) toast("Could not load Stockfish");
  } finally {
    if (token === state.gradeToken) state.reviewRunning = false;
  }
  if (token === state.gradeToken) {
    renderMoves();
    syncAnalysis();
  }
}

async function startGameReview() {
  freezeTape();
  hideEndModal(true);
  state.reviewMode = true;
  state.reviewReport = state.reviewReport || [];
  state.positionEvals = state.positionEvals || [];
  state.reviewPly = state.tape.length;
  try {
    await ensureEngine();
  } catch {
    state.reviewMode = false;
    toast("Could not load Stockfish");
    return;
  }
  render();
  if (state.tape.length) await gradePly(state.tape.length);
  else syncAnalysis();
}

function disconnect() {
  stopClock();
  stopEngine();
  try {
    state.net?.leave();
  } catch {
    /* ignore */
  }
  state.net = null;
  state.peerId = null;
}

function shareUrl() {
  const timeMin = state.timeLimitMs ? state.timeLimitMs / 60000 : 0;
  const inc = state.incrementMs ? state.incrementMs / 1000 : 0;
  const url = new URL(location.href);
  url.search = `room=${state.roomId}&t=${timeMin}&i=${inc}&s=${state.hostColor}`;
  return url.toString();
}

function bindBoard() {
  document.addEventListener("selectstart", (e) => {
    if (document.body.classList.contains("is-dragging") || e.target.closest("#game")) {
      e.preventDefault();
    }
  });
  document.addEventListener("dragstart", (e) => {
    if (e.target.closest("#game")) e.preventDefault();
  });
  els.board.addEventListener("dragstart", (e) => e.preventDefault());
  els.board.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (waitingForPeer()) return;
    const sq = e.target.closest(".sq");
    if (!sq) return;
    const square = sq.dataset.square;
    const piece = pieceAt(square);
    if (state.pendingPromo) return;

    if (state.selected && state.legal.some((m) => m.to === square)) {
      const move = tryMove(state.selected, square);
      if (move && state.mode === "online") sendMove(move);
      return;
    }

    if (!piece || !canControl(piece.color)) {
      selectSquare(null);
      return;
    }

    selectSquare(square);
    const img = els.board.querySelector(`[data-square="${square}"] .piece`);
    if (!img) return;
    img.classList.add("dragging");
    document.body.classList.add("is-dragging");
    try {
      els.board.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.innerHTML = pieceSvg(piece.type, piece.color);
    document.body.append(ghost);
    moveGhost(e);
    const pid = e.pointerId;
    const onMove = (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      moveGhost(ev);
    };
    const onUp = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-dragging");
      try {
        els.board.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
      ghost?.remove();
      ghost = null;
      img.classList.remove("dragging");
      const destEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".sq");
      const dest = destEl?.dataset.square;
      if (dest && dest !== square) {
        const move = tryMove(square, dest);
        if (move) {
          if (state.mode === "online") sendMove(move);
        } else if (!state.pendingPromo) {
          selectSquare(dest);
        }
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function moveGhost(e) {
  if (!ghost) return;
  const sq = els.board.querySelector(".sq");
  if (sq) {
    const size = Math.round(sq.getBoundingClientRect().width * 0.92);
    document.documentElement.style.setProperty("--ghost-size", `${size}px`);
  }
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
}

function selectedRoomSide() {
  return els.roomSide.querySelector(".choice.selected")?.dataset.side || "random";
}

function openRoomModal() {
  els.roomTime.value = els.timeControl.value;
  els.roomModal.classList.remove("hidden");
}

function closeRoomModal() {
  els.roomModal.classList.add("hidden");
}

async function createRoomFromModal() {
  const timeMin = Number(els.roomTime.value);
  const incrementSec = Number(els.roomInc.value);
  let hostColor = selectedRoomSide();
  if (hostColor === "random") hostColor = Math.random() < 0.5 ? "w" : "b";
  closeRoomModal();
  await startOnline({
    roomId: randomRoomId(),
    isHost: true,
    timeMin,
    incrementSec,
    hostColor,
  });
  toast(`You play ${hostColor === "w" ? "White" : "Black"} — invite copied`);
  copyLink();
}

function bindUi() {
  document.getElementById("play-local").addEventListener("click", startLocal);
  document.getElementById("create-room").addEventListener("click", openRoomModal);
  document.getElementById("room-cancel").addEventListener("click", closeRoomModal);
  document.getElementById("room-go").addEventListener("click", createRoomFromModal);
  els.playerName?.addEventListener("change", () => {
    savePlayerName(els.playerName.value);
  });
  els.playerName?.addEventListener("blur", () => {
    savePlayerName(els.playerName.value);
  });
  els.roomSide.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-side]");
    if (!btn) return;
    for (const choice of els.roomSide.querySelectorAll(".choice")) {
      choice.classList.toggle("selected", choice === btn);
    }
  });
  els.roomModal.addEventListener("click", (e) => {
    if (e.target === els.roomModal) closeRoomModal();
  });
  document.getElementById("end-analyze").addEventListener("click", startGameReview);
  document.getElementById("end-again").addEventListener("click", () => {
    hideEndModal(true);
    requestRematch();
  });
  els.boardTheme?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (!btn) return;
    saveBoardTheme(btn.dataset.theme);
  });
  els.waitCopy.addEventListener("click", copyLink);
  els.endModal.addEventListener("click", (e) => {
    if (e.target === els.endModal) hideEndModal(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.roomModal.classList.contains("hidden")) closeRoomModal();
    else if (!els.endModal.classList.contains("hidden")) hideEndModal(true);
  });
  document.getElementById("join-room").addEventListener("click", () => {
    const roomId = els.joinCode.value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (roomId.length < 4) {
      toast("Enter a room code");
      return;
    }
    startOnline({ roomId, isHost: false, timeMin: Number(els.timeControl.value) });
  });
  document.getElementById("leave").addEventListener("click", () => {
    disconnect();
    hideEndModal(true);
    closeRoomModal();
    state.opponentName = "";
    history.replaceState({}, "", location.pathname);
    state.mode = "menu";
    els.game.classList.add("hidden");
    els.menu.classList.remove("hidden");
  });
  document.getElementById("copy-link").addEventListener("click", copyLink);
  els.moves.addEventListener("click", (e) => {
    const ply = e.target.closest("[data-ply]")?.dataset.ply;
    if (!ply || !state.over) return;
    if (!state.reviewMode) {
      freezeTape();
      state.reviewMode = true;
      state.reviewReport = state.reviewReport || [];
      state.positionEvals = state.positionEvals || [];
      ensureEngine().catch(() => toast("Could not load Stockfish"));
    }
    goToPly(Number(ply));
  });
  document.getElementById("flip").addEventListener("click", () => {
    state.orientation = state.orientation === "w" ? "b" : "w";
    render();
  });
  document.getElementById("resign").addEventListener("click", () => {
    if (state.over || waitingForPeer()) return;
    const color = state.mode === "online" ? state.color : state.chess.turn();
    stopClock();
    state.over = `${color === "w" ? "White" : "Black"} resigned`;
    state.endClosed = false;
    state.net?.send({ type: "resign", color, seq: ++state.seq });
    render();
  });
  document.getElementById("offer-draw").addEventListener("click", () => {
    if (state.over || waitingForPeer()) return;
    if (state.mode === "local") {
      stopClock();
      state.over = "Draw by agreement";
      state.endClosed = false;
      render();
      return;
    }
    state.net?.send({ type: "draw-offer", seq: ++state.seq });
    toast("Draw offered");
  });
  document.getElementById("rematch").addEventListener("click", () => {
    if (!state.over && state.mode === "online") {
      state.net?.send({ type: "new-game-offer", seq: ++state.seq });
      toast("Rematch offered");
      return;
    }
    requestRematch();
  });
}

async function copyLink() {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite copied");
  } catch {
    toast(url);
  }
}

function tick() {
  if (state.mode !== "menu") updateClocks();
  requestAnimationFrame(tick);
}

function boot() {
  bindUi();
  bindBoard();
  loadPlayerName();
  loadBoardTheme();
  tick();
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) {
    startOnline({
      roomId: room,
      isHost: params.get("host") === "1",
      timeMin: Number(params.get("t") ?? "10"),
      incrementSec: Number(params.get("i") ?? "0"),
      hostColor: params.get("s") === "b" ? "b" : "w",
    });
  }
}

boot();
