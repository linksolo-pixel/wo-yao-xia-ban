/**
 * 《职场大乱斗：我要下班》浏览器原型
 * 迁微信小游戏：用 wx.createCanvas() 取上下文，触摸替代键盘，其余逻辑可复用。
 */

const W = 320;
const H = 180;
/** 逻辑分辨率放大倍数，提高汉字与线条清晰度 */
const GAME_SCALE = 2;

function getDisplayDpr() {
  return Math.min(window.devicePixelRatio || 1, 2.5);
}

/** 画布 backingStore 与逻辑坐标 (W×H) 的缩放：GAME_SCALE × DPR */
function getCanvasScale() {
  return GAME_SCALE * getDisplayDpr();
}

function syncCanvasSize() {
  const scale = getCanvasScale();
  const bw = Math.round(W * scale);
  const bh = Math.round(H * scale);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  /* 显示尺寸交给 CSS（width:100% + aspect-ratio），避免固定 640px 在宽容器里右侧留白 */
  canvas.style.width = "";
  canvas.style.height = "";
}

function applyLogicalTransform() {
  const s = getCanvasScale();
  ctx.setTransform(s, 0, 0, s, 0, 0);
}

const FONT_UI = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

const HIT_PHRASES = ["收到", "好的", "马上改", "再对下", "辛苦啦", "加个班"];

/** 敌人被击杀时掉落奶茶的概率（不影响刷怪与难度曲线） */
const MILK_TEA_DROP_RATE = 0.035;
const MILK_TEA_HEAL = 16;
const MILK_TEA_PICKUP_R = 18;

/** 技能「离职信」：全屏 AOE，每局一次 */
const RESIGN_LETTER_AOE_DMG = 26;

/** id 与 assets/sprites/enemy_<id>.png 对应 */
const ENEMY_TYPES = [
  { id: "ppt", name: "画着饼的巨大PPT", hp: 4, spd: 25, r: 10, color: "#6b8cff" },
  { id: "printer", name: "会咬人的打印机", hp: 2, spd: 38, r: 7, color: "#8899aa" },
  { id: "coffee", name: "喷射毒气的咖啡杯", hp: 3, spd: 31, r: 8, color: "#c45c3e" },
  { id: "client", name: "追着签字的甲方", hp: 5, spd: 21, r: 9, color: "#c9a227" },
];

const SPRITE_DIR = "assets/sprites/";
const SPRITE_FILES = {
  player: "player.png",
  ppt: "enemy_ppt.png",
  printer: "enemy_printer.png",
  coffee: "enemy_coffee.png",
  client: "enemy_client.png",
};

/** @type {Record<string, HTMLImageElement>} */
const sprites = {};
let spritesReady = false;

function loadSprites() {
  const keys = Object.keys(SPRITE_FILES);
  return Promise.all(
    keys.map(
      (key) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            sprites[key] = img;
            resolve();
          };
          img.onerror = () => {
            console.warn(`[sprites] 跳过 ${SPRITE_DIR}${SPRITE_FILES[key]}`);
            resolve();
          };
          img.src = SPRITE_DIR + SPRITE_FILES[key];
        }),
    ),
  ).then(() => {
    spritesReady = true;
  });
}

