/* Moncloa Game · red para la versión web (GitHub Pages)
   Imita la API de salas que usa el juego: claude.use("room") → join(nombre) → {peers, presence, onPeers, leave}
   - Por defecto: un servidor MQTT público (EMQX o HiveMQ) que guarda la sala aunque alguien salga un momento.
   - Si no hay ningún servidor MQTT disponible: PeerJS (WebRTC directo entre móviles).
   - Opcional y más fiable: Firebase Realtime Database (rellena config.js).
   También ofrece claude.use("downloads") para guardar la imagen de invitación. */
(function(){
  const CFG = window.MONCLOA_CONFIG || {};
  const PREFIX = "moncloa-game-v1-";
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function loadScript(src){
    return new Promise((ok, ko) => {
      const s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => ko(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  /* ---------- Firebase Realtime Database ---------- */
  async function firebaseRoom(){
    const V = "10.12.2";
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-database-compat.js`);
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG.firebase);
    const db = app.database();
    return {
      async join(name){
        const ref = db.ref("rooms/" + name.replace(/[^a-z0-9-]/gi, "") + "/peers");
        const me = ref.child(uid());
        let list = [], cbs = [], errs = [], mine = null;
        const onVal = snap => {
          const v = snap.val() || {}; list = [];
          for (const k in v) { if (k === me.key) continue; try { list.push({ id: k, presence: JSON.parse(v[k].p) }); } catch (e) {} }
          cbs.forEach(f => { try { f(); } catch (e) {} });
        };
        ref.on("value", onVal, e => errs.forEach(f => f(e)));
        me.onDisconnect().remove();
        db.ref(".info/connected").on("value", s => { if (s.val() === true && mine) { me.onDisconnect().remove(); me.set({ p: mine, t: Date.now() }); } });
        return {
          peers: () => list,
          presence: async obj => { mine = JSON.stringify(obj); await me.set({ p: mine, t: Date.now() }); },
          onPeers: (f, e) => { cbs.push(f); if (e) errs.push(e); },
          leave: async () => { ref.off("value", onVal); await me.remove(); }
        };
      }
    };
  }

  /* ---------- MQTT: cada jugador deja su estado «retenido» en la sala ----------
     Nos conectamos a la vez a varios servidores públicos y juntamos lo que llega:
     basta con que dos móviles compartan uno de ellos para verse. */
  async function mqttRoom(){
    if (!window.mqtt) await loadScript("https://unpkg.com/mqtt@5/dist/mqtt.min.js").catch(() => loadScript("https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"));
    if (!window.mqtt || !window.mqtt.connect) throw new Error("no se cargó la librería MQTT");
    const URLS = (CFG.mqtt && CFG.mqtt.length) ? CFG.mqtt : [
      "wss://broker.emqx.io:8084/mqtt",
      "wss://broker.hivemq.com:8884/mqtt",
      "wss://mqtt.eclipseprojects.io:443/mqtt"
    ];
    function connectTo(url, opts){
      return new Promise((ok, ko) => {
        let c; try { c = window.mqtt.connect(url, opts); } catch (e) { ko(e); return; }
        let done = false;
        const fail = e => { if (done) return; done = true; try { c.end(true); } catch (x) {} ko(e || new Error("mqtt")); };
        const t = setTimeout(() => fail(new Error("tiempo agotado")), 12000);
        c.once("connect", () => { if (done) return; done = true; clearTimeout(t); ok(c); });
        c.once("error", e => { clearTimeout(t); fail(e); });
      });
    }
    async function mjoin(name){
      const room = name.replace(/[^a-z0-9-]/gi, "");
      const base = "moncloagame/v1/rooms/" + room + "/";
      const key = uid();
      const maps = new Map(); let mine = null; const cbs = [], errs = [];
      const fire = () => cbs.forEach(f => { try { f(); } catch (e) {} });
      const results = await Promise.allSettled(URLS.map(u => connectTo(u, {
        clientId: "mg_" + key + "_" + Math.random().toString(36).slice(2, 6), clean: true, keepalive: 25, reconnectPeriod: 3000, connectTimeout: 12000,
        will: { topic: base + key, payload: "", retain: true, qos: 1 }
      }).then(c => ({ u, c }))));
      const clients = results.filter(r => r.status === "fulfilled").map(r => r.value);
      window.MONCLOA_NET_SERVERS = clients.map(x => x.u.split("//")[1].split(/[:/]/)[0]).join(", ");
      if (!clients.length) {
        const why = results.map((r, i) => URLS[i].split("//")[1].split(/[:/]/)[0] + ": " + (r.reason && r.reason.message || r.reason)).join(" | ");
        throw new Error("ningún servidor responde (" + why + ")");
      }
      const pub = c => { if (mine !== null && c.connected) c.publish(base + key, mine, { retain: true, qos: 1 }); };
      for (const { c } of clients) {
        const m = new Map(); maps.set(c, m);
        c.on("message", (topic, buf) => {
          const k = topic.slice(base.length); if (!k || k === key) return;
          const txt = buf ? buf.toString() : "";
          if (!txt) m.delete(k); else { try { m.set(k, JSON.parse(txt)); } catch (e) { return; } }
          fire();
        });
        c.on("connect", () => pub(c));
        c.subscribe(base + "+", { qos: 1 }, () => {});
      }
      document.addEventListener("visibilitychange", () => { if (!document.hidden) clients.forEach(({ c }) => { if (!c.connected) { try { c.reconnect(); } catch (e) {} } }); });
      return {
        peers: () => { const all = new Map(); maps.forEach(m => m.forEach((v, k) => all.set(k, v))); return [...all.entries()].map(([id, presence]) => ({ id, presence })); },
        presence: async obj => { mine = JSON.stringify(obj); clients.forEach(({ c }) => pub(c)); },
        onPeers: (f, e) => { cbs.push(f); if (e) errs.push(e); },
        leave: async () => { clients.forEach(({ c }) => { try { c.publish(base + key, "", { retain: true, qos: 1 }); } catch (e) {} setTimeout(() => { try { c.end(true); } catch (e) {} }, 300); }); }
      };
    }
    return { async join(name){ try { return await mjoin(name); } catch (e) { throw new Error("servidor: " + (e && e.message || e)); } } };
  }

  /* ---------- PeerJS: el primero que entra en la sala hace de centro y reenvía ---------- */
  async function peerRoom(){
    if (!window.Peer) await loadScript("https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js");
    const peerOpts = CFG.peerjs || {};
    if (CFG.iceServers) peerOpts.config = { iceServers: CFG.iceServers };
    return {
      async join(name){
        const hubId = PREFIX + name.replace(/[^a-z0-9-]/gi, "");
        const myKey = uid();
        let mine = null, list = [], cbs = [], errs = [], left = false;
        let peer = null, isHub = false, hubConn = null, conns = new Map(), others = new Map(), retryT = null;
        const fire = () => cbs.forEach(f => { try { f(); } catch (e) {} });
        const setList = arr => { list = arr.filter(x => x.id !== myKey); fire(); };
        const hubBroadcast = () => {
          const all = [...others.entries()].map(([id, p]) => ({ id, presence: p }));
          if (mine) all.push({ id: myKey, presence: mine });
          conns.forEach(c => { try { c.open && c.send({ k: "all", all }); } catch (e) {} });
          setList(all);
        };
        const open = id => new Promise((ok, ko) => {
          const p = id ? new Peer(id, peerOpts) : new Peer(peerOpts);
          const t = setTimeout(() => ko(new Error("timeout")), 12000);
          p.on("open", () => { clearTimeout(t); ok(p); });
          p.on("error", e => { clearTimeout(t); ko(e); });
        });
        const becomeHub = p => {
          peer = p; isHub = true;
          p.on("connection", c => {
            c.on("data", d => {
              if (!d || typeof d !== "object") return;
              if (d.k === "hi" || d.k === "p") { c._key = String(d.key || c.peer).slice(0, 40); conns.set(c._key, c); if (d.p) others.set(c._key, d.p); hubBroadcast(); }
            });
            const drop = () => { if (c._key) { conns.delete(c._key); others.delete(c._key); hubBroadcast(); } };
            c.on("close", drop); c.on("error", drop);
          });
          p.on("disconnected", () => { if (!left) try { p.reconnect(); } catch (e) {} });
          p.on("error", () => {});
          hubBroadcast();
        };
        const becomeGuest = async () => {
          peer = await open(null); isHub = false;
          await new Promise((ok, ko) => {
            const c = peer.connect(hubId, { reliable: true });
            const t = setTimeout(() => ko(new Error("timeout")), 12000);
            c.on("open", () => { clearTimeout(t); hubConn = c; c.send({ k: "hi", key: myKey, p: mine }); ok(); });
            c.on("data", d => { if (d && d.k === "all" && Array.isArray(d.all)) setList(d.all); });
            const lost = () => { if (hubConn === c) { hubConn = null; list = []; fire(); scheduleRetry(); } };
            c.on("close", lost); c.on("error", lost);
          });
        };
        const connect = async () => {
          try { const p = await open(hubId); becomeHub(p); return; }
          catch (e) { if (!(e && e.type === "unavailable-id")) { if (peer) try { peer.destroy(); } catch (x) {} } }
          await becomeGuest();
        };
        const scheduleRetry = () => {
          if (left || retryT) return;
          retryT = setTimeout(async () => {
            retryT = null; if (left) return;
            try { if (peer) peer.destroy(); } catch (e) {}
            peer = null;
            try { await connect(); } catch (e) { scheduleRetry(); }
          }, 2500 + Math.random() * 1500);
        };
        try { await connect(); }
        catch (e) { throw e; }
        return {
          peers: () => list,
          presence: async obj => {
            mine = obj;
            if (isHub) hubBroadcast();
            else if (hubConn && hubConn.open) hubConn.send({ k: "p", key: myKey, p: mine });
          },
          onPeers: (f, e) => { cbs.push(f); if (e) errs.push(e); },
          leave: async () => { left = true; clearTimeout(retryT); try { peer && peer.destroy(); } catch (e) {} }
        };
      }
    };
  }

  /* ---------- descargas: compartir (móvil) o descargar ---------- */
  const downloads = {
    async save({ filename, data }){
      const file = new File([data], filename, { type: data.type || "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Moncloa Game" }); return; }
        catch (e) { if (e && e.name === "AbortError") { const x = new Error("declined"); x.code = "declined"; throw x; } }
      }
      const url = URL.createObjectURL(data), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  };

  let roomP = null;
  window.claude = {
    use(name){
      if (name === "downloads") return Promise.resolve(downloads);
      if (name === "room") {
        if (!roomP) roomP = (CFG.firebase && CFG.firebase.databaseURL ? firebaseRoom().then(r => (window.MONCLOA_NET = "firebase", r))
          : mqttRoom().then(r => (window.MONCLOA_NET = "mqtt", r)).catch(e => { window.MONCLOA_NET_ERR = String(e && e.message || e); return peerRoom().then(r => (window.MONCLOA_NET = "peerjs", r)); }))
          .catch(e => { window.MONCLOA_NET_ERR = String(e && e.message || e); return null; });
        return roomP;
      }
      return Promise.resolve(null);
    }
  };
})();
