// Mini jeu du dinosaure (façon Chrome hors ligne), dessiné dans un <canvas>.
// Usage : const game = Games.dino(canvas, { target: 600, onWin() {} });
//         game.destroy();

(function () {
  "use strict";

  const W = 600;          // largeur logique du terrain
  const H = 170;          // hauteur logique
  const GROUND = 146;     // ordonnée du sol
  const PX = 2;           // taille d'un « pixel » du sprite
  const GRAVITY = 2400;   // px/s²
  const JUMP = 760;       // vitesse initiale du saut, px/s
  const SHORT_HOP = 320;  // vitesse plafond si on relâche tôt (petit saut)
  const FAST_FALL = 3000; // px/s² en plus si on se baisse en l'air
  const SPEED_START = 420;
  const SPEED_MAX = 900;
  const ACCEL = 14;       // px/s gagnés chaque seconde
  const BIRDS_FROM = 150; // score à partir duquel les oiseaux arrivent
  // Altitudes des oiseaux (bas de l'oiseau au-dessus du sol) :
  // bas = il faut sauter, milieu = il faut se baisser, haut = il passe au-dessus
  // de la tête… sauf si on saute.
  const BIRD_ALTS = [6, 24, 44];
  const POINTS_PER_PX = 1 / 36;
  const INK = "#535353";

  // Sprite du dinosaure : le corps, puis deux poses de pattes pour la course.
  const BODY = [
    "          ########  ",
    "         ## ####### ",
    "         ########## ",
    "         ########## ",
    "         #####      ",
    "         ########   ",
    "#       #####       ",
    "#      ######       ",
    "##   ##########     ",
    "###  ######## #     ",
    "############        ",
    "############        ",
    " ##########         ",
    "  ########          ",
    "   ######           ",
  ];
  const LEGS = [
    ["   ##  ##          ", "   #    ##         ", "   ##              "],
    ["   ##  ##          ", "   ##    #         ", "         ##        "],
    ["   ##  ##          ", "   #    #          ", "   ##   ##         "], // en l'air
  ];
  // Dinosaure baissé : plus long, beaucoup moins haut.
  const DUCK = [
    "                  ########",
    "#      ########### # #####",
    "##   ###############  ####",
    "#########################",
    " #############   ######  ",
    "  ###########            ",
    "   ########              ",
  ].map((r) => r.padEnd(26));
  const DUCK_LEGS = [
    ["   ##   ##               ", "   #     ##              "],
    ["   ##   ##               ", "    ##   #               "],
  ];
  const DINO_H = (BODY.length + 3) * PX;
  const DUCK_H = (DUCK.length + 2) * PX;
  const DINO_X = 8;

  function drawSprite(ctx, rows, x, y) {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "#") ctx.fillRect(x + c * PX, y + r * PX, PX, PX);
      }
    });
  }

  function drawCactus(ctx, x, w, h) {
    const trunk = Math.round(w * 0.36);
    const tx = x + Math.round((w - trunk) / 2);
    const top = GROUND - h;
    ctx.fillRect(tx, top, trunk, h);
    // bras gauche et droit
    const armY = top + Math.round(h * 0.3);
    ctx.fillRect(x, armY, Math.max(3, tx - x), 4);
    ctx.fillRect(x, armY - Math.round(h * 0.2), 4, Math.round(h * 0.2) + 4);
    const rx = tx + trunk;
    const ry = top + Math.round(h * 0.42);
    ctx.fillRect(rx, ry, x + w - rx, 4);
    ctx.fillRect(x + w - 4, ry - Math.round(h * 0.22), 4, Math.round(h * 0.22) + 4);
  }

  function drawBird(ctx, o, t) {
    const x = o.x, y = o.top;
    ctx.fillRect(x + 8, y + 9, 22, 6);   // corps
    ctx.fillRect(x + 2, y + 7, 8, 5);    // tête
    ctx.fillRect(x - 4, y + 9, 6, 2);    // bec
    ctx.fillRect(x + 28, y + 10, 6, 3);  // queue
    if (Math.floor(t * 6) % 2) ctx.fillRect(x + 13, y, 8, 9);   // aile haute
    else ctx.fillRect(x + 13, y + 15, 8, 7);                   // aile basse
  }

  function drawCloud(ctx, x, y) {
    ctx.fillRect(x + 8, y, 20, 4);
    ctx.fillRect(x + 4, y + 4, 32, 4);
    ctx.fillRect(x, y + 8, 46, 4);
  }

  const pad = (n) => String(Math.floor(n)).padStart(5, "0");
  const rand = (min, max) => min + Math.random() * (max - min);

  function create(canvas, { target, onWin }) {
    const ctx = canvas.getContext("2d");
    let state = "ready"; // ready | running | over | won
    let dino, obstacles, clouds, specks, speed, distance, nextGap, holding, lastTime, raf, overAt, legTimer;
    let duckKey = false;
    const pointers = new Map(); // pointerId -> "jump" | "duck"
    const duckHeld = () => duckKey || [...pointers.values()].includes("duck");

    function setupCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.aspectRatio = `${W} / ${H}`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    function reset() {
      dino = { y: 0, vy: 0, onGround: true, ducking: false };
      obstacles = [];
      clouds = [{ x: 120, y: 30 }, { x: 380, y: 52 }];
      specks = Array.from({ length: 24 }, () => ({ x: rand(0, W), y: GROUND + rand(4, 16), w: rand(1, 4) }));
      speed = SPEED_START;
      distance = 0;
      nextGap = 260;
      holding = false;
      legTimer = 0;
    }

    function spawnObstacle() {
      if (distance * POINTS_PER_PX > BIRDS_FROM && Math.random() < 0.3) {
        const alt = BIRD_ALTS[Math.floor(Math.random() * BIRD_ALTS.length)];
        obstacles.push({ kind: "bird", x: W + 10, w: 34, top: GROUND - alt - 22, bottom: GROUND - alt });
      } else {
        const count = speed > 430 && Math.random() < 0.45 ? (Math.random() < 0.45 ? 3 : 2) : 1;
        const big = Math.random() < 0.5;
        const unitW = big ? 22 : 15;
        const h = big ? rand(40, 48) : rand(28, 34);
        obstacles.push({ kind: "cactus", x: W + 10, w: unitW * count, unitW, count, h, top: GROUND - h, bottom: GROUND });
      }
      // Écart minimal : de quoi retomber et ressauter, même à pleine vitesse.
      const airTime = (2 * JUMP) / GRAVITY;
      nextGap = speed * airTime * 1.05 + rand(0, speed * 0.6);
    }

    // Boîtes de collision en unités de sprite (debout : tête + corps ; baissé : une seule).
    const BOXES = [
      { c0: 10, c1: 19, r0: 0, r1: 5 },
      { c0: 1, c1: 13, r0: 6, r1: 17 },
    ];
    const DUCK_BOXES = [{ c0: 1, c1: 25, r0: 1, r1: 8 }];
    function hits() {
      const boxes = dino.ducking ? DUCK_BOXES : BOXES;
      const dy = GROUND - (dino.ducking ? DUCK_H : DINO_H) - dino.y;
      return obstacles.some((o) => {
        const ox0 = o.x + 3, ox1 = o.x + o.w - 3, oy0 = o.top + 3, oy1 = o.bottom - 2;
        return boxes.some((b) => {
          const x0 = DINO_X + b.c0 * PX, x1 = DINO_X + b.c1 * PX;
          const y0 = dy + b.r0 * PX, y1 = dy + b.r1 * PX;
          return x0 < ox1 && x1 > ox0 && y1 > oy0 && y0 < oy1;
        });
      });
    }

    function update(dt) {
      speed = Math.min(SPEED_MAX, speed + ACCEL * dt);
      const move = speed * dt;
      distance += move;

      // Saut (se baisser en l'air fait retomber plus vite)
      const duck = duckHeld();
      dino.ducking = duck && dino.onGround;
      if (!dino.onGround) {
        if (!holding && dino.vy > SHORT_HOP) dino.vy = SHORT_HOP;
        dino.vy -= (GRAVITY + (duck ? FAST_FALL : 0)) * dt;
        dino.y += dino.vy * dt;
        if (dino.y <= 0) { dino.y = 0; dino.vy = 0; dino.onGround = true; }
      }
      legTimer += dt;

      // Obstacles
      obstacles.forEach((o) => { o.x -= o.kind === "bird" ? move + 40 * dt : move; });
      obstacles = obstacles.filter((o) => o.x + o.w > -10);
      nextGap -= move;
      if (nextGap <= 0) spawnObstacle();

      // Décor
      clouds.forEach((c) => { c.x -= move * 0.2; });
      clouds = clouds.filter((c) => c.x > -60);
      if (clouds.length < 3 && Math.random() < dt * 0.5) clouds.push({ x: W + 10, y: rand(18, 70) });
      specks.forEach((s) => { s.x -= move; if (s.x < -5) { s.x = W + rand(0, 40); s.y = GROUND + rand(4, 16); } });

      if (distance * POINTS_PER_PX >= target) {
        state = "won";
        draw();
        onWin && onWin();
        return;
      }
      if (hits()) {
        state = "over";
        overAt = performance.now();
      }
    }

    function text(str, x, y, size, align) {
      ctx.font = `bold ${size}px "Courier New", Courier, monospace`;
      ctx.textAlign = align || "center";
      ctx.fillText(str, x, y);
    }

    function draw() {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#c8c8c8";
      clouds.forEach((c) => drawCloud(ctx, c.x, c.y));

      ctx.fillStyle = INK;
      ctx.fillRect(0, GROUND, W, 2);
      specks.forEach((s) => ctx.fillRect(s.x, s.y, s.w, 1));
      obstacles.forEach((o) => {
        if (o.kind === "bird") return drawBird(ctx, o, legTimer);
        for (let i = 0; i < o.count; i++) drawCactus(ctx, o.x + i * o.unitW, o.unitW, o.h - (i % 2) * 6);
      });

      const frame = Math.floor(legTimer * 10) % 2;
      if (dino.ducking) {
        const dy = GROUND - DUCK_H;
        drawSprite(ctx, DUCK, DINO_X, dy);
        drawSprite(ctx, DUCK_LEGS[state === "running" ? frame : 0], DINO_X, dy + DUCK.length * PX);
      } else {
        drawStanding(frame);
      }

      ctx.fillStyle = INK;
      text(`${pad(distance * POINTS_PER_PX)} / ${pad(target)}`, W - 10, 22, 16, "right");

      if (state === "ready") {
        text("ESPACE / ↑ / droite de l'écran : sauter", W / 2, 62, 15);
        text("↓ / gauche de l'écran : se baisser", W / 2, 84, 15);
      } else if (state === "over") {
        text("G A M E   O V E R", W / 2, 62, 22);
        text("Appuie pour rejouer", W / 2, 88, 14);
      } else if (state === "won") {
        text("B R A V O  !", W / 2, 62, 24);
        text(`${target} points atteints`, W / 2, 88, 14);
      }
    }

    function drawStanding(frame) {
      const legs = !dino.onGround || state !== "running" ? LEGS[2] : LEGS[frame];
      const dy = GROUND - DINO_H - dino.y;
      drawSprite(ctx, BODY, DINO_X, dy);
      drawSprite(ctx, legs, DINO_X, dy + BODY.length * PX);
      if (state === "over") { // œil « X »
        ctx.fillStyle = "#fff";
        ctx.fillRect(DINO_X + 11 * PX, dy + PX, PX, PX);
        ctx.fillStyle = INK;
        ctx.fillRect(DINO_X + 10 * PX, dy, PX, PX);
        ctx.fillRect(DINO_X + 12 * PX, dy + 2 * PX, PX, PX);
      }
    }

    function loop(now) {
      if (state !== "running") return;
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      update(dt);
      draw();
      if (state === "running") raf = requestAnimationFrame(loop);
    }

    function press(kind) {
      if (kind === "duck") {
        // Se baisser démarre aussi la partie, sans sauter.
        if (state === "ready") { state = "running"; lastTime = null; raf = requestAnimationFrame(loop); }
        return;
      }
      holding = true;
      if (state === "won") return;
      if (state === "over") {
        if (performance.now() - overAt < 400) return; // évite de relancer par erreur
        reset();
      }
      if (state !== "running") {
        state = "running";
        lastTime = null;
        raf = requestAnimationFrame(loop);
      }
      if (dino.onGround && !duckHeld()) {
        dino.vy = JUMP;
        dino.onGround = false;
      }
    }

    function release() { holding = false; }

    const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "z"]);
    const DUCK_KEYS = new Set(["ArrowDown", "s", "S"]);
    function onKeyDown(e) {
      const kind = JUMP_KEYS.has(e.key) ? "jump" : DUCK_KEYS.has(e.key) ? "duck" : null;
      if (!kind || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, a") && e.target !== canvas) return;
      e.preventDefault();
      if (kind === "duck") duckKey = true;
      if (!e.repeat) press(kind);
    }
    function onKeyUp(e) {
      if (JUMP_KEYS.has(e.key)) release();
      if (DUCK_KEYS.has(e.key)) duckKey = false;
    }
    // Écran tactile : tiers gauche = se baisser, reste = sauter.
    function onPointerDown(e) {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      const rect = canvas.getBoundingClientRect();
      const kind = e.clientX - rect.left < rect.width / 3 ? "duck" : "jump";
      pointers.set(e.pointerId, kind);
      press(kind);
    }
    function onPointerUp(e) {
      if (pointers.get(e.pointerId) === "jump") release();
      pointers.delete(e.pointerId);
    }

    setupCanvas();
    reset();
    draw();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return {
      destroy() {
        cancelAnimationFrame(raf);
        state = "won";
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      },
    };
  }

  window.Games = Object.assign(window.Games || {}, { dino: create });
})();
