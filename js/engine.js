const CDN_ENGINE = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
const LOCAL_ENGINE = new URL("./vendor/stockfish.js", import.meta.url);

function parseInfo(line) {
  if (typeof line !== "string" || !line.startsWith("info ")) return null;
  const depth = Number((line.match(/ depth (\d+)/) || [])[1] || 0);
  if (!depth) return null;
  const mate = line.match(/ score mate (-?\d+)/);
  const cp = line.match(/ score cp (-?\d+)/);
  const pv = (line.split(" pv ")[1] || "").trim().split(/\s+/).filter(Boolean);
  if (!mate && !cp) return null;
  return {
    depth,
    mate: mate ? Number(mate[1]) : null,
    cp: cp ? Number(cp[1]) : null,
    pv,
    multipv: Number((line.match(/ multipv (\d+)/) || [])[1] || 1),
  };
}

function lineFromEvent(data) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && typeof data.data === "string") return data.data;
  return String(data ?? "");
}

async function spawnWorker() {
  try {
    return new Worker(LOCAL_ENGINE);
  } catch {
    /* fall through to CDN copy */
  }
  const source = await fetch(CDN_ENGINE);
  if (!source.ok) throw new Error(`Stockfish download failed (${source.status})`);
  const code = await source.text();
  return new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
}

export async function createEngine(onInfo) {
  const worker = await spawnWorker();

  const listenLive = () => {
    worker.onmessage = (event) => {
      const info = parseInfo(lineFromEvent(event.data));
      if (info && info.multipv === 1) onInfo(info);
    };
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Stockfish timed out")), 20000);
    const fail = (reason) => {
      clearTimeout(timer);
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    worker.onerror = (err) => fail(err?.message || "Stockfish worker error");
    worker.onmessage = (event) => {
      const line = lineFromEvent(event.data);
      if (line.includes("uciok") || line.includes("readyok")) {
        clearTimeout(timer);
        listenLive();
        resolve();
      }
    };
    try {
      worker.postMessage("uci");
    } catch (err) {
      fail(err);
    }
  });

  try {
    worker.postMessage("setoption name MultiPV value 2");
  } catch {
    /* ignore */
  }

  return {
    analyze(fen, { depth = 10, movetime = 280 } = {}) {
      listenLive();
      worker.postMessage("stop");
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth} movetime ${movetime}`);
    },
    evaluate(fen, { depth = 10, movetime = 150 } = {}) {
      return new Promise((resolve) => {
        let last = { depth: 0, mate: null, cp: 0, pv: [] };
        let second = null;
        const finish = (bestmove) => {
          listenLive();
          resolve({
            ...last,
            bestmove: bestmove || last.pv[0] || "",
            pv: last.pv?.length ? last.pv : [bestmove].filter(Boolean),
            second,
          });
        };
        const timer = setTimeout(() => finish(last.pv[0]), movetime + 5000);
        worker.onmessage = (event) => {
          const line = lineFromEvent(event.data);
          const info = parseInfo(line);
          if (info) {
            if (info.multipv === 2) second = info;
            else last = info;
          }
          if (line.startsWith("bestmove")) {
            clearTimeout(timer);
            finish(line.split(/\s+/)[1]);
          }
        };
        worker.postMessage("stop");
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth} movetime ${movetime}`);
      });
    },
    destroy() {
      try {
        worker.postMessage("quit");
        worker.terminate();
      } catch {
        /* ignore */
      }
    },
  };
}