const WEAPONS = [
  { id: "keyboard", kind: "melee", name: "键盘", cd: 0.45, range: 28, dmg: 2 },
  { id: "mouse", kind: "melee", name: "鼠标", cd: 0.35, range: 24, dmg: 1 },
  { id: "chair", kind: "melee", name: "折叠椅", cd: 0.6, range: 36, dmg: 4 },
  { id: "hotcoffee", kind: "ranged", name: "滚烫咖啡", cd: 0.4, spd: 100, dmg: 3 },
  { id: "laser", kind: "ranged", name: "愤怒眼神", cd: 0.55, spd: 200, dmg: 2 },
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

syncCanvasSize();
window.addEventListener("resize", () => {
  syncCanvasSize();
});

const keys = new Set();
let resignLetterPending = false;
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === "r" && !e.repeat) {
    resignLetterPending = true;
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

const state = {
  t: 0,
  shiftEnd: 90,
  wave: 1,
  spawnAcc: 0,
  player: {
    x: W / 2,
    y: H / 2,
    hp: 100,
    maxHp: 100,
    baseSpd: 78,
    weaponIndex: 0,
    facing: 0,
    stillTime: 0,
    lastVx: 0,
    lastVy: 0,
  },
  skills: {
    noInvolution: true,
    paidPoop: true,
    allVillains: true,
  },
  allies: [],
  enemies: [],
  pickups: [],
  projectiles: [],
  pops: [],
  particles: [],
  shake: 0,
  gameOver: false,
  won: false,
  /** 技能「离职信」是否仍可使用（每局一次） */
  skillResignLetter: true,
};

function speedMult() {
  return state.skills.noInvolution ? 1.22 : 1;
}

function weapon() {
  return WEAPONS[state.player.weaponIndex % WEAPONS.length];
}

function spawnEnemy() {
  const side = (Math.random() * 4) | 0;
  let x, y;
  const pad = 16;
  if (side === 0) {
    x = rnd(pad, W - pad);
    y = -12;
  } else if (side === 1) {
    x = W + 12;
    y = rnd(pad, H - pad);
  } else if (side === 2) {
    x = rnd(pad, W - pad);
    y = H + 12;
  } else {
    x = -12;
    y = rnd(pad, H - pad);
  }
  const def = pick(ENEMY_TYPES);
  state.enemies.push({
    ...def,
    x,
    y,
    hp: def.hp + Math.floor(state.wave / 2),
    maxHp: def.hp + Math.floor(state.wave / 2),
  });
}

function addPop(x, y, text, color = "#fff") {
  state.pops.push({ x, y, text, color, t: 0, life: 0.85, vy: -28 });
}

function addParticles(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2);
    const s = rnd(40, 120);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      t: 0,
      life: rnd(0.25, 0.55),
      color,
    });
  }
}

function damageEnemy(enemy, dmg, hitX, hitY, silent = false) {
  enemy.hp -= dmg;
  if (!silent) {
    addPop(hitX, hitY - 8, pick(HIT_PHRASES), "#ffee88");
    state.shake = Math.min(0.12, state.shake + 0.04);
  }
  addParticles(enemy.x, enemy.y, silent ? 2 : 6, enemy.color);
  if (enemy.hp <= 0) {
    addParticles(enemy.x, enemy.y, 10, "#ffffff");
    if (Math.random() < MILK_TEA_DROP_RATE) {
      state.pickups.push({
        x: Math.max(12, Math.min(W - 12, enemy.x)),
        y: Math.max(12, Math.min(H - 12, enemy.y)),
        bob: Math.random() * Math.PI * 2,
      });
    }
  }
}

function tryMelee() {
  const w = weapon();
  if (w.kind !== "melee") return;
  const p = state.player;
  let best = null;
  let bestD = w.range + 1;
  for (const e of state.enemies) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return;
  const ang = Math.atan2(best.y - p.y, best.x - p.x);
  p.facing = ang;
  damageEnemy(best, w.dmg, best.x, best.y);
}

