// Mini jeu de voiture façon « Hill Climb Racing », dessiné dans un <canvas>.
// Physique volontairement loufoque, intégrée par Verlet : un châssis rigide
// (deux points d'ancrage), deux roues tenues chacune par un bras rigide et un
// ressort mou, et un pilote assis dans la cabine, qui se fait un peu secouer.
// La voiture est un gros pickup qui crache de la fumée ; à chaque gros choc,
// une de ses pièces se détache. La carrosserie touche le sol, et la piste a
// des rampes pour faire des flips.
// Usage : const game = Games.hill(canvas, { target: 500, onWin() {} });
//         game.destroy();

(function () {
  "use strict";

  const W = 600;            // largeur logique de la vue
  const H = 300;            // hauteur logique
  const PX_PER_M = 20;      // échelle : 20 px = 1 mètre
  const STEP = 1 / 120;     // pas fixe de la physique
  const GRAVITY = 600;      // px/s² (on flotte un peu)
  const WHEEL_R = 18;       // grosses roues de pickup
  const WHEELBASE = 80;
  const HEAD_R = 8;
  const MOTOR_ACCEL = 2150; // px/s² ajoutés aux roues au sol (elles ne portent que 2 points sur 5)
  const MAX_SPEED = 600;    // px/s
  const REVERSE_SPEED = 160;
  const BRAKE = 1800;
  const SUSP_HEIGHT = 12;   // distance ancrage-roue au repos, voiture posée
  const SUSP_REST = 18;     // longueur à vide du ressort (il s'écrase d'environ 6 px sous le poids)
  const SUSP_MIN = 4;       // butées de fin de course
  const SUSP_MAX = 30;
  const SUSP_SIDE = 8;      // jeu latéral maximum de la roue sous son ancrage
  const SUSP_K = 500;       // raideur (px/s² par px d'écrasement)
  const SUSP_DAMP = 8;      // amortissement (par seconde) : faible, ça rebondit
  const SEAT = [52, -58];   // place de la tête du pilote, repère de la voiture
  const SEAT_K = 1500;      // raideur qui ramène le pilote à sa place
  const SEAT_DAMP = 12;
  const SEAT_SLACK = 5;     // il ne s'écarte jamais de plus de 5 px de sa place
  const SEAT_Y = -40;       // plancher sur lequel tient le pilote
  const STACK = [36, -94];  // sortie de la cheminée d'échappement
  const SHOCK = 220;        // vitesse d'impact (px/s) qui arrache une pièce
  const SHOCK_COOLDOWN = 0.4; // s entre deux pièces perdues
  // Points de la carrosserie qui touchent le sol (repère de la voiture) ;
  // fatal : le toit de la cabine, juste au-dessus de la tête du pilote.
  const HULL = [
    [-35, -16], [-35, -40], [40, -16], [110, -16], [110, -36], [78, -42],
    [36, -82, true], [80, -82, true],
  ];
  const SCRAPE = 0.08;      // frottement de la carrosserie qui racle le sol
  const WHEEL_BOUNCE = 0.45; // part de la vitesse renvoyée quand une roue tape le sol
  const SPIN = 16;          // accélération angulaire en l'air (rad/s²)
  const FUEL_DRAIN = 3;     // % par seconde (un plein ≈ 33 s)
  const FUEL_EVERY = 2000;  // un bidon tous les 100 m
  const START_X = 120;
  const FLAT = 520;         // début de piste plat

  // Relief : sinusoïdes de plus en plus marquées au fil de la piste.
  // Toujours la même piste, pour que chaque essai soit comparable.
  // Rampes de tremplin : profil en quart de lune qui finit à 45°, puis redescente
  // en pente douce (pour ne pas rester perché sur l'arête en arrivant lentement).
  // m : position en mètres, h : hauteur en px. (Les bidons sont vers 78, 178, 278… m.)
  const RAMPS = [{ m: 60, h: 50 }, { m: 150, h: 70 }, { m: 250, h: 90 }, { m: 340, h: 80 }, { m: 430, h: 110 }]
    .map(({ m, h }) => {
      const x0 = START_X + WHEELBASE / 2 + m * PX_PER_M;
      return { x0, lip: x0 + 2 * h, x1: x0 + 3.5 * h, h };
    });
  function rampHeight(x) {
    for (const r of RAMPS) {
      if (x < r.x0 || x > r.x1) continue;
      if (x <= r.lip) { const u = (x - r.x0) / (r.lip - r.x0); return r.h * u * u; }
      return r.h * (r.x1 - x) / (r.x1 - r.lip);
    }
    return 0;
  }

  function ground(x) {
    return terrain(x) - rampHeight(x);
  }

  function terrain(x) {
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

  // Pièces détachables du pickup, dans le repère de la voiture (y négatif = vers le haut).
  // c : centre et r : rayon, pour la physique des débris ; top : dessinée devant le pilote.
  const PAINT = "#1f5fa8";
  const PARTS = [
    { c: [8, -29], r: 14, shapes: [{ fill: PAINT, rect: [-22, -40, 60, 22] }, { fill: "#174a85", rect: [-18, -36, 52, 3] }] }, // benne
    { c: [-25, -29], r: 6, shapes: [{ fill: "#174a85", rect: [-28, -40, 6, 22] }] }, // hayon
    { c: [58, -29], r: 12, shapes: [{ fill: PAINT, rect: [38, -40, 40, 22] }, { fill: "#222", rect: [66, -34, 6, 2] }] }, // portière
    { c: [91, -28], r: 12, shapes: [{ fill: PAINT, poly: [78, -18, 104, -18, 104, -36, 78, -42] }] }, // capot
    { c: [67, -52], r: 8, shapes: [{ fill: "rgba(170,220,255,.7)", poly: [62, -40, 78, -40, 70, -76, 62, -76] }] }, // pare-brise
    { c: [107, -25], r: 7, shapes: [{ fill: "#555", rect: [104, -36, 6, 20] }, { line: [104, -30, 110, -30] }, { line: [104, -22, 110, -22] }] }, // pare-buffle
    { c: [-31, -20], r: 4, shapes: [{ fill: "#999", rect: [-35, -24, 8, 8] }] }, // pare-chocs
    { c: [101, -31], r: 3, shapes: [{ fill: "#ffe066", circle: [101, -31, 3] }] }, // phare
    { c: [-27, -34], r: 3, shapes: [{ fill: "#ff5050", rect: [-29, -37, 3, 6] }] }, // feu arrière
    { c: [10, -49], r: 9, shapes: [{ fill: "#1a1a1a", circle: [10, -49, 9] }, { fill: "#888", circle: [10, -49, 4] }] }, // roue de secours
    { c: [20, -21], r: 5, shapes: [{ fill: "#111", rect: [18, -28, 4, 14] }] }, // garde-boue
    { c: [83, -47], r: 4, shapes: [{ line: [78, -42, 82, -47] }, { fill: "#ccc", rect: [80, -52, 6, 5] }] }, // rétroviseur
    { c: [58, -80], r: 10, top: true, shapes: [{ fill: PAINT, rect: [36, -82, 44, 4] }] }, // toit de cabine
    { c: [57, -86], r: 8, top: true, shapes: [{ fill: "#222", rect: [40, -89, 34, 5] }, { fill: "#ffe066", circle: [47, -86, 2] }, { fill: "#ffe066", circle: [57, -86, 2] }, { fill: "#ffe066", circle: [67, -86, 2] }] }, // rampe de phares
    { c: [77, -93], r: 5, top: true, shapes: [{ line: [76, -82, 80, -104] }, { fill: "#ff3030", circle: [80, -104, 2.5] }] }, // antenne
  ];

  function create(canvas, { target, onWin }) {
    const ctx = canvas.getContext("2d");
    const finishX = START_X + WHEELBASE / 2 + target * PX_PER_M;
    let state = "ready"; // ready | running | over | won
    let rear, front, head, bodyRear, bodyFront, links, springs, attached, debris, smoke, impact, shockWait, roofHit, airSpin, lastAngle, flipText, flipAt, fuel, cans, best, stalled, overReason, overAt, camX, camY, acc, lastTime, raf;
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
      head = point(START_X + SEAT[0], y + SEAT[1]);
      bodyRear = point(START_X, y - SUSP_HEIGHT);
      bodyFront = point(START_X + WHEELBASE, y - SUSP_HEIGHT);
      // Châssis rigide + bras de suspension (chaque roue pivote autour de l'ancrage opposé).
      links = [[bodyRear, bodyFront], [rear, bodyFront], [front, bodyRear]]
        .map(([a, b]) => [a, b, Math.hypot(a.x - b.x, a.y - b.y)]);
      springs = [[bodyRear, rear], [bodyFront, front]];
      attached = PARTS.map((_, i) => i);
      debris = [];
      smoke = [];
      shockWait = 0;
      airSpin = 0;
      lastAngle = 0;
      flipText = "";
      flipAt = -1e9;
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

    // Ressort amorti entre l'ancrage et la roue, la force est partagée entre les deux.
    function applySprings(dt) {
      for (const [a, w] of springs) {
        const dx = w.x - a.x, dy = w.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const vrel = ((w.x - w.px) - (a.x - a.px)) * ux + ((w.y - w.py) - (a.y - a.py)) * uy;
        const f = (SUSP_K * (SUSP_REST - d) - SUSP_DAMP * vrel / dt) * dt * dt / 2;
        a.x -= ux * f; a.y -= uy * f;
        w.x += ux * f; w.y += uy * f;
      }
    }

    // Butées, dans le repère du châssis : la roue reste toujours sous son ancrage
    // (même après un gros choc, elle ne peut pas basculer de l'autre côté du bras).
    function limitSprings() {
      for (const [a, w] of springs) {
        const f = frame();
        const dx = w.x - a.x, dy = w.y - a.y;
        const lx = dx * f.ux + dy * f.uy, ly = dx * f.nx + dy * f.ny;
        const tx = Math.min(SUSP_SIDE, Math.max(-SUSP_SIDE, lx));
        const ty = Math.min(SUSP_MAX, Math.max(SUSP_MIN, ly));
        if (tx === lx && ty === ly) continue;
        const cx = ((tx - lx) * f.ux + (ty - ly) * f.nx) / 2;
        const cy = ((tx - lx) * f.uy + (ty - ly) * f.ny) / 2;
        a.x -= cx; a.y -= cy;
        w.x += cx; w.y += cy;
      }
    }

    // Repère de la voiture : origine là où serait la roue arrière voiture posée,
    // u le long de la voiture, n vers le bas de la voiture.
    function frame() {
      const dx = bodyFront.x - bodyRear.x, dy = bodyFront.y - bodyRear.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      return { ux, uy, nx: -uy, ny: ux, ox: bodyRear.x - uy * SUSP_HEIGHT, oy: bodyRear.y + ux * SUSP_HEIGHT };
    }

    // Le pilote est ramené à son siège par un ressort raide : il se fait
    // secouer dans les chocs mais reste à sa place. La voiture encaisse la réaction.
    function seatDriver(dt) {
      const f = frame();
      const sx = f.ox + f.ux * SEAT[0] + f.nx * SEAT[1], sy = f.oy + f.uy * SEAT[0] + f.ny * SEAT[1];
      const bvx = ((bodyRear.x - bodyRear.px) + (bodyFront.x - bodyFront.px)) / 2;
      const bvy = ((bodyRear.y - bodyRear.py) + (bodyFront.y - bodyFront.py)) / 2;
      const ox = head.x - sx, oy = head.y - sy;
      const ax = (-SEAT_K * ox - SEAT_DAMP * (head.x - head.px - bvx) / dt) * dt * dt;
      const ay = (-SEAT_K * oy - SEAT_DAMP * (head.y - head.py - bvy) / dt) * dt * dt;
      head.x += ax; head.y += ay;
      bodyRear.x -= ax / 2; bodyRear.y -= ay / 2;
      bodyFront.x -= ax / 2; bodyFront.y -= ay / 2;
      // Jamais plus loin que SEAT_SLACK de sa place
      const d = Math.hypot(head.x - sx, head.y - sy);
      if (d > SEAT_SLACK) {
        const k = SEAT_SLACK / d;
        head.x = sx + (head.x - sx) * k;
        head.y = sy + (head.y - sy) * k;
      }
    }

    // Une pièce au hasard s'envole.
    function detachPart() {
      const i = attached.splice(Math.floor(Math.random() * attached.length), 1)[0];
      const part = PARTS[i];
      const f = frame();
      debris.push({
        part,
        x: f.ox + f.ux * part.c[0] + f.nx * part.c[1],
        y: f.oy + f.uy * part.c[0] + f.ny * part.c[1],
        a: Math.atan2(f.uy, f.ux),
        vx: (bodyRear.x - bodyRear.px) / STEP + rand(-150, 150),
        vy: (bodyRear.y - bodyRear.py) / STEP - rand(150, 320),
        va: rand(-12, 12),
      });
    }

    function stepDebris(dt) {
      for (const p of debris) {
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.a += p.va * dt;
        const floor = ground(p.x) - p.part.r;
        if (p.y > floor) {
          p.y = floor;
          if (p.vy > 0) p.vy *= -0.35;
          p.vx *= 0.9;
          p.va *= 0.85;
        }
      }
      debris = debris.filter((p) => p.x > camX - 300);
    }

    // Fumée de la cheminée : noire et abondante à fond, plus il manque de pièces plus ça fume.
    function stepSmoke(dt) {
      const gas = state === "running" && gasOn() && fuel > 0;
      const rate = (gas ? 45 : 6) * (1 + (PARTS.length - attached.length) / 5);
      const f = frame();
      const sx = f.ox + f.ux * STACK[0] + f.nx * STACK[1], sy = f.oy + f.uy * STACK[0] + f.ny * STACK[1];
      const vx = state === "running" ? (bodyRear.x - bodyRear.px) / STEP : 0;
      for (let n = rate * dt + Math.random(); n >= 1 && smoke.length < 250; n--) {
        smoke.push({
          x: sx, y: sy,
          vx: vx * 0.3 - f.ux * rand(20, 60) + rand(-15, 15),
          vy: -rand(40, 90) - f.uy * 30,
          r: rand(3, 6), life: 0, max: rand(1, 1.8), dark: gas ? rand(0.1, 0.3) : rand(0.5, 0.7),
        });
      }
      for (const p of smoke) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt;
        p.vy -= 10 * dt;
        p.r += 14 * dt;
      }
      smoke = smoke.filter((p) => p.life < p.max);
    }

    // La carrosserie tape et racle le sol : chaque point de la coque enfoncé
    // repousse les deux ancrages, en proportion de sa position le long de la voiture.
    function collideBody(dt) {
      const f = frame();
      for (const [lx, ly, fatal] of HULL) {
        const wx = f.ox + f.ux * lx + f.nx * ly, wy = f.oy + f.uy * lx + f.ny * ly;
        const g = surface(wx, wy);
        if (g.d >= 0) continue;
        if (fatal) { roofHit = true; continue; }
        const t = lx / WHEELBASE;
        const weights = [[bodyRear, 1 - t], [bodyFront, t]];
        const c = -g.d / ((1 - t) ** 2 + t ** 2);
        let into = 0;
        for (const [a, w] of weights) into -= w * ((a.x - a.px) * g.nx + (a.y - a.py) * g.ny);
        impact = Math.max(impact, into / dt);
        for (const [a, w] of weights) {
          a.x += g.nx * c * w;
          a.y += g.ny * c * w;
          const vt = (a.x - a.px) * g.tx + (a.y - a.py) * g.ty;
          const k = SCRAPE * Math.min(1, Math.abs(w));
          a.px += g.tx * vt * k;
          a.py += g.ty * vt * k;
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
      const into = -((w.x - w.px) * g.nx + (w.y - w.py) * g.ny) / dt;
      impact = Math.max(impact, into);
      const push = WHEEL_R - g.d;
      w.x += g.nx * push;
      w.y += g.ny * push;

      // Vitesse (en px par pas) décomposée selon le sol.
      const vx = w.x - w.px, vy = w.y - w.py;
      let vn = vx * g.nx + vy * g.ny;
      let vt = vx * g.tx + vy * g.ty;
      if (vn < 0) vn *= -WHEEL_BOUNCE; // boing
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
      const parts = [rear, front, bodyRear, bodyFront, head];

      for (const p of parts) {
        const vx = (p.x - p.px) * 0.999, vy = (p.y - p.py) * 0.999;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * dt * dt;
      }
      applySprings(dt);

      // Accélérer cabre la voiture, freiner la fait piquer du nez
      // (surtout en l'air, comme dans le vrai jeu).
      const spin = (gas ? 1 : 0) - (brake ? 1 : 0);
      if (spin) {
        const airborne = !rear.contact && !front.contact;
        const k = spin * SPIN * (airborne ? 1 : 0.3) * dt * dt;
        const cx = parts.reduce((s, p) => s + p.x, 0) / parts.length;
        const cy = parts.reduce((s, p) => s + p.y, 0) / parts.length;
        for (const p of parts) {
          const dx = p.x - cx, dy = p.y - cy;
          p.x += dy * k;
          p.y -= dx * k;
        }
      }

      solveLinks(4);
      limitSprings();
      impact = 0;
      roofHit = false;
      collideWheel(rear, gas, brake, dt);
      collideWheel(front, gas, brake, dt);
      collideBody(dt);
      solveLinks(3);
      limitSprings();
      seatDriver(dt);

      // Gros choc : une pièce s'en va
      shockWait = Math.max(0, shockWait - dt);
      if (impact > SHOCK && shockWait === 0 && attached.length) {
        detachPart();
        shockWait = SHOCK_COOLDOWN;
      }
      stepDebris(dt);

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

      // Flips : on compte les tours faits en l'air, annoncés à l'atterrissage
      const angle = Math.atan2(bodyFront.y - bodyRear.y, bodyFront.x - bodyRear.x);
      let da = angle - lastAngle;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      lastAngle = angle;
      if (!rear.contact && !front.contact) {
        airSpin += da;
      } else {
        const flips = Math.floor((Math.abs(airSpin) + 0.8) / (2 * Math.PI));
        if (flips > 0) {
          flipText = `${airSpin < 0 ? "BACKFLIP" : "FRONTFLIP"}${flips > 1 ? ` x${flips}` : ""} !!!`;
          flipAt = performance.now();
        }
        airSpin = 0;
      }

      // Fin de partie
      if (roofHit) return end("Sur le toit !");
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

    function drawRamps() {
      for (const r of RAMPS) {
        if (r.x1 < camX - 10 || r.x0 > camX + W + 10) continue;
        ctx.beginPath();
        ctx.moveTo(r.x0 - camX, terrain(r.x0) - camY);
        for (let x = r.x0; x <= r.x1; x += 4) ctx.lineTo(x - camX, ground(x) - camY);
        ctx.lineTo(r.x1 - camX, terrain(r.x1) - camY);
        for (let x = r.x1; x >= r.x0; x -= 4) ctx.lineTo(x - camX, terrain(x) - camY);
        ctx.closePath();
        ctx.fillStyle = "#c8873a";
        ctx.fill();
        ctx.strokeStyle = "#5a3a1a";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Bord du tremplin en rayures jaunes et noires
        const lx = r.lip - camX, ly = ground(r.lip) - camY;
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? "#111" : "#ffd400";
          ctx.fillRect(lx - 3, ly + i * 6, 6, 6);
        }
      }
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
      // Crampons tout-terrain
      for (let i = 0; i < 12; i++) {
        const a = w.spin + (i * Math.PI) / 6;
        ctx.save();
        ctx.translate(x + Math.cos(a) * WHEEL_R, y + Math.sin(a) * WHEEL_R);
        ctx.rotate(a);
        ctx.fillRect(-2, -3, 4, 6);
        ctx.restore();
      }
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

    // Ressort en zigzag entre deux points (coordonnées écran).
    function drawSpring(x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d * 4, ny = dx / d * 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      for (let i = 1; i < 6; i++) {
        const t = i / 6, side = i % 2 ? 1 : -1;
        ctx.lineTo(x1 + dx * t + nx * side, y1 + dy * t + ny * side);
      }
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Dessine une pièce dans le repère courant.
    function drawShapes(shapes) {
      ctx.strokeStyle = "#000";
      for (const sh of shapes) {
        ctx.beginPath();
        if (sh.line) {
          ctx.strokeStyle = "#222";
          ctx.lineWidth = 2;
          ctx.moveTo(sh.line[0], sh.line[1]);
          ctx.lineTo(sh.line[2], sh.line[3]);
          ctx.stroke();
          ctx.strokeStyle = "#000";
          continue;
        }
        if (sh.rect) ctx.rect(...sh.rect);
        if (sh.circle) ctx.arc(sh.circle[0], sh.circle[1], sh.circle[2], 0, Math.PI * 2);
        if (sh.poly) {
          ctx.moveTo(sh.poly[0], sh.poly[1]);
          for (let i = 2; i < sh.poly.length; i += 2) ctx.lineTo(sh.poly[i], sh.poly[i + 1]);
          ctx.closePath();
        }
        ctx.fillStyle = sh.fill;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    }

    function drawDebris() {
      for (const p of debris) {
        if (p.x < camX - 40 || p.x > camX + W + 40) continue;
        ctx.save();
        ctx.translate(p.x - camX, p.y - camY);
        ctx.rotate(p.a);
        ctx.translate(-p.part.c[0], -p.part.c[1]);
        drawShapes(p.part.shapes);
        ctx.restore();
      }
    }

    function drawSmoke() {
      for (const p of smoke) {
        const g = Math.round(255 * p.dark);
        ctx.fillStyle = `rgba(${g},${g},${g},${0.55 * (1 - p.life / p.max)})`;
        ctx.beginPath();
        ctx.arc(p.x - camX, p.y - camY, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawCar() {
      const f = frame();
      const angle = Math.atan2(f.uy, f.ux);

      // Suspensions
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 2;
      for (const [a, w] of springs) drawSpring(a.x - camX, a.y - camY, w.x - camX, w.y - camY);

      ctx.save();
      ctx.translate(f.ox - camX, f.oy - camY);
      ctx.rotate(angle);
      // Châssis nu (le local y négatif = vers le haut) puis les pièces restantes
      ctx.fillStyle = "#333";
      ctx.fillRect(-26, -21, WHEELBASE + 54, 5);
      // Cheminée d'échappement (indestructible : il faut bien que ça fume)
      ctx.fillStyle = "#bbb";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.fillRect(STACK[0] - 3, STACK[1], 6, -STACK[1] - 21);
      ctx.strokeRect(STACK[0] - 3, STACK[1], 6, -STACK[1] - 21);
      for (const i of attached) if (!PARTS[i].top) drawShapes(PARTS[i].shapes);

      // Montant arrière de la cabine
      ctx.strokeStyle = "#174a85";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(38, -40); ctx.lineTo(38, -78);
      ctx.stroke();

      // Pilote sur son siège, mains sur le volant
      const rx = head.x - f.ox, ry = head.y - f.oy;
      const lx = rx * f.ux + ry * f.uy, ly = rx * f.nx + ry * f.ny;
      ctx.strokeStyle = "#1c4fd0";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(lx, ly + HEAD_R); ctx.lineTo(SEAT[0] - 2, SEAT_Y);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lx, ly + HEAD_R + 4); ctx.lineTo(SEAT[0] + 10, SEAT_Y - 8);
      ctx.stroke();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SEAT[0] + 10, SEAT_Y - 12); ctx.lineTo(SEAT[0] + 12, SEAT_Y - 4);
      ctx.stroke();
      // Tête (le point qui ne doit pas toucher le sol)
      ctx.fillStyle = "#ffd2a8";
      ctx.beginPath();
      ctx.arc(lx, ly, HEAD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.arc(lx, ly, HEAD_R + 1, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, HEAD_R + 1, 0, Math.PI * 2);
      ctx.stroke();

      for (const i of attached) if (PARTS[i].top) drawShapes(PARTS[i].shapes);
      ctx.restore();

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
      text(attached.length ? `PIÈCES ${attached.length}/${PARTS.length}` : "DÉSOSSÉE !", 12, 48, 13, "left",
        attached.length > 3 ? "#fff" : "#ff5050");

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

      const since = performance.now() - flipAt;
      if (since < 1200) {
        ctx.save();
        ctx.translate(W / 2, 70);
        ctx.rotate(Math.sin(since / 60) * 0.08);
        text(flipText, 0, 0, 28 + 6 * Math.max(0, 1 - since / 200), "center", "#ffd400");
        ctx.restore();
      }

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
      drawRamps();
      drawProps();
      drawDebris();
      drawSmoke();
      drawCar();
      drawHud();
    }

    // ---------- Boucle ----------

    function loop(now) {
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (state === "running" || state === "ready") stepSmoke(dt);
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
