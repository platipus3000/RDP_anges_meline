// Qui suis-je ? — logique de l'application.
// Les réponses ne sont jamais présentes en clair : on compare des empreintes
// SHA-256 puis on déchiffre l'indice avec une clé dérivée de la réponse.

(function () {
  "use strict";

  const STORAGE_KEY = "qui-suis-je:progress:v1";
  // Doit rester strictement identique à la version de tools/build-riddles.js.
  const PBKDF2_ITERATIONS = 150000;

  const $ = (id) => document.getElementById(id);
  const els = {
    progress: $("progress"),
    card: $("riddle-card"),
    kicker: $("riddle-kicker"),
    title: $("riddle-title"),
    question: $("riddle-question"),
    form: $("answer-form"),
    input: $("answer-input"),
    submit: $("answer-submit"),
    feedback: $("feedback"),
    hintBlock: $("hint-block"),
    hintToggle: $("hint-toggle"),
    hintText: $("hint-text"),
    finale: $("finale"),
    clues: $("clues"),
    loadError: $("load-error"),
    reset: $("reset"),
    gameBlock: $("game-block"),
    gameGoal: $("game-goal"),
    gameCanvas: $("game-canvas"),
    floatingGifs: $("floating-gifs"),
    picture: $("riddle-picture"),
    pictureImg: $("riddle-picture-img"),
    qcm: $("qcm"),
    popup: $("popup"),
    popupImg: $("popup-img"),
    popupText: $("popup-text"),
    popupOk: $("popup-ok"),
    whoForm: $("who-form"),
    whoInput: $("who-input"),
    whoFeedback: $("who-feedback"),
    whoWindow: $("who-window"),
    celebrate: $("celebrate"),
    celebrateTitle: $("celebrate-title"),
    celebrateImg: $("celebrate-img"),
    celebrateClose: $("celebrate-close"),
    confetti: $("confetti"),
    arcade: $("arcade"),
    arcadeButtons: $("arcade-buttons"),
    arcadeGame: $("arcade-game"),
    arcadeGoal: $("arcade-goal"),
    arcadeCanvas: $("arcade-canvas"),
  };

  let riddles = [];
  let identity = []; // [{ answerHash, payload }] : le prénom à deviner
  let progress = loadProgress();
  let checking = false;
  let game = null; // { riddleId, instance } quand un mini-jeu est affiché
  let arcadeGame = null; // { riddleId, instance } pour la salle d'arcade, après la fin

  // ---------- Normalisation & crypto ----------

  function normalize(text) {
    return String(text)
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  const enc = new TextEncoder();

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function fromBase64(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  }

  async function hashAnswer(id, normalized) {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(`qui-suis-je|${id}|${normalized}`));
    return toHex(digest);
  }

  async function decryptClue(normalized, payload) {
    const [version, salt, iv, data] = payload.split(".");
    if (version !== "v1") throw new Error("Format d'indice inconnu");
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(normalized), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromBase64(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(data));
    return new TextDecoder().decode(plain);
  }

  // Contenu déchiffré : un texte simple, ou du JSON (texte + image chiffrée).
  function parsePayload(plain) {
    if (plain.startsWith("{")) {
      try { return JSON.parse(plain); } catch (_) { /* c'était du texte */ }
    }
    return { text: plain };
  }

  // Les images privées sont chiffrées (AES-GCM, 12 octets d'IV en tête du fichier).
  const imageCache = new Map();
  function decryptImage(image) {
    if (!imageCache.has(image.file)) {
      imageCache.set(image.file, (async () => {
        const response = await fetch(image.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const key = await crypto.subtle.importKey("raw", fromBase64(image.key), "AES-GCM", false, ["decrypt"]);
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
        return URL.createObjectURL(new Blob([plain], { type: image.type }));
      })());
    }
    return imageCache.get(image.file);
  }

  // ---------- Progression (localStorage) ----------

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved.clues === "object") return saved;
    } catch (_) { /* stockage indisponible ou corrompu */ }
    return { clues: {} };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (_) { /* navigation privée : la partie ne sera simplement pas sauvegardée */ }
  }

  // La progression est indexée par l'empreinte de la réponse : si riddles.json
  // change, les anciens indices sont simplement ignorés.
  // Un indice enregistré est un texte (anciennes parties) ou { text, image }.
  const clueFor = (riddle) => progress.clues[riddle.answerHash];
  const clueText = (clue) => (typeof clue === "string" ? clue : clue.text);
  const currentIndex = () => riddles.findIndex((r) => clueFor(r) === undefined);

  // ---------- Affichage ----------

  function render({ freshId } = {}) {
    const index = currentIndex();
    const done = index === -1;

    els.progress.replaceChildren(
      ...riddles.map((r, i) => {
        const li = document.createElement("li");
        if (clueFor(r) !== undefined) li.className = "done";
        else if (i === index) li.className = "current";
        li.setAttribute("aria-label", `Énigme ${i + 1} : ${clueFor(r) !== undefined ? "résolue" : "à résoudre"}`);
        return li;
      })
    );

    els.clues.replaceChildren(
      ...riddles.map((r, i) => {
        const clue = clueFor(r);
        const li = document.createElement("li");
        li.className = "clue" + (clue !== undefined ? " unlocked" : "") + (r.id === freshId ? " fresh" : "");
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = clue !== undefined ? String(i + 1) : "🔒";
        const body = document.createElement("div");
        const text = document.createElement("p");
        text.textContent = clue !== undefined ? clueText(clue) : `Indice n°${i + 1} — résous l'énigme ${i + 1} pour le découvrir.`;
        body.append(text);
        if (clue?.image) body.append(clueFigure(clue.image));
        li.append(badge, body);
        return li;
      })
    );

    els.finale.hidden = !done;
    els.card.hidden = done;
    els.reset.hidden = Object.keys(progress.clues).length === 0;

    const riddle = done ? null : riddles[index];
    const isGame = riddle?.type === "game";
    if (game && game.riddleId !== riddle?.id) stopGame();
    if (!done && arcadeGame) stopArcade();
    if (done) {
      renderImages(null);
      renderArcade();
      return;
    }

    els.kicker.textContent = `Énigme ${index + 1} sur ${riddles.length}`;
    els.title.textContent = riddle.title;
    els.question.textContent = riddle.question;
    els.input.value = "";
    els.hintBlock.hidden = !riddle.hint;
    els.hintText.hidden = true;
    els.hintText.textContent = riddle.hint || "";
    els.hintToggle.setAttribute("aria-expanded", "false");

    renderImages(riddle);
    els.picture.hidden = !riddle.image;
    if (riddle.image && els.pictureImg.getAttribute("src") !== riddle.image) els.pictureImg.src = riddle.image;
    const isQcm = riddle.type === "qcm";
    els.qcm.hidden = !isQcm;
    if (isQcm) renderQcm(riddle);
    els.form.hidden = isGame || isQcm;
    els.gameBlock.hidden = !isGame;
    if (isGame && !game) startGame(riddle);
  }

  // Image jointe à un indice, avec son titre en légende.
  function clueFigure(image) {
    const figure = document.createElement("figure");
    figure.className = "clue-picture";
    const img = document.createElement("img");
    img.alt = image.title || "";
    const caption = document.createElement("figcaption");
    caption.textContent = image.title || "";
    figure.append(img, caption);
    decryptImage(image)
      .then((url) => { img.src = url; })
      .catch((err) => { console.error(err); figure.remove(); });
    return figure;
  }

  // ---------- « Qui suis-je ? » : deviner le prénom à tout moment ----------

  const WHO_WRONG = ["Non, ce n'est pas moi… 😏", "Raté ! Cherche encore.", "Pas du tout ! 😄", "Nope. Relis tes indices !"];
  let whoWrong = 0;

  async function checkIdentity(event) {
    event.preventDefault();
    const normalized = normalize(els.whoInput.value);
    if (!normalized) {
      els.whoFeedback.textContent = "Écris un prénom d'abord !";
      els.whoFeedback.className = "feedback error";
      return;
    }
    const hash = await hashAnswer("identity", normalized);
    const match = identity.find((entry) => entry.answerHash === hash);
    if (!match) {
      els.whoFeedback.textContent = WHO_WRONG[whoWrong++ % WHO_WRONG.length];
      els.whoFeedback.className = "feedback error";
      els.whoForm.classList.remove("shake");
      void els.whoForm.offsetWidth; // relance l'animation
      els.whoForm.classList.add("shake");
      els.whoInput.select();
      return;
    }
    try {
      const reveal = parsePayload(await decryptClue(normalized, match.payload));
      els.whoFeedback.textContent = "C'est bien moi ! 🎉";
      els.whoFeedback.className = "feedback success";
      await showCelebration(reveal);
    } catch (err) {
      console.error(err);
      els.whoFeedback.textContent = "Oups, une erreur est survenue. Réessaie.";
      els.whoFeedback.className = "feedback error";
    }
  }

  let stopConfetti = null;
  async function showCelebration(reveal) {
    els.celebrateTitle.textContent = reveal.title || "C'est bien moi !";
    els.celebrateImg.hidden = !reveal.image;
    if (reveal.image) els.celebrateImg.src = await decryptImage(reveal.image);
    if (els.celebrate.showModal) els.celebrate.showModal();
    else els.celebrate.setAttribute("open", "");
    els.celebrateClose.focus();
    stopConfetti?.();
    stopConfetti = startConfetti(els.confetti);
  }

  function closeCelebration() {
    stopConfetti?.();
    stopConfetti = null;
    if (els.celebrate.open) els.celebrate.close();
  }

  // Confettis : des petits rectangles colorés qui tombent en tournoyant.
  function startConfetti(canvas) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
    const ctx = canvas.getContext("2d");
    const colors = ["#ff0040", "#ffd400", "#00c853", "#2979ff", "#ff6d00", "#d500f9", "#00e5ff"];
    let w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const piece = (fromTop) => ({
      x: Math.random() * w,
      y: fromTop ? -20 - Math.random() * h * 0.5 : Math.random() * -h,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      vy: 90 + Math.random() * 140, vx: (Math.random() - 0.5) * 60,
      angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 10,
      sway: Math.random() * Math.PI * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
    const pieces = Array.from({ length: 160 }, () => piece(false));
    const started = performance.now();
    let last = null, raf;
    const frame = (now) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, w, h);
      // Pluie continue pendant 4 s, puis les derniers confettis finissent de tomber.
      const raining = now - started < 4000;
      for (const p of pieces) {
        p.sway += dt * 3;
        p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        if (p.y > h + 20 && raining) Object.assign(p, piece(true));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (raining || pieces.some((p) => p.y < h + 20)) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, w, h);
    };
  }

  // ---------- QCM ----------
  // Chaque proposition essayée est barrée. Quand toutes l'ont été, on révèle
  // le message (par exemple « aucune réponse n'est bonne ») et l'indice.

  const QCM_WRONG = ["Faux !", "Eh non…", "Toujours pas !", "Raté !"];

  function renderQcm(riddle) {
    let tried = 0;
    els.qcm.replaceChildren(
      ...riddle.choices.map((choice, i) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "win-button";
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = `${i + 1}.`;
        button.append(num, ` ${choice}`);
        button.addEventListener("click", async () => {
          if (button.disabled || checking) return;
          button.disabled = true;
          button.classList.add("wrong");
          tried++;
          if (tried < riddle.choices.length) {
            setFeedback(QCM_WRONG[(tried - 1) % QCM_WRONG.length], "error");
            return;
          }
          checking = true;
          try {
            await solve(riddle, riddle.unlockToken);
            setFeedback(riddle.reveal, "success");
            const next = () => {
              render({ freshId: riddle.id });
              afterSolve();
            };
            // Laisse le temps de lire la révélation, puis la pop-up (si prévue)
            // doit être validée pour passer à la suite.
            setTimeout(() => (riddle.popup ? showPopup(riddle.popup, next) : next()), riddle.popup ? 1200 : 2500);
          } catch (err) {
            console.error(err);
            setFeedback("Oups, une erreur est survenue. Recharge la page.", "error");
          } finally {
            checking = false;
          }
        });
        li.append(button);
        return li;
      })
    );
  }

  // ---------- Pop-up ----------

  function showPopup({ image, text, button }, onOk) {
    els.popupImg.hidden = !image;
    if (image) els.popupImg.src = image;
    els.popupText.textContent = text || "";
    els.popupOk.textContent = button || "OK";
    els.popupOk.onclick = () => {
      els.popup.close();
      onOk();
    };
    if (els.popup.showModal) els.popup.showModal();
    else els.popup.setAttribute("open", ""); // vieux navigateurs
    els.popupOk.focus();
  }

  // ---------- Images flottantes ----------
  // Les images de l'énigme se promènent sur l'écran et rebondissent sur les
  // bords, façon économiseur d'écran.

  let shownImagesFor = null;
  let floating = null; // { items, raf }

  function renderImages(riddle) {
    if (shownImagesFor === riddle?.id) return; // ne pas relancer les GIF à chaque affichage
    shownImagesFor = riddle?.id ?? null;
    stopFloating();
    const images = riddle && Array.isArray(riddle.images) ? riddle.images : [];
    if (images.length) startFloating(images);
  }

  function startFloating(images) {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const items = images.map((src, i) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 60; // px/s
      const item = {
        img,
        // Départ : une image dans chaque coin (aussi la position fixe si les animations sont réduites).
        x: i % 2 ? 1 : 0,
        y: i % 4 < 2 ? 0 : 1,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        placed: false,
      };
      img.addEventListener("error", () => { // image absente : on l'ignore
        img.remove();
        item.gone = true;
      });
      return item;
    });
    els.floatingGifs.replaceChildren(...items.map((it) => it.img));

    let last = null;
    const frame = (now) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      const maxW = window.innerWidth, maxH = window.innerHeight;
      for (const it of items) {
        if (it.gone) continue;
        const w = it.img.offsetWidth, h = it.img.offsetHeight;
        if (!h) continue; // pas encore chargée
        if (!it.placed) { // les coins de départ, convertis en pixels
          it.x = it.x * Math.max(0, maxW - w);
          it.y = it.y * Math.max(0, maxH - h);
          it.placed = true;
        }
        if (!still) {
          it.x += it.vx * dt;
          it.y += it.vy * dt;
        }
        if (it.x < 0) { it.x = 0; it.vx = Math.abs(it.vx); }
        if (it.x > maxW - w) { it.x = Math.max(0, maxW - w); it.vx = -Math.abs(it.vx); }
        if (it.y < 0) { it.y = 0; it.vy = Math.abs(it.vy); }
        if (it.y > maxH - h) { it.y = Math.max(0, maxH - h); it.vy = -Math.abs(it.vy); }
        it.img.style.transform = `translate(${it.x}px, ${it.y}px)`;
      }
      floating.raf = requestAnimationFrame(frame);
    };
    floating = { items, raf: requestAnimationFrame(frame) };
  }

  function stopFloating() {
    if (floating) cancelAnimationFrame(floating.raf);
    floating = null;
    els.floatingGifs.replaceChildren();
  }

  // ---------- Mini-jeux (dinosaure, voiture…) ----------

  const GAME_INFO = {
    dino: {
      name: "🦖 Dinosaure",
      goal: (target) => `🎯 Objectif : ${target} points`,
      label: "Jeu du dinosaure : appuie sur Espace ou touche l'écran pour sauter",
    },
    hill: {
      name: "🚗 Course des collines",
      goal: (target) => `🏁 Objectif : franchir la ligne d'arrivée à ${target} m`,
      label: "Jeu de voiture : flèche droite ou côté droit de l'écran pour accélérer, flèche gauche ou côté gauche pour freiner",
    },
    devil: {
      name: "😈 Niveau du diable",
      goal: (target) => `🚪 Objectif : atteindre la porte, ${target > 1 ? `${target} niveaux de suite` : "en un seul niveau"}`,
      label: "Jeu de plateforme : flèches gauche et droite pour bouger, flèche haut ou Espace pour sauter",
    },
  };

  // Lance le mini-jeu d'une énigme dans un canvas donné.
  function launchGame(canvas, goalEl, riddle, onWin) {
    const kind = riddle.game || "dino";
    goalEl.textContent = GAME_INFO[kind].goal(riddle.targetScore);
    canvas.setAttribute("aria-label", GAME_INFO[kind].label);
    const instance = window.Games[kind](canvas, { target: riddle.targetScore, onWin });
    return { riddleId: riddle.id, instance };
  }

  function startGame(riddle) {
    game = launchGame(els.gameCanvas, els.gameGoal, riddle, () => onGameWon(riddle));
  }

  function stopGame() {
    game.instance.destroy();
    game = null;
  }

  // ---------- Salle d'arcade : rejouer librement une fois l'enquête finie ----------

  function renderArcade() {
    const games = riddles.filter((r) => r.type === "game");
    els.arcade.hidden = games.length === 0;
    els.arcadeButtons.replaceChildren(
      ...games.map((r) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "win-button";
        button.textContent = GAME_INFO[r.game || "dino"].name;
        button.setAttribute("aria-pressed", String(arcadeGame?.riddleId === r.id));
        // Recliquer sur le jeu en cours le relance depuis le début.
        button.addEventListener("click", () => playArcade(r));
        return button;
      })
    );
    els.arcadeGame.hidden = !arcadeGame;
  }

  function playArcade(riddle) {
    if (arcadeGame) stopArcade();
    arcadeGame = launchGame(els.arcadeCanvas, els.arcadeGoal, riddle, () => {
      els.arcadeGoal.textContent = "🏆 Gagné ! Reclique sur le jeu pour rejouer.";
    });
    renderArcade();
    els.arcadeCanvas.focus({ preventScroll: true });
    els.arcadeGame.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function stopArcade() {
    arcadeGame.instance.destroy();
    arcadeGame = null;
    els.arcadeGame.hidden = true;
  }

  async function onGameWon(riddle) {
    try {
      // Le jeton du jeu sert de « réponse » : même chemin que pour une énigme.
      await solve(riddle, riddle.unlockToken);
      setFeedback("Bravo ! Défi réussi. Un nouvel indice t'attend…", "success");
      // Laisse le temps de voir l'écran de victoire avant de passer à la suite.
      setTimeout(() => {
        render({ freshId: riddle.id });
        afterSolve();
      }, 1800);
    } catch (err) {
      console.error(err);
      setFeedback("Oups, une erreur est survenue. Recharge la page.", "error");
    }
  }

  function setFeedback(message, kind) {
    els.feedback.textContent = message;
    els.feedback.className = "feedback" + (kind ? ` ${kind}` : "");
  }

  const WRONG = [
    "Ce n'est pas ça… Réessaie !",
    "Raté ! Mais tu chauffes peut-être.",
    "Non, pas encore. Relis bien l'énigme.",
    "Toujours pas… Courage !",
  ];
  let wrongCount = 0;

  // ---------- Vérification ----------

  // Vérifie la réponse normalisée ; si elle est bonne, déchiffre et enregistre
  // l'indice. Renvoie true en cas de succès.
  async function solve(riddle, normalized) {
    const hash = await hashAnswer(riddle.id, normalized);
    const candidates = [{ answerHash: riddle.answerHash, clue: riddle.clue }, ...(riddle.alternatives || [])];
    const match = candidates.find((c) => c.answerHash === hash);
    if (!match) return false;
    const clue = parsePayload(await decryptClue(normalized, match.clue));
    progress.clues[riddle.answerHash] = clue.image ? clue : clue.text;
    saveProgress();
    return true;
  }

  function afterSolve() {
    const index = currentIndex();
    setFeedback(index === -1 ? "" : "Bravo ! Un nouvel indice a rejoint ton carnet.", "success");
    if (index === -1) return;
    if (riddles[index].type === "game") els.gameCanvas.focus({ preventScroll: true });
    else els.input.focus();
  }

  async function checkAnswer(event) {
    event.preventDefault();
    if (checking) return;

    const index = currentIndex();
    if (index === -1) return;
    const riddle = riddles[index];
    const normalized = normalize(els.input.value);
    if (!normalized) {
      setFeedback("Écris une réponse avant de valider.", "error");
      els.input.focus();
      return;
    }

    checking = true;
    els.submit.disabled = true;
    try {
      if (!(await solve(riddle, normalized))) {
        setFeedback(WRONG[wrongCount++ % WRONG.length], "error");
        els.form.classList.remove("shake");
        void els.form.offsetWidth; // relance l'animation
        els.form.classList.add("shake");
        els.input.select();
        return;
      }

      wrongCount = 0;
      render({ freshId: riddle.id });
      afterSolve();
    } catch (err) {
      console.error(err);
      setFeedback("Oups, une erreur est survenue. Réessaie.", "error");
    } finally {
      checking = false;
      els.submit.disabled = false;
    }
  }

  // ---------- Initialisation ----------

  function showLoadError(message) {
    els.loadError.textContent = message;
    els.loadError.hidden = false;
  }

  async function init() {
    // Échap ne ferme pas la pop-up : il faut répondre.
    els.popup.addEventListener("cancel", (event) => event.preventDefault());
    els.form.addEventListener("submit", checkAnswer);
    els.whoForm.addEventListener("submit", checkIdentity);
    els.celebrateClose.addEventListener("click", closeCelebration);
    els.celebrate.addEventListener("close", closeCelebration);
    els.hintToggle.addEventListener("click", () => {
      const open = els.hintText.hidden;
      els.hintText.hidden = !open;
      els.hintToggle.setAttribute("aria-expanded", String(open));
    });
    els.reset.addEventListener("click", () => {
      if (!confirm("Effacer ta progression et recommencer depuis la première énigme ?")) return;
      progress = { clues: {} };
      saveProgress();
      setFeedback("");
      render();
    });

    if (!window.crypto || !crypto.subtle) {
      showLoadError("Ton navigateur ne permet pas de jouer ici. Ouvre la page en HTTPS (ou via http://localhost).");
      return;
    }

    try {
      const response = await fetch("riddles.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      riddles = Array.isArray(data) ? data : data.riddles;
      identity = Array.isArray(data) ? [] : data.identity || [];
      els.whoWindow.hidden = identity.length === 0;
      if (!Array.isArray(riddles) || riddles.length === 0) throw new Error("Aucune énigme");
    } catch (err) {
      console.error(err);
      showLoadError("Impossible de charger les énigmes. Si tu testes en local, lance un petit serveur (voir README).");
      return;
    }

    render();
  }

  init();
})();
