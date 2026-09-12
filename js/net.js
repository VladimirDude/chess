const APP_ID = "documents-chess-p2p-v1";
const STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export function randomRoomId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function wrapAction(action) {
  if (Array.isArray(action)) {
    const [send, get] = action;
    return {
      send(data, opts) {
        if (opts?.target) send(data, opts.target);
        else send(data);
      },
      set onMessage(cb) {
        get((data, peerId) => cb(data, { peerId }));
      },
    };
  }
  return action;
}

export async function connectRoom(roomId, handlers) {
  let selfId = `tab-${Math.random().toString(36).slice(2, 8)}`;
  const channel = new BroadcastChannel(`chess-room-${roomId}`);
  const seen = new Set();

  const deliver = (data, peerId) => {
    const key = `${data?.seq ?? ""}:${data?.type ?? ""}:${data?.from ?? ""}:${data?.to ?? ""}`;
    if (data?.seq != null) {
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 400) seen.clear();
    }
    handlers.onMessage?.(data, peerId);
  };

  channel.onmessage = (event) => {
    const data = event.data;
    if (data?.kind === "join" || data?.kind === "hello-ack") {
      handlers.onPeerJoin?.(data.peerId || "local-tab");
      if (data.kind === "join") channel.postMessage({ kind: "hello-ack", peerId: selfId });
      return;
    }
    if (!data?.payload) return;
    deliver(data.payload, data.peerId || "local-tab");
  };
  channel.postMessage({ kind: "join", peerId: selfId });

  let room = null;
  let action = null;
  let trysteroReady = false;

  const sendAll = (data, target) => {
    channel.postMessage({ payload: data, peerId: selfId });
    if (trysteroReady && action) {
      try {
        if (target) action.send(data, { target });
        else action.send(data);
      } catch {
        /* ignore */
      }
    }
  };

  import("https://esm.run/trystero")
    .then((mod) => {
      selfId = mod.selfId || selfId;
      room = mod.joinRoom(
        {
          appId: APP_ID,
          rtcConfig: { iceServers: STUN },
        },
        roomId
      );
      action = wrapAction(room.makeAction("chess"));
      action.onMessage = (data, meta) => {
        const peerId = meta?.peerId ?? meta;
        deliver(data, peerId);
      };
      room.onPeerJoin = (peerId) => handlers.onPeerJoin?.(peerId);
      room.onPeerLeave = (peerId) => handlers.onPeerLeave?.(peerId);
      trysteroReady = true;
      handlers.onRelayReady?.();
    })
    .catch((err) => {
      handlers.onRelayError?.(err);
    });

  return {
    get selfId() {
      return selfId;
    },
    send: sendAll,
    getPeers() {
      if (!room?.getPeers) return [];
      return Object.keys(room.getPeers());
    },
    leave() {
      channel.close();
      try {
        room?.leave();
      } catch {
        /* ignore */
      }
    },
  };
}
