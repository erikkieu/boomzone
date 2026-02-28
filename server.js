const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAP_W = 21;
const MAP_H = 15;
const BLOCK_DENSITY = 0.42;
const POWERUP_DROP_CHANCE = 0.2;
const BOMB_FUSE_MS = 2500;
const EXPLOSION_MS = 500;

const POWERUPS = ["range", "capacity", "speed", "bombPass", "shield"];
const SPAWN_POINTS = [
  { x: 1, y: 1 }, { x: MAP_W - 2, y: 1 }, { x: 1, y: MAP_H - 2 }, { x: MAP_W - 2, y: MAP_H - 2 },
  { x: Math.floor(MAP_W / 2), y: 1 }, { x: Math.floor(MAP_W / 2), y: MAP_H - 2 },
  { x: 1, y: Math.floor(MAP_H / 2) }, { x: MAP_W - 2, y: Math.floor(MAP_H / 2) }
];

const clients = new Set();
const server = http.createServer((req, res) => {
  const filePath = req.url === "/" ? "/public/index.html" : req.url;
  const safePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)+/, "");
  const absolutePath = path.join(__dirname, safePath);
  if (!absolutePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(absolutePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(absolutePath);
    const contentType = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": contentType });
    return res.end(content);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));

  const client = { socket, onMessage: null, onClose: null };
  clients.add(client);

  socket.on("data", (buffer) => {
    const msg = decodeWebSocketFrame(buffer);
    if (msg && client.onMessage) client.onMessage(msg);
  });

  socket.on("close", () => {
    clients.delete(client);
    if (client.onClose) client.onClose();
  });

  socket.on("error", () => {
    socket.destroy();
  });

  registerPlayer(client);
});

function sendWS(client, payload) {
  if (!client.socket.writable) return;
  const data = Buffer.from(payload);
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  client.socket.write(Buffer.concat([header, data]));
}

function decodeWebSocketFrame(buffer) {
  const first = buffer[0];
  const opcode = first & 0x0f;
  if (opcode === 0x8) return null;
  if (opcode !== 0x1) return null;
  const second = buffer[1];
  const masked = (second & 0x80) !== 0;
  let len = second & 0x7f;
  let offset = 2;
  if (len === 126) {
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    len = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let payload = buffer.slice(offset, offset + len);
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    offset += 4;
    payload = buffer.slice(offset, offset + len);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }
  return payload.toString("utf8");
}

let state = createGameState();
function createGameState() { return { tick: 0, players: new Map(), bombs: [], explosions: [], powerups: [], map: generateMap(), zone: { phases: [{ duration: 15000, targetPadding: 1 }, { duration: 15000, targetPadding: 3 }, { duration: 15000, targetPadding: 5 }, { duration: 15000, targetPadding: 6 }], phaseIndex: 0, phaseStart: Date.now(), currentPadding: 0, fromPadding: 0, targetPadding: 1, damagePerSecond: 0.8 }, winner: null }; }
function generateMap() { const map = []; for (let y = 0; y < MAP_H; y += 1) { const row = []; for (let x = 0; x < MAP_W; x += 1) { if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) row.push("wall"); else if (x % 2 === 0 && y % 2 === 0) row.push("wall"); else row.push(Math.random() < BLOCK_DENSITY ? "block" : "floor"); } map.push(row); } for (const spawn of SPAWN_POINTS) clearSafeArea(map, spawn.x, spawn.y); return map; }
function clearSafeArea(map, sx, sy) { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = sx + dx; const y = sy + dy; if (map[y] && map[y][x] && map[y][x] !== "wall") map[y][x] = "floor"; } }
function chooseSpawnPoint() { const alive = [...state.players.values()].filter((p) => p.alive); if (!alive.length) return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]; let best = SPAWN_POINTS[0]; let bestDistance = -1; for (const spawn of SPAWN_POINTS) { const minDist = alive.reduce((acc, p) => Math.min(acc, Math.abs(p.x - spawn.x) + Math.abs(p.y - spawn.y)), Infinity); if (minDist > bestDistance) { bestDistance = minDist; best = spawn; } } return best; }

