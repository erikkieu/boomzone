const TILE = 50;
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

let playerId = null;
let map = [];
let state = {
  players: [],
  bombs: [],
  explosions: [],
  powerups: [],
  zone: null,
  winner: null
};

const keys = { up: false, down: false, left: false, right: false };
let sequence = 0;
const pendingInputs = [];

const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

ws.addEventListener("open", () => {
  statusEl.textContent = "Connected. Waiting for players...";
  setInterval(sendInput, 50);
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "welcome") {
    playerId = msg.id;
    map = msg.map;
    return;
  }

  if (msg.type === "snapshot") {
    state = msg;
    const self = state.players.find((p) => p.id === playerId);
    if (!self) return;

    while (pendingInputs.length && pendingInputs[0].seq <= self.lastSeq) {
      pendingInputs.shift();
    }

    for (const input of pendingInputs) {
      const speed = 3.2 * 0.05;
      if (input.keys.left) self.x -= speed;
      if (input.keys.right) self.x += speed;
      if (input.keys.up) self.y -= speed;
      if (input.keys.down) self.y += speed;
    }

    if (state.winner) {
      statusEl.textContent = state.winner === playerId ? "You win!" : "Eliminated / spectating.";
    } else {
      const alive = state.players.filter((p) => p.alive).length;
      statusEl.textContent = `Alive: ${alive} | Your kills: ${self.kills}`;
    }
  }
});

ws.addEventListener("close", () => {
  statusEl.textContent = "Disconnected";
});

function sendInput() {
  if (ws.readyState !== WebSocket.OPEN) return;
  sequence += 1;
  const payload = { type: "input", keys: { ...keys }, seq: sequence };
  ws.send(JSON.stringify(payload));
  pendingInputs.push(payload);
}

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a") keys.left = true;
  if (e.key === "ArrowRight" || e.key === "d") keys.right = true;
  if (e.key === "ArrowUp" || e.key === "w") keys.up = true;
  if (e.key === "ArrowDown" || e.key === "s") keys.down = true;
  if (e.code === "Space") {
    ws.send(JSON.stringify({ type: "action", action: "bomb" }));
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a") keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d") keys.right = false;
  if (e.key === "ArrowUp" || e.key === "w") keys.up = false;
  if (e.key === "ArrowDown" || e.key === "s") keys.down = false;
});

function draw() {
  requestAnimationFrame(draw);
  if (!map.length) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < map.length; y += 1) {
    for (let x = 0; x < map[y].length; x += 1) {
      const tile = map[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (tile === "wall") ctx.fillStyle = "#4d5677";
      else if (tile === "block") ctx.fillStyle = "#7e5d4e";
      else ctx.fillStyle = "#27314f";
      ctx.fillRect(px, py, TILE, TILE);
    }
  }

  if (state.zone) {
    const p = state.zone.currentPadding;
    ctx.fillStyle = "rgba(248, 70, 70, 0.18)";
    ctx.fillRect(0, 0, canvas.width, p * TILE);
    ctx.fillRect(0, canvas.height - p * TILE, canvas.width, p * TILE);
    ctx.fillRect(0, 0, p * TILE, canvas.height);
    ctx.fillRect(canvas.width - p * TILE, 0, p * TILE, canvas.height);
  }

  for (const powerup of state.powerups) {
    const colors = {
      range: "#ffcf70",
      capacity: "#f4a4ff",
      speed: "#7cffcb",
      bombPass: "#7cb8ff",
      shield: "#fff"
    };
    ctx.fillStyle = colors[powerup.type] || "#fff";
    ctx.beginPath();
    ctx.arc(powerup.x * TILE + TILE / 2, powerup.y * TILE + TILE / 2, TILE / 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const bomb of state.bombs) {
    const remain = Math.max(0, bomb.explodeAt - Date.now());
    const flash = remain < 900 && Math.floor(remain / 100) % 2 === 0;
    ctx.fillStyle = flash ? "#ff6767" : "#121212";
    ctx.beginPath();
    ctx.arc(bomb.x * TILE + TILE / 2, bomb.y * TILE + TILE / 2, TILE / 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const exp of state.explosions) {
    ctx.fillStyle = "#ffb847";
    for (const cell of exp.cells) {
      ctx.fillRect(cell.x * TILE + 8, cell.y * TILE + 8, TILE - 16, TILE - 16);
    }
  }

  const self = state.players.find((p) => p.id === playerId);
  const follow = self?.alive ? self : state.players.find((p) => p.alive);

  for (const player of state.players) {
    ctx.fillStyle = player.id === playerId ? "#7cc8ff" : "#ff7ca8";
    if (!player.alive) ctx.fillStyle = "#555";
    if (player.spawnProtected) ctx.fillStyle = "#d5ffd2";
    ctx.fillRect(player.x * TILE + 10, player.y * TILE + 10, TILE - 20, TILE - 20);
  }

  if (!self?.alive && follow) {
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`Spectating ${follow.id.slice(0, 4)}`, 20, 20);
  }
}

draw();
