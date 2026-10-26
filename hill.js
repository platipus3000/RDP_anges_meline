// Mini jeu de voiture façon « Hill Climb Racing », dessiné dans un <canvas>.
// Physique simple : trois points (roue arrière, roue avant, tête du pilote)
// reliés en triangle rigide, intégrés par Verlet.
// Usage : const game = Games.hill(canvas, { target: 500, onWin() {} });
//         game.destroy();

(function () {
  "use strict";

  const W = 600;            // largeur logique de la vue
  const H = 300;            // hauteur logique
  const PX_PER_M = 20;      // échelle : 20 px = 1 mètre
  const STEP = 1 / 120;     // pas fixe de la physique
  const GRAVITY = 900;      // px/s²
  const WHEEL_R = 14;
  const WHEELBASE = 64;
  const HEAD_R = 8;
  const MOTOR_ACCEL = 950;  // px/s² ajoutés aux roues au sol
  const MAX_SPEED = 480;    // px/s
  const REVERSE_SPEED = 160;
  const BRAKE = 1100;
  const SPIN = 9;           // accélération angulaire en l'air (rad/s²)
  const FUEL_DRAIN = 3;     // % par seconde (un plein ≈ 33 s)
  const FUEL_EVERY = 2000;  // un bidon tous les 100 m
  const START_X = 120;
  const FLAT = 520;         // début de piste plat

  // Relief : sinusoïdes de plus en plus marquées au fil de la piste.
  // Toujours la même piste, pour que chaque essai soit comparable.
  function ground(x) {
    if (x < FLAT) return 0;
    const t = x - FLAT;
    const grow = Math.min(1, t / 700) * Math.min(1.4, 1 + t / 4000);
    return -grow * (
      38 * Math.sin(t / 210) +
      14 * Math.sin(t / 83 + 1.3) +
      4 * Math.sin(t / 37 + 0.4)
    ) - t * 0.035; // la piste monte doucement dans l'ensemble
  }
  const slope = (x) => (ground(x + 1) - ground(x - 1)) / 2;

  const rand = (min, max) => min + Math.random() * (max - min);

  function create(canvas, { target, onWin }) {
    const ctx = canvas.getContext("2d");
    const finishX = START_X + WHEELBASE / 2 + target * PX_PER_M;
    let state = "ready"; // ready | running | over | won
    let rear, front, head, links, fuel, cans, best, stalled, overReason, overAt, camX, camY, acc, lastTime, raf;
    const keys = { gas: false, brake: false };
    const pointers = new Map(); // pointerId -> "gas" | "brake"

    const clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 160 + rand(0, 80), y: rand(20, 90) }));

    function setupCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.aspectRatio = `${W} / ${H}`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const point = (x, y) => ({ x, y, px: x, py: y, spin: 0, contact: false });

    function reset() {
      const y = ground(START_X) - WHEEL_R;
      rear = point(START_X, y);
      front = point(START_X + WHEELBASE, y);
      head = point(START_X + 26, y - 46);
      links = [[rear, front], [rear, head], [front, head]].map(([a, b]) => [a, b, Math.hypot(a.x - b.x, a.y - b.y)]);
      fuel = 100;
      cans = [];
      for (let x = FLAT + FUEL_EVERY * 0.6; x < finishX - 200; x += FUEL_EVERY) cans.push({ x, taken: false });
      best = 0;
      stalled = 0;
      camX = START_X - W * 0.3;
      camY = y - H * 0.6;
      acc = 0;
    }

    const gasOn = () => keys.gas || [...pointers.values()].includes("gas");
    const brakeOn = () => keys.brake || [...pointers.values()].includes("brake");

    function solveLinks(iterations) {
      for (let i = 0; i < iterations; i++) {
        for (const [a, b, len] of links) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = (d - len) / d / 2;
          a.x += dx * k; a.y += dy * k;
          b.x -= dx * k; b.y -= dy * k;
        }
      }
    }

    // Distance signée d'un point au sol (positive au-dessus) et repère local.
    function surface(x, y) {
      const s = slope(x);
      const len = Math.hypot(1, s);
      return { d: (ground(x) - y) / len, nx: s / len, ny: -1 / len, tx: 1 / len, ty: s / len };
    }

    function collideWheel(w, gas, brake, dt) {
      const g = surface(w.x, w.y);
      w.contact = g.d < WHEEL_R + 1;
      if (g.d >= WHEEL_R) return;
      const push = WHEEL_R - g.d;
      w.x += g.nx * push;
      w.y += g.ny * push;

      // Vitesse (en px par pas) décomposée selon le sol.
      const vx = w.x - w.px, vy = w.y - w.py;
      let vn = vx * g.nx + vy * g.ny;
      let vt = vx * g.tx + vy * g.ty;
      if (vn < 0) vn *= -0.1; // presque pas de rebond
      const a = dt * dt;
      if (gas) {
        vt = Math.min(vt + MOTOR_ACCEL * a, Math.max(vt, MAX_SPEED * dt));
      } else if (brake) {
        vt = vt > 0 ? Math.max(0, vt - BRAKE * a) : Math.max(vt - MOTOR_ACCEL * 0.6 * a, Math.min(vt, -REVERSE_SPEED * dt));
      } else {
        vt *= 0.998;
      }
      w.px = w.x - (vt * g.tx + vn * g.nx);
      w.py = w.y - (vt * g.ty + vn * g.ny);
    }

    function step(dt) {
      const gas = gasOn() && fuel > 0;
      const brake = brakeOn();
      const parts = [rear, front, head];

      for (const p of parts) {
        const vx = (p.x - p.px) * 0.999, vy = (p.y - p.py) * 0.999;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * dt * dt;
      }

      // Accélérer cabre la voiture, freiner la fait piquer du nez
      // (surtout en l'air, comme dans le vrai jeu).
      const spin = (gas ? 1 : 0) - (brake ? 1 : 0);
      if (spin) {
        const airborne = !rear.contact && !front.contact;
        const k = spin * SPIN * (airborne ? 1 : 0.3) * dt * dt;
        const cx = (rear.x + front.x + head.x) / 3, cy = (rear.y + front.y + head.y) / 3;
        for (const p of parts) {
          const dx = p.x - cx, dy = p.y - cy;
          p.x += dy * k;
          p.y -= dx * k;
        }
      }

      solveLinks(4);
      collideWheel(rear, gas, brake, dt);
      collideWheel(front, gas, brake, dt);
      solveLinks(3);

      for (const w of [rear, front]) {
        const vt = (w.x - w.px); // approximation suffisante pour l'affichage
        w.spin += vt / WHEEL_R;
      }

      // Essence et bidons
      fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
      const cx = (rear.x + front.x) / 2;
      for (const can of cans) {
        if (!can.taken && Math.abs(can.x - cx) < 34) { can.taken = true; fuel = 100; }
      }

      best = Math.max(best, (cx - START_X - WHEELBASE / 2) / PX_PER_M);

      // Fin de partie
      if (surface(head.x, head.y).d < HEAD_R) return end("Aïe, la tête !");
      const speed = Math.hypot(rear.x - rear.px, rear.y - rear.py) / dt;
      stalled = fuel === 0 && speed < 15 ? stalled + dt : 0;
      if (stalled > 1.2) return end("Panne d'essence !");
      if (cx >= finishX) {
        state = "won";
        onWin && onWin();
      }
    }

    function end(reason) {
      state = "over";
      overReason = reason;
      overAt = performance.now();
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

    function drawGround() {
      const strip = (offset, color) => {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let sx = -4; sx <= W + 4; sx += 4) ctx.lineTo(sx, ground(camX + sx) - camY + offset);
        ctx.lineTo(W + 4, H);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      strip(0, "#3f9b1f");
      strip(7, "#8b5a2b");
      strip(40, "#6b4220");
    }

    function drawScenery() {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#3c8fe6");
      sky.addColorStop(1, "#bfe6ff");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "#fff";
      for (const c of clouds) {
        const x = ((c.x - camX * 0.1) % (W + 160) + W + 160) % (W + 160) - 80;
        ctx.fillRect(x, c.y, 50, 10);
        ctx.fillRect(x + 10, c.y - 8, 26, 8);
      }

      // Collines lointaines (parallaxe)
      ctx.fillStyle = "#8fcf7a";
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let sx = 0; sx <= W; sx += 8) {
        const wx = camX * 0.3 + sx;
        ctx.lineTo(sx, H * 0.62 + 25 * Math.sin(wx / 140) + 12 * Math.sin(wx / 53));
      }
      ctx.lineTo(W, H);
      ctx.fill();
    }

    function drawProps() {
      // Panneaux tous les 50 m
      ctx.textAlign = "center";
      for (let m = 50; m < target; m += 50) {
        const x = START_X + WHEELBASE / 2 + m * PX_PER_M - camX;
        if (x < -30 || x > W + 30) continue;
        const y = ground(x + camX) - camY;
        ctx.fillStyle = "#5a3a1a";
        ctx.fillRect(x - 2, y - 34, 4, 34);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 18, y - 46, 36, 16);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 18, y - 46, 36, 16);
        ctx.fillStyle = "#000";
        ctx.font = "bold 11px Tahoma, Verdana, sans-serif";
        ctx.fillText(`${m} m`, x, y - 34);
      }

      // Bidons d'essence
      for (const can of cans) {
        if (can.taken) continue;
        const x = can.x - camX;
        if (x < -20 || x > W + 20) continue;
        const y = ground(can.x) - camY;
        ctx.fillStyle = "#e01b1b";
        ctx.fillRect(x - 9, y - 26, 18, 22);
        ctx.fillStyle = "#222";
        ctx.fillRect(x - 3, y - 31, 6, 5);
        ctx.fillStyle = "#ffd400";
        ctx.font = "bold 10px Tahoma, Verdana, sans-serif";
        ctx.fillText("F", x, y - 11);
      }

      // Ligne d'arrivée
      const fx = finishX - camX;
      if (fx > -40 && fx < W + 40) {
        const fy = ground(finishX) - camY;
        ctx.fillStyle = "#333";
        ctx.fillRect(fx - 2, fy - 70, 4, 70);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 6; c++) {
            ctx.fillStyle = (r + c) % 2 ? "#000" : "#fff";
            ctx.fillRect(fx + 2 + c * 6, fy - 70 + r * 6, 6, 6);
          }
        }
      }
    }

    function drawWheel(w) {
      const x = w.x - camX, y = w.y - camY;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(x, y, WHEEL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#bbb";
      ctx.beginPath();
      ctx.arc(x, y, WHEEL_R * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = w.spin + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * WHEEL_R * 0.8, y + Math.sin(a) * WHEEL_R * 0.8);
        ctx.stroke();
      }
    }

    function drawCar() {
      const angle = Math.atan2(front.y - rear.y, front.x - rear.x);

      // Suspensions
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 3;

      ctx.save();
      ctx.translate(rear.x - camX, rear.y - camY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(4, -12);
      ctx.moveTo(WHEELBASE, 0); ctx.lineTo(WHEELBASE - 4, -12);
      ctx.stroke();
      // Carrosserie (le local y négatif = vers le haut)
      ctx.fillStyle = "#d42020";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-16, -8);
      ctx.lineTo(WHEELBASE + 16, -8);
      ctx.lineTo(WHEELBASE + 14, -20);
      ctx.lineTo(WHEELBASE - 8, -24);
      ctx.lineTo(10, -24);
      ctx.lineTo(-16, -22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Arceau
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(14, -24); ctx.lineTo(16, -52); ctx.lineTo(42, -46); ctx.lineTo(46, -24);
      ctx.stroke();
      // Pilote (corps)
      ctx.strokeStyle = "#1c4fd0";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(24, -24); ctx.lineTo(26, -38);
      ctx.stroke();
      ctx.restore();

      // Tête (le point qui ne doit pas toucher le sol)
      const hx = head.x - camX, hy = head.y - camY;
      ctx.fillStyle = "#ffd2a8";
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_R + 1, Math.PI + angle, Math.PI * 2 + angle);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_R + 1, 0, Math.PI * 2);
      ctx.stroke();

      drawWheel(rear);
      drawWheel(front);
    }

    function drawHud() {
      // Jauge d'essence
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(10, 10, 124, 20);
      ctx.fillStyle = fuel < 25 ? "#ff3030" : "#ffd400";
      ctx.fillRect(12, 12, 1.2 * fuel, 16);
      text("ESSENCE", 72, 25, 12);

      text(`${Math.floor(Math.min(best, target))} / ${target} m`, W - 10, 27, 18, "right");

      // Pédales
      const pedal = (x, label, on, color) => {
        ctx.globalAlpha = on ? 0.9 : 0.45;
        ctx.fillStyle = color;
        ctx.fillRect(x, H - 54, 80, 44);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, H - 54, 80, 44);
        ctx.globalAlpha = 1;
        text(label, x + 40, H - 26, 15);
      };
      pedal(10, "◀ FREIN", brakeOn(), "#c0392b");
      pedal(W - 90, "GAZ ▶", gasOn(), "#27ae60");

      if (state === "ready") {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.fillRect(0, 70, W, 74);
        text("Maintiens GAZ (→ ou droite de l'écran) pour rouler", W / 2, 100, 16);
        text("FREIN (← ou gauche) pour ralentir et pencher en avant", W / 2, 126, 14);
      } else if (state === "over") {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.fillRect(0, 70, W, 74);
        text(overReason, W / 2, 104, 26, "center", "#ffd400");
        text("Appuie sur GAZ pour réessayer", W / 2, 130, 14);
      } else if (state === "won") {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.fillRect(0, 70, W, 74);
        text("ARRIVÉE !!!", W / 2, 106, 30, "center", "#ffd400");
        text(`${target} m parcourus`, W / 2, 132, 14);
      }
    }

    function draw() {
      drawScenery();
      drawGround();
      drawProps();
      drawCar();
      drawHud();
    }

    // ---------- Boucle ----------

    function loop(now) {
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (state === "running") {
        acc += dt;
        while (acc >= STEP && state === "running") { step(STEP); acc -= STEP; }
        const cx = (rear.x + front.x) / 2, cy = (rear.y + front.y) / 2;
        camX = cx - W * 0.3;
        camY += (cy - H * 0.6 - camY) * Math.min(1, dt * 6);
      }
      draw();
      raf = requestAnimationFrame(loop);
    }

    function press(kind) {
      if (state === "won") return;
      if (state === "over") {
        if (kind !== "gas" || performance.now() - overAt < 500) return;
        reset();
      }
      if (state !== "running") state = "running";
    }

    // ---------- Commandes ----------

    const GAS_KEYS = new Set(["ArrowRight", "d", "D"]);
    const BRAKE_KEYS = new Set(["ArrowLeft", "a", "A", "q", "Q"]);
    function ignored(e) {
      return e.ctrlKey || e.metaKey || e.altKey ||
        (e.target instanceof HTMLElement && e.target !== canvas && e.target.closest("input, textarea, button, a"));
    }
    function onKeyDown(e) {
      const kind = GAS_KEYS.has(e.key) ? "gas" : BRAKE_KEYS.has(e.key) ? "brake" : null;
      if (!kind || ignored(e)) return;
      e.preventDefault();
      keys[kind] = true;
      if (!e.repeat) press(kind);
    }
    function onKeyUp(e) {
      if (GAS_KEYS.has(e.key)) keys.gas = false;
      if (BRAKE_KEYS.has(e.key)) keys.brake = false;
    }
    function onPointerDown(e) {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      const rect = canvas.getBoundingClientRect();
      const kind = e.clientX - rect.left > rect.width / 2 ? "gas" : "brake";
      pointers.set(e.pointerId, kind);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* rien */ }
      press(kind);
    }
    function onPointerUp(e) { pointers.delete(e.pointerId); }
    function onBlur() { keys.gas = keys.brake = false; pointers.clear(); }
    const onContextMenu = (e) => e.preventDefault();

    setupCanvas();
    reset();
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

  window.Games = Object.assign(window.Games || {}, { hill: create });
})();