function registerPlayer(client) {
  const spawn = chooseSpawnPoint();
  const id = cryptoRandomId();
  state.players.set(id, { id, ws: client, x: spawn.x, y: spawn.y, hp: 1, speed: 3.2, maxBombs: 1, range: 2, bombPass: false, shield: 0, alive: true, spawnProtectedUntil: Date.now() + 2000, iFrameUntil: 0, kills: 0, pendingInput: { up: false, down: false, left: false, right: false }, lastSeq: 0, activeBombs: 0 });
  sendWS(client, JSON.stringify({ type: "welcome", id, map: state.map, width: MAP_W, height: MAP_H }));

  client.onMessage = (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const player = [...state.players.values()].find((p) => p.ws === client);
    if (!player) return;
    if (data.type === "input") { player.pendingInput = data.keys || player.pendingInput; player.lastSeq = data.seq || player.lastSeq; }
    if (data.type === "action" && data.action === "bomb") placeBomb(player);
  };
  client.onClose = () => {
    const leaving = [...state.players.values()].find((p) => p.ws === client);
    if (leaving) state.players.delete(leaving.id);
  };
}

function canMoveTo(player, x, y) { const tx = Math.floor(x); const ty = Math.floor(y); const tile = state.map[ty]?.[tx]; if (!tile || tile === "wall" || tile === "block") return false; if (!player.bombPass) { const bomb = state.bombs.find((b) => b.x === tx && b.y === ty && !b.ownerJustLeft.has(player.id)); if (bomb) return false; } return true; }
function updatePlayerMovement(player, dt) { if (!player.alive) return; const speed = player.speed * dt; let dx = 0; let dy = 0; if (player.pendingInput.left) dx -= speed; if (player.pendingInput.right) dx += speed; if (player.pendingInput.up) dy -= speed; if (player.pendingInput.down) dy += speed; if (dx && dy) { dx *= 0.707; dy *= 0.707; } const newX = player.x + dx; const newY = player.y + dy; if (canMoveTo(player, newX, player.y)) player.x = clamp(newX, 1, MAP_W - 2.01); if (canMoveTo(player, player.x, newY)) player.y = clamp(newY, 1, MAP_H - 2.01); for (const bomb of state.bombs) if (Math.floor(player.x) !== bomb.x || Math.floor(player.y) !== bomb.y) bomb.ownerJustLeft.delete(player.id); }
function placeBomb(player) { if (!player.alive || player.activeBombs >= player.maxBombs) return; const x = Math.floor(player.x); const y = Math.floor(player.y); if (state.map[y][x] !== "floor" || state.bombs.some((b) => b.x === x && b.y === y)) return; state.bombs.push({ id: cryptoRandomId(), ownerId: player.id, x, y, range: player.range, explodeAt: Date.now() + BOMB_FUSE_MS, ownerJustLeft: new Set([player.id]) }); player.activeBombs += 1; }
function explodeBomb(bomb, causeOwnerId = bomb.ownerId) { const idx = state.bombs.findIndex((b) => b.id === bomb.id); if (idx === -1) return; const existing = state.bombs[idx]; const owner = state.players.get(existing.ownerId); if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1); state.bombs.splice(idx, 1); const cells = [{ x: existing.x, y: existing.y }]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { for (let i = 1; i <= existing.range; i += 1) { const x = existing.x + dx * i; const y = existing.y + dy * i; const tile = state.map[y]?.[x]; if (!tile || tile === "wall") break; cells.push({ x, y }); if (tile === "block") { state.map[y][x] = "floor"; maybeSpawnPowerup(x, y); break; } } } state.explosions.push({ id: cryptoRandomId(), ownerId: causeOwnerId, cells, expiresAt: Date.now() + EXPLOSION_MS }); for (const chain of [...state.bombs]) if (cells.some((c) => c.x === chain.x && c.y === chain.y)) explodeBomb(chain, causeOwnerId); }
function maybeSpawnPowerup(x, y) { if (Math.random() > POWERUP_DROP_CHANCE) return; state.powerups.push({ id: cryptoRandomId(), x, y, type: POWERUPS[Math.floor(Math.random() * POWERUPS.length)] }); }
function applyPowerup(player, type) { if (type === "range") player.range = Math.min(8, player.range + 1); if (type === "capacity") player.maxBombs = Math.min(8, player.maxBombs + 1); if (type === "speed") player.speed = Math.min(5.5, player.speed + 0.35); if (type === "bombPass") player.bombPass = true; if (type === "shield") player.shield = Math.min(2, player.shield + 1); }
function damagePlayer(player, sourceOwnerId) { const now = Date.now(); if (!player.alive || now < player.spawnProtectedUntil || now < player.iFrameUntil) return; if (player.shield > 0) { player.shield -= 1; player.iFrameUntil = now + 500; return; } player.hp -= 1; player.iFrameUntil = now + 500; if (player.hp <= 0) { player.alive = false; const killer = state.players.get(sourceOwnerId); if (killer && killer.id !== player.id) killer.kills += 1; } }
function updateZone(now, dt) { const zone = state.zone; const phase = zone.phases[zone.phaseIndex]; if (!phase) return; const t = clamp((now - zone.phaseStart) / phase.duration, 0, 1); zone.currentPadding = zone.fromPadding + (phase.targetPadding - zone.fromPadding) * t; if (t >= 1 && zone.phaseIndex < zone.phases.length - 1) { zone.phaseIndex += 1; zone.phaseStart = now; zone.fromPadding = zone.currentPadding; zone.targetPadding = zone.phases[zone.phaseIndex].targetPadding; } const minX = zone.currentPadding; const minY = zone.currentPadding; const maxX = MAP_W - 1 - zone.currentPadding; const maxY = MAP_H - 1 - zone.currentPadding; for (const player of state.players.values()) { if (!player.alive) continue; if (player.x < minX || player.y < minY || player.x > maxX || player.y > maxY) { player.hp -= zone.damagePerSecond * dt; if (player.hp <= 0) player.alive = false; } } }
function checkPowerupPickup(player) { const px = Math.floor(player.x); const py = Math.floor(player.y); const found = state.powerups.find((p) => p.x === px && p.y === py); if (!found) return; applyPowerup(player, found.type); state.powerups = state.powerups.filter((p) => p.id !== found.id); }
function updateGame() { const now = Date.now(); const dt = TICK_MS / 1000; state.tick += 1; for (const player of state.players.values()) { updatePlayerMovement(player, dt); checkPowerupPickup(player); } for (const bomb of [...state.bombs]) if (bomb.explodeAt <= now) explodeBomb(bomb); state.explosions = state.explosions.filter((exp) => exp.expiresAt > now); for (const exp of state.explosions) for (const player of state.players.values()) if (exp.cells.some((c) => c.x === Math.floor(player.x) && c.y === Math.floor(player.y))) damagePlayer(player, exp.ownerId); updateZone(now, dt); const alive = [...state.players.values()].filter((p) => p.alive); if (alive.length <= 1 && state.players.size > 1) state.winner = alive[0]?.id || null; broadcastSnapshot(); }
function broadcastSnapshot() { const payload = JSON.stringify({ type: "snapshot", tick: state.tick, players: [...state.players.values()].map((p) => ({ id: p.id, x: p.x, y: p.y, hp: p.hp, alive: p.alive, shield: p.shield, kills: p.kills, spawnProtected: Date.now() < p.spawnProtectedUntil, lastSeq: p.lastSeq })), bombs: state.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, explodeAt: b.explodeAt })), explosions: state.explosions, powerups: state.powerups, zone: state.zone, winner: state.winner, map: state.map }); for (const player of state.players.values()) sendWS(player.ws, payload); }

setInterval(updateGame, TICK_MS);
server.listen(PORT, () => console.log(`Boomzone server running on http://localhost:${PORT}`));
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cryptoRandomId() { return Math.random().toString(36).slice(2, 10); }
