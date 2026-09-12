const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function whiteCpFromInfo(info, turn) {
  let value = 0;
  if (info?.mate != null) value = info.mate > 0 ? 10000 - info.mate * 10 : -10000 - info.mate * 10;
  else if (info?.cp != null) value = info.cp;
  return turn === "w" ? value : -value;
}

function playerCp(white, color) {
  return color === "w" ? white : -white;
}

export function material(chess, color) {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) total += VAL[piece.type] || 0;
    }
  }
  return total;
}

function uciOf(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

/** Shallow Stockfish swings a lot — ignore small noise before grading. */
function softLoss(raw) {
  return Math.max(0, raw - 35);
}

export function classifyMove({ move, before, after, plyIndex, bestSan, materialDrop }) {
  const played = uciOf(move);
  const bestUci = before.bestmove || before.pv?.[0] || "";
  const isBest = Boolean(bestUci) && (played === bestUci || played === bestUci.slice(0, played.length));
  const beforeP = playerCp(before.whiteCp, move.color);
  const afterP = playerCp(after.whiteCp, move.color);
  const rawLoss = beforeP - afterP;
  const loss = softLoss(rawLoss);
  const alt = bestSan && bestSan !== move.san ? bestSan : "";
  const second = before.second;
  let onlyMove = false;
  if (second) {
    const next = playerCp(whiteCpFromInfo(second, move.color), move.color);
    onlyMove = beforeP - next >= 180;
  }

  let tag = "average";
  let note = alt ? `Fine; ${alt} was a bit stronger` : "A reasonable try";

  if (plyIndex < 14 && loss < 100 && Math.abs(before.whiteCp) < 180) {
    tag = "book";
    note = "A standard opening move";
  } else if (isBest || loss <= 25) {
    if (materialDrop >= 3 && afterP >= 40) {
      tag = "brilliant";
      note = "A sound sacrifice";
    } else if (onlyMove || (Math.abs(beforeP) > 220 && isBest)) {
      tag = "great";
      note = "The strongest idea in the position";
    } else {
      tag = "best";
      note = "Matches the engine's top choice";
    }
  } else if (loss <= 90) {
    tag = "good";
    note = alt ? `Slightly weaker than ${alt}` : "A solid continuation";
  } else if (beforeP >= 280 && afterP < 60 && afterP > -250 && loss >= 200) {
    tag = "miss";
    note = alt ? `Missed ${alt}` : "A winning idea was available";
  } else if (loss <= 200) {
    tag = "average";
    note = alt ? `Fine; ${alt} was a bit stronger` : "An ordinary move";
  } else if (loss <= 400) {
    tag = "mistake";
    note = alt ? `Better was ${alt}` : "Loses some of the advantage";
  } else {
    tag = "blunder";
    note = alt ? `Loses ground; ${alt} was stronger` : "A serious error";
  }

  return { tag, note, loss: rawLoss, bestSan: alt, isBest };
}