function tryRanged() {
  const w = weapon();
  if (w.kind !== "ranged") return;
  const p = state.player;
  let target = null;
  let bestD = 1e9;
  for (const e of state.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  if (!target) return;
  const ang = Math.atan2(target.y - p.y, target.x - p.x);
  p.facing = ang;
  state.projectiles.push({
    x: p.x + Math.cos(ang) * 8,
    y: p.y + Math.sin(ang) * 8,
    vx: Math.cos(ang) * w.spd,
    vy: Math.sin(ang) * w.spd,
    dmg: w.dmg,
    id: w.id,
    life: 1.8,
  });
}

let weaponCd = 0;

function fireWeapon() {
  const w = weapon();
  if (weaponCd > 0) return;
  weaponCd = w.cd;
  if (w.kind === "melee") tryMelee();
  else tryRanged();
}

function allyTick(dt) {
  if (!state.skills.allVillains) return;
  state.allies.forEach((a) => {
    a.cd -= dt;
    if (a.cd > 0) return;
    a.cd = rnd(0.35, 0.7);
    const p = state.player;
    let target = pick(state.enemies);
    if (!target) return;
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    state.projectiles.push({
      x: p.x + Math.cos(ang + rnd(-0.2, 0.2)) * 6,
      y: p.y + Math.sin(ang + rnd(-0.2, 0.2)) * 6,
      vx: Math.cos(ang) * 95,
      vy: Math.sin(ang) * 95,
      dmg: 1,
      id: "ally",
      life: 1.2,
    });
  });
}

function update(dt) {
  if (!spritesReady) return;
  if (state.gameOver) return;

  if (resignLetterPending) {
    resignLetterPending = false;
    if (state.skillResignLetter) {
      state.skillResignLetter = false;
      const snapshot = state.enemies.slice();
      for (const e of snapshot) {
        if (e.hp > 0) damageEnemy(e, RESIGN_LETTER_AOE_DMG, e.x, e.y, true);
      }
      addPop(W / 2, H / 2 - 28, "离职信", "#fff9c4");
      state.shake = Math.min(0.28, state.shake + 0.18);
      for (let i = 0; i < 36; i++) {
        addParticles(rnd(8, W - 8), rnd(8, H - 8), 1, "#e8eaf6");
      }
    }
  }

  state.t += dt;
  if (state.t >= state.shiftEnd) {
    state.won = true;
    state.gameOver = true;
    return;
  }

  weaponCd -= dt;
  state.shake = Math.max(0, state.shake - dt);

  const p = state.player;
  let ix = 0,
    iy = 0;
  if (keys.has("w") || keys.has("arrowup")) iy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) iy += 1;
  if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
  if (keys.has("d") || keys.has("arrowright")) ix += 1;
  if (keys.has("q")) {
    state.player.weaponIndex = (state.player.weaponIndex + WEAPONS.length - 1) % WEAPONS.length;
    keys.delete("q");
  }
  if (keys.has("e")) {
    state.player.weaponIndex = (state.player.weaponIndex + 1) % WEAPONS.length;
    keys.delete("e");
  }

  const len = Math.hypot(ix, iy) || 1;
  const spd = p.baseSpd * speedMult();
  const vx = (ix / len) * spd * dt;
  const vy = (iy / len) * spd * dt;
  p.x = Math.max(14, Math.min(W - 14, p.x + vx));
  p.y = Math.max(14, Math.min(H - 14, p.y + vy));

  const moving = Math.abs(vx) + Math.abs(vy) > 0.001;
  if (moving) {
    p.stillTime = 0;
    p.facing = Math.atan2(vy || p.lastVy, vx || p.lastVx);
    p.lastVx = vx;
    p.lastVy = vy;
  } else {
    p.stillTime += dt;
    if (state.skills.paidPoop && p.stillTime > 0.35) {
      p.hp = Math.min(p.maxHp, p.hp + 9 * dt);
    }
  }

  fireWeapon();
  allyTick(dt);

  const spawnRate = 0.72 + state.wave * 0.11 + state.t * 0.009;
  state.spawnAcc += dt * spawnRate;
  while (state.spawnAcc >= 1) {
    state.spawnAcc -= 1;
    spawnEnemy();
  }
  if (state.t > state.wave * 14) state.wave++;

  for (const e of state.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const sp = e.spd * (1 + state.t * 0.012);
    e.x += (dx / d) * sp * dt;
    e.y += (dy / d) * sp * dt;
    if (d < e.r + 8) {
      p.hp -= 30 * dt;
      state.shake = Math.min(0.1, state.shake + 0.02);
    }
  }

  for (const pr of state.projectiles) {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(pr.x - e.x, pr.y - e.y) < e.r + 4) {
        damageEnemy(e, pr.dmg, pr.x, pr.y);
        pr.life = 0;
        break;
      }
    }
  }
  state.projectiles = state.projectiles.filter((x) => x.life > 0);
  state.enemies = state.enemies.filter((e) => e.hp > 0);

  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const m = state.pickups[i];
    if (Math.hypot(m.x - p.x, m.y - p.y) < MILK_TEA_PICKUP_R) {
      p.hp = Math.min(p.maxHp, p.hp + MILK_TEA_HEAL);
      addPop(m.x, m.y - 12, "续命奶茶", "#ffc9e8");
      state.pickups.splice(i, 1);
    }
  }

  for (const pop of state.pops) {
    pop.t += dt;
    pop.y += pop.vy * dt;
  }
  state.pops = state.pops.filter((p) => p.t < p.life);

  for (const part of state.particles) {
    part.t += dt;
    part.x += part.vx * dt;
    part.y += part.vy * dt;
    part.vy += 180 * dt;
  }
  state.particles = state.particles.filter((p) => p.t < p.life);

  if (p.hp <= 0) {
    p.hp = 0;
    state.gameOver = true;
  }
}

