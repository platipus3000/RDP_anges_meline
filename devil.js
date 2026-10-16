// Mini jeu de plateforme « piégé » (inspiré de Level Devil), dessiné dans un <canvas>.
// Le but : atteindre la porte. Le problème : le niveau triche (sol qui
// s'effondre, pics qui surgissent, porte qui s'enfuit, plafond qui tombe).
// On meurt, on recommence le niveau, on apprend les pièges.
// Usage : const game = Games.devil(canvas, { target: 3, onWin() {} });
//         game.destroy();

(function () {
  "use strict";

  const W = 600;
  const H = 300;
  const FLOOR = 250;        // ordonnée du sol
  const STEP = 1 / 120;     // pas fixe de la physique
  const GRAVITY = 1800;     // px/s²
  const JUMP = 560;         // vitesse initiale du saut, px/s
  const SHORT_HOP = 260;    // vitesse plafond si on relâche tôt
  const RUN = 190;          // vitesse de déplacement, px/s
  const COYOTE = 0.08;      // on peut encore sauter juste après avoir quitté le bord
  const BUFFER = 0.1;       // un appui un peu trop tôt compte quand même
  const DOOR_SPEED = 520;   // vitesse de la porte qui s'enfuit
  const PW = 14, PH = 20;   // taille du personnage
  const INK = "#1d1d1d";

  // ---------- Niveaux ----------
  // Chaque niveau est recréé à neuf à chaque essai : les pièges se rejouent
  // toujours de la même façon, c'est ce qui permet de les apprendre.

  const solid = (x, y, w, h, extra) => ({ x, y, w, h, vy: 0, falling: false, ...extra });
  const spikes = (x, w) => ({ x, w, h: 14, rise: 0, shown: false });
  const door = (x) => ({ x, y: FLOOR - 36, w: 24, h: 36, tx: x });

  const LEVELS = [
    () => {
      const trapFloor = solid(260, FLOOR, 80, 50);
      const sp = spikes(440, 30);
      return {
        color: "#f4a259",
        start: 40,
        solids: [solid(0, FLOOR, 260, 50), trapFloor, solid(340, FLOOR, 260, 50)],
        spikes: [sp],
        door: door(548),
        traps: [
          { when: (p) => p.x + PW > 275 && p.x < 340, run: () => { trapFloor.falling = true; } },
          { when: (p) => p.x > 395, run: () => { sp.shown = true; } },
        ],
      };
    },
    () => {
      const crusher = solid(180, -70, 50, 60, { crusher: true });
      const sp = spikes(300, 40);
      const lvl = {
        color: "#8ecae6",
        start: 40,
        solids: [solid(0, FLOOR, 600, 50), crusher],
        spikes: [sp],
        door: door(520),
        fled: false,
      };
      lvl.traps = [
        { when: (p) => p.x > 450, run: () => { lvl.door.tx = 90; lvl.fled = true; } },
        { when: (p) => lvl.fled && p.x < 400, run: () => { sp.shown = true; } },
        { when: (p) => lvl.fled && p.x < 260, run: () => { crusher.falling = true; crusher.vy = 300; } },
      ];
      return lvl;
    },
    () => {
      const crusher = solid(360, -70, 44, 60, { crusher: true });
      const trapFloor = solid(470, FLOOR, 60, 50);
      return {
        color: "#b5e48c",
        start: 40,
        solids: [solid(0, FLOOR, 200, 50), solid(280, FLOOR, 190, 50), trapFloor, solid(530, FLOOR, 70, 50), crusher],
        spikes: [],
        door: door(562),
        traps: [
          { when: (p) => p.x > 330, run: () => { crusher.falling = true; crusher.vy = 300; } },
          { when: (p) => p.x + PW > 478, run: () => { trapFloor.falling = true; } },
        ],
      };
    },
  ];

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function create(canvas, { target, onWin }) {
    const ctx = canvas.getContext("2d");
    const levelCount = Math.max(1, Math.min(target || LEVELS.length, LEVELS.length));
    let state = "ready"; // ready | running | dead | next | won
    let levelIndex = 0, deaths = 0, lvl, player, particles, timer, acc, lastTime, raf;
    const keys = { left: false, right: false, jump: false };
    const pointers = new Map(); // pointerId -> "left" | "right" | "jump"

    function setupCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.aspectRatio = `${W} / ${H}`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function loadLevel() {
      lvl = LEVELS[levelIndex]();
      lvl.traps.forEach((t) => { t.done = false; });
      player = { x: lvl.start, y: FLOOR - PH, w: PW, h: PH, vy: 0, onGround: true, coyote: 0, buffer: 0, face: 1 };
      particles = [];
      acc = 0;
    }

    const held = (kind) => keys[kind] || [...pointers.values()].includes(kind);

    function die() {
      state = "dead";
      deaths++;
      timer = 0.7;
      particles = Array.from({ length: 10 }, () => ({
        x: player.x + PW / 2, y: player.y + PH / 2,
        vx: (Math.random() - 0.5) * 360, vy: -Math.random() * 380 - 60,
      }));
    }

    function step(dt) {
      // Pièges
      for (const t of lvl.traps) {
        if (!t.done && t.when(player)) { t.done = true; t.run(); }
      }

      // Décor mobile
      for (const s of lvl.solids) {
        if (!s.falling) continue;
        s.vy += (s.crusher ? 2600 : GRAVITY) * dt;
        s.y += s.vy * dt;
        if (s.crusher) {
          // Le bloc s'arrête sur le premier sol rencontré.
          const below = lvl.solids.find((o) => o !== s && !o.crusher && s.x < o.x + o.w && s.x + s.w > o.x && s.y + s.h >= o.y && s.y < o.y);
          if (below) { s.y = below.y - s.h; s.vy = 0; s.falling = false; }
          else if (overlap(player, s)) return die();
        }
      }
      lvl.solids = lvl.solids.filter((s) => s.y < H + 100);
      for (const sp of lvl.spikes) if (sp.shown) sp.rise = Math.min(1, sp.rise + dt / 0.06);
      const d = lvl.door;
      if (d.x !== d.tx) d.x = d.x < d.tx ? Math.min(d.tx, d.x + DOOR_SPEED * dt) : Math.max(d.tx, d.x - DOOR_SPEED * dt);

      // Personnage
      const p = player;
      const dir = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
      if (dir) p.face = dir;
      p.x = Math.max(0, Math.min(W - PW, p.x + dir * RUN * dt));
      for (const s of lvl.solids) {
        if (overlap(p, s)) p.x = dir > 0 ? s.x - PW : dir < 0 ? s.x + s.w : p.x;
      }

      p.coyote = p.onGround ? COYOTE : p.coyote - dt;
      p.buffer -= dt;
      if (p.buffer > 0 && p.coyote > 0) {
        p.vy = -JUMP;
        p.buffer = 0;
        p.coyote = 0;
      }
      if (!held("jump") && p.vy < -SHORT_HOP) p.vy = -SHORT_HOP;

      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      p.onGround = false;
      for (const s of lvl.solids) {
        if (!overlap(p, s)) continue;
        if (p.vy >= 0) { p.y = s.y - PH; p.vy = 0; p.onGround = true; }
        else { p.y = s.y + s.h; p.vy = 0; }
      }

      // Mort ou victoire
      if (p.y > H + 20) return die();
      for (const sp of lvl.spikes) {
        if (sp.rise > 0.5 && overlap(p, { x: sp.x + 3, y: FLOOR - sp.h * sp.rise + 3, w: sp.w - 6, h: sp.h })) return die();
      }
      // La porte ne compte que lorsqu'elle est immobile (sinon, en s'enfuyant,
      // elle traverserait le joueur et le ferait gagner par accident).
      if (d.x === d.tx && overlap({ x: p.x + 4, y: p.y, w: PW - 8, h: PH }, d)) {
        if (levelIndex + 1 >= levelCount) {
          state = "won";
          onWin && onWin();
        } else {
          state = "next";
          timer = 0.9;
        }
      }
    }

    function update(dt) {
      if (state === "running") {
        acc += dt;
        while (acc >= STEP && state === "running") { step(STEP); acc -= STEP; }
      } else if (state === "dead") {
        for (const q of particles) { q.vy += GRAVITY * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
        timer -= dt;
        if (timer <= 0) { loadLevel(); state = "running"; }
      } else if (state === "next") {
        timer -= dt;
        if (timer <= 0) { levelIndex++; loadLevel(); state = "running"; }
      }
    }

    // ---------- Dessin ----------

    function text(str, x, y, size, align, color) {
      ctx.font = `bold ${size}px "Comic Sans MS", "Comic Sans", "Chalkboard SE", cursive`;
      ctx.textAlign = align || "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color || "#fff";
      ctx.fillText(str, x, y);
    }

    function drawPlayer() {
      const p = player;
      ctx.fillStyle = INK;
      ctx.fillRect(p.x, p.y, PW, PH - 4);
      ctx.fillRect(p.x + 2, p.y + PH - 4, 3, 4); // jambes
      ctx.fillRect(p.x + PW - 5, p.y + PH - 4, 3, 4);
      ctx.fillStyle = "#fff";
      const ex = p.face > 0 ? p.x + 7 : p.x + 2;
      ctx.fillRect(ex, p.y + 4, 3, 4);
      ctx.fillRect(ex + 4, p.y + 4, 1, 4);
    }

    function drawDoor() {
      const d = lvl.door;
      ctx.fillStyle = INK;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = "#fff6e0";
      ctx.fillRect(d.x + 4, d.y + 4, d.w - 8, d.h - 4);
      ctx.fillStyle = INK;
      ctx.fillRect(d.x + d.w - 9, d.y + d.h / 2, 3, 3);
    }

    function drawSpikes(sp) {
      if (sp.rise <= 0) return;
      ctx.fillStyle = INK;
      const n = Math.max(1, Math.round(sp.w / 10));
      const tw = sp.w / n, top = FLOOR - sp.h * sp.rise;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        ctx.moveTo(sp.x + i * tw, FLOOR);
        ctx.lineTo(sp.x + i * tw + tw / 2, top);
        ctx.lineTo(sp.x + (i + 1) * tw, FLOOR);
      }
      ctx.fill();
    }

    function drawControls() {
      const button = (x, w, label, on) => {
        ctx.globalAlpha = on ? 0.55 : 0.25;
        ctx.fillStyle = "#000";
        ctx.fillRect(x, H - 46, w, 38);
        ctx.globalAlpha = 1;
        text(label, x + w / 2, H - 20, 16);
      };
      button(8, 84, "◀", held("left"));
      button(108, 84, "▶", held("right"));
      button(W - 128, 120, "SAUTER", held("jump"));
    }

    function draw() {
      ctx.fillStyle = lvl.color;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = INK;
      for (const s of lvl.solids) ctx.fillRect(s.x, s.y, s.w, s.h);
      lvl.spikes.forEach(drawSpikes);
      drawDoor();

      if (state === "dead") {
        ctx.fillStyle = INK;
        for (const q of particles) ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      } else {
        drawPlayer();
      }

      text(`NIVEAU ${levelIndex + 1} / ${levelCount}`, 12, 28, 18, "left");
      text(`💀 ${deaths}`, W - 12, 28, 18, "right");
      drawControls();

      if (state === "ready") {
        text("Atteins la porte… si tu peux.", W / 2, 100, 22);
        text("← → pour bouger, ↑ ou Espace pour sauter", W / 2, 128, 14);
        text("Appuie pour commencer", W / 2, 150, 14);
      } else if (state === "next") {
        text(`NIVEAU ${levelIndex + 2}`, W / 2, 110, 28, "center", "#ffd400");
      } else if (state === "won") {
        text("TU AS VAINCU LE DIABLE !", W / 2, 104, 24, "center", "#ffd400");
        text(`en ${deaths} mort${deaths > 1 ? "s" : ""}`, W / 2, 132, 15);
      }
    }

    function loop(now) {
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      update(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function press(kind) {
      if (state === "ready") state = "running";
      if (kind === "jump" && state === "running") player.buffer = BUFFER;
    }

    // ---------- Commandes ----------

    const KEYMAP = {
      ArrowLeft: "left", a: "left", A: "left", q: "left", Q: "left",
      ArrowRight: "right", d: "right", D: "right",
      ArrowUp: "jump", " ": "jump", Spacebar: "jump", w: "jump", W: "jump", z: "jump", Z: "jump",
    };
    function ignored(e) {
      return e.ctrlKey || e.metaKey || e.altKey ||
        (e.target instanceof HTMLElement && e.target !== canvas && e.target.closest("input, textarea, button, a"));
    }
    function onKeyDown(e) {
      const kind = KEYMAP[e.key];
      if (!kind || ignored(e)) return;
      e.preventDefault();
      keys[kind] = true;
      if (!e.repeat) press(kind);
    }
    function onKeyUp(e) {
      const kind = KEYMAP[e.key];
      if (kind) keys[kind] = false;
    }
    // Écran tactile : les zones correspondent aux boutons dessinés en bas.
    function zone(e) {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      if (x < 100) return "left";
      if (x < 200) return "right";
      if (x > W - 200) return "jump";
      return null;
    }
    function onPointerDown(e) {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      const kind = zone(e);
      if (kind) pointers.set(e.pointerId, kind);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* rien */ }
      press(kind);
    }
    function onPointerUp(e) { pointers.delete(e.pointerId); }
    function onBlur() { keys.left = keys.right = keys.jump = false; pointers.clear(); }
    const onContextMenu = (e) => e.preventDefault();

    setupCanvas();
    loadLevel();
    lastTime = null;
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", onContextMenu);

    return {
      destroy() {
        cancelAnimationFrame(raf);
        state = "won";
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("contextmenu", onContextMenu);
      },
    };
  }

  window.Games = Object.assign(window.Games || {}, { devil: create });
})();