function drawOffice() {
  ctx.fillStyle = "#2a2a3e";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#3d3d55";
  ctx.lineWidth = 1;
  const g = 20;
  for (let x = 0; x <= W; x += g) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += g) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#353548";
  for (let i = 0; i < 8; i++) {
    const x = ((i * 47 + (state.t * 8) | 0) % (W + 40)) - 20;
    ctx.fillRect(x, 24 + (i % 3) * 50, 28, 18);
  }
}

function drawPickups() {
  for (const m of state.pickups) {
    const bob = Math.sin(state.t * 4.5 + m.bob) * 2;
    const x = m.x;
    const y = m.y + bob;
    ctx.fillStyle = "#efebe9";
    ctx.strokeStyle = "#8d6e63";
    ctx.lineWidth = 1;
    ctx.fillRect(x - 6, y - 8, 12, 14);
    ctx.strokeRect(x - 6, y - 8, 12, 14);
    ctx.fillStyle = "#d7ccc8";
    ctx.fillRect(x - 5, y - 7, 10, 4);
    ctx.fillStyle = "#c8a882";
    ctx.fillRect(x - 4, y - 3, 8, 7);
    ctx.strokeStyle = "#e91e63";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 9);
    ctx.lineTo(x + 2, y - 15);
    ctx.stroke();
    ctx.fillStyle = "#5d4037";
    ctx.font = `600 8px ${FONT_UI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("奶茶", x, y + 9);
  }
}

function drawEntityCircle(x, y, r, color, stroke) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawSpriteCentered(key, x, y, dw, dh) {
  const img = sprites[key];
  if (!img || !img.complete || !img.naturalWidth) return false;
  ctx.drawImage(img, Math.round(x - dw / 2), Math.round(y - dh / 2), Math.round(dw), Math.round(dh));
  return true;
}

function drawEnemy(e) {
  const size = Math.max(18, Math.round(e.r * 2.4));
  const ok = drawSpriteCentered(e.id, e.x, e.y, size, size);
  if (!ok) drawEntityCircle(e.x, e.y, e.r, e.color, "#1a1a22");

  ctx.fillStyle = "#e8e6f0";
  ctx.font = `600 9px ${FONT_UI}`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const label = e.name.length > 12 ? `${e.name.slice(0, 11)}…` : e.name;
  ctx.fillText(label, e.x, e.y - size / 2 - 2);

  const ratio = Math.max(0, e.hp / e.maxHp);
  const barW = Math.min(28, size + 4);
  ctx.fillStyle = "#222";
  ctx.fillRect(e.x - barW / 2, e.y + size / 2 + 2, barW, 3);
  ctx.fillStyle = ratio > 0.4 ? "#4caf50" : "#e53935";
  ctx.fillRect(e.x - barW / 2, e.y + size / 2 + 2, barW * ratio, 3);
}

function drawPlayer() {
  const p = state.player;
  const size = 24;
  const ok = drawSpriteCentered("player", p.x, p.y, size, size);
  if (!ok) drawEntityCircle(p.x, p.y, 9, "#e0e0ff", "#6c6cff");
  ctx.strokeStyle = "#ffcc66";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.facing) * 16, p.y + Math.sin(p.facing) * 16);
  ctx.stroke();
}

function drawProjectiles() {
  for (const pr of state.projectiles) {
    if (pr.id === "laser") {
      ctx.strokeStyle = "#ff4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02);
      ctx.lineTo(pr.x, pr.y);
      ctx.stroke();
    } else if (pr.id === "hotcoffee") {
      drawEntityCircle(pr.x, pr.y, 4, "#8b4513", "#ffab40");
    } else {
      drawEntityCircle(pr.x, pr.y, 3, "#a5d6a7", "#2e7d32");
    }
  }
}

function drawPops() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pop of state.pops) {
    const k = 1 - pop.t / pop.life;
    const s = 10 + (1 - k) * 5;
    ctx.font = `700 ${s}px ${FONT_UI}`;
    ctx.fillStyle = pop.color;
    ctx.globalAlpha = k;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.strokeText(pop.text, pop.x, pop.y);
    ctx.fillText(pop.text, pop.x, pop.y);
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  for (const part of state.particles) {
    const k = 1 - part.t / part.life;
    ctx.fillStyle = part.color;
    ctx.globalAlpha = k;
    ctx.fillRect(part.x, part.y, 2, 2);
    ctx.globalAlpha = 1;
  }
}

function render() {
  syncCanvasSize();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyLogicalTransform();

  if (!spritesReady) {
    ctx.fillStyle = "#2a2a3e";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#c8c6d8";
    ctx.font = `600 13px ${FONT_UI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("加载素材…", W / 2, H / 2);
    return;
  }
  ctx.save();
  if (state.shake > 0) {
    const s = state.shake * 8;
    ctx.translate(rnd(-s, s), rnd(-s, s));
  }
  drawOffice();
  drawPickups();
  for (const e of state.enemies) drawEnemy(e);
  drawProjectiles();
  if (!state.gameOver || state.won) drawPlayer();
  drawParticles();
  drawPops();
  ctx.restore();
}

function updateGameoverOverlay() {
  const overlay = document.getElementById("gameover-overlay");
  const inner = overlay?.querySelector(".gameover-inner");
  const titleEl = document.getElementById("gameover-title");
  if (!overlay || !inner || !titleEl) return;

  if (state.gameOver) {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    if (state.won) {
      inner.classList.add("gameover-win");
      titleEl.textContent = "下班！今日幸存";
    } else {
      inner.classList.remove("gameover-win");
      titleEl.textContent = "被优化了";
    }
  } else {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    inner.classList.remove("gameover-win");
  }
}

function resetGame() {
  state.t = 0;
  state.wave = 1;
  state.spawnAcc = 0;
  state.player.x = W / 2;
  state.player.y = H / 2;
  state.player.hp = 100;
  state.player.maxHp = 100;
  state.player.weaponIndex = 0;
  state.player.facing = 0;
  state.player.stillTime = 0;
  state.player.lastVx = 0;
  state.player.lastVy = 0;
  state.enemies = [];
  state.pickups = [];
  state.projectiles = [];
  state.pops = [];
  state.particles = [];
  state.shake = 0;
  state.gameOver = false;
  state.won = false;
  state.skillResignLetter = true;
  state.allies = [{ cd: 0 }];
  weaponCd = 0;
  updateGameoverOverlay();
}

function hudDom() {
  const weaponEl = document.getElementById("weapon-hud");
  const skillEl = document.getElementById("skill-hud");
  if (!spritesReady) {
    document.getElementById("time").textContent = "加载中…";
    if (weaponEl) weaponEl.textContent = "";
    if (skillEl) {
      skillEl.textContent = "";
      skillEl.className = "";
    }
    return;
  }
  const left = Math.max(0, state.shiftEnd - state.t);
  document.getElementById("time").textContent = `下班倒计时 ${left.toFixed(0)}s`;
  document.getElementById("hp").textContent = `发量 ${state.player.hp | 0}/${state.player.maxHp}`;
  document.getElementById("wave").textContent = `压力波 ${state.wave}`;
  if (weaponEl) weaponEl.textContent = `${weapon().name} [Q/E 换武器]`;
  if (skillEl) {
    skillEl.textContent = `离职信 [R] ${state.skillResignLetter ? "全屏·就绪" : "已使用"}`;
    skillEl.className = state.skillResignLetter ? "skill-ready" : "skill-spent";
  }
  updateGameoverOverlay();
}

const btnRestart = document.getElementById("btn-restart");
if (btnRestart) {
  btnRestart.addEventListener("click", () => resetGame());
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  hudDom();
  requestAnimationFrame(frame);
}

state.allies.push({ cd: 0 });
loadSprites();
requestAnimationFrame(frame);
