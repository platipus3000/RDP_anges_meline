#!/usr/bin/env node
// Génère riddles.json à partir de tools/secrets.json (local, non versionné).
// Les réponses ne sont stockées que sous forme d'empreinte SHA-256, et les
// indices sont chiffrés (AES-GCM) avec une clé dérivée de la réponse.
// Les images privées (photo d'un indice, photo révélée quand on devine le
// prénom) sont chiffrées dans enc/ ; leur clé voyage dans le contenu chiffré.
//
// Usage : node tools/build-riddles.js [entrée] [sortie]

"use strict";

const fs = require("fs");
const path = require("path");
const { webcrypto: crypto } = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const input = path.resolve(process.argv[2] || path.join(__dirname, "secrets.json"));
const output = path.resolve(process.argv[3] || path.join(ROOT, "riddles.json"));
const ENC_DIR = path.join(ROOT, "enc");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

// Doit rester strictement identique à la version de app.js.
const PBKDF2_ITERATIONS = 150000;

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
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const hex = (buf) => Buffer.from(buf).toString("hex");

// Chiffre un fichier avec une clé aléatoire. Le fichier chiffré est écrit
// dans enc/ sous un nom neutre ; la clé est renvoyée pour être glissée dans
// un contenu lui-même chiffré (indice ou révélation).
async function encryptFile(file) {
  const source = path.resolve(ROOT, file);
  if (!fs.existsSync(source)) throw new Error(`Image introuvable : ${file}`);
  const type = MIME[path.extname(source).toLowerCase()];
  if (!type) throw new Error(`Format d'image non pris en charge : ${file}`);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, fs.readFileSync(source)));
  const name = hex(crypto.getRandomValues(new Uint8Array(8))) + ".bin";
  fs.mkdirSync(ENC_DIR, { recursive: true });
  fs.writeFileSync(path.join(ENC_DIR, name), Buffer.concat([iv, data]));
  return { file: `enc/${name}`, key: b64(raw), type };
}

async function hashAnswer(id, normalized) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`qui-suis-je|${id}|${normalized}`));
  return hex(digest);
}

async function encryptClue(normalized, clue) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(normalized), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(clue));
  return ["v1", b64(salt), b64(iv), b64(new Uint8Array(ciphertext))].join(".");
}

async function buildAnswer(riddle, answer, payload) {
  const normalized = normalize(answer);
  if (!normalized) {
    throw new Error(`Énigme ${riddle.id} : la réponse « ${answer} » est vide une fois normalisée.`);
  }
  return {
    answerHash: await hashAnswer(riddle.id, normalized),
    clue: await encryptClue(normalized, payload),
  };
}

// « Qui suis-je ? » : le prénom à deviner à tout moment. Pour chaque
// orthographe acceptée : une empreinte, et la révélation chiffrée avec elle.
async function buildIdentity(identity) {
  if (!identity) return [];
  const answers = [].concat(identity.answers || []);
  if (!answers.length) throw new Error("identity : « answers » doit contenir au moins un prénom.");
  const reveal = JSON.stringify({
    title: identity.title || "",
    image: identity.image ? await encryptFile(identity.image) : null,
  });
  const entries = [];
  const seen = new Set();
  for (const answer of answers) {
    const normalized = normalize(answer);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ answerHash: await hashAnswer("identity", normalized), payload: await encryptClue(normalized, reveal) });
  }
  return entries;
}

async function main() {
  if (!fs.existsSync(input)) {
    console.error(`Fichier introuvable : ${path.relative(process.cwd(), input)}`);
    console.error("Copie tools/secrets.example.json vers tools/secrets.json et remplis-le.");
    process.exit(1);
  }

  // Format : { "riddles": [...], "identity": {...} } (ou directement le tableau d'énigmes).
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const secrets = Array.isArray(data) ? data : data.riddles;
  if (!Array.isArray(secrets) || secrets.length === 0) {
    throw new Error("secrets.json doit contenir une liste d'énigmes non vide.");
  }
  // Repart d'un dossier enc/ propre : les anciens fichiers chiffrés sont inutiles.
  if (fs.existsSync(ENC_DIR)) {
    for (const f of fs.readdirSync(ENC_DIR)) if (f.endsWith(".bin")) fs.unlinkSync(path.join(ENC_DIR, f));
  }

  const seen = new Set();
  const riddles = [];
  for (const riddle of secrets) {
    const isGame = riddle.type === "game";
    const isQcm = riddle.type === "qcm";
    if (isGame) {
      if (riddle.game && !["dino", "hill", "devil"].includes(riddle.game)) {
        throw new Error(`Énigme ${riddle.id} : « game » doit valoir "dino", "hill" ou "devil".`);
      }
      if (!(Number.isInteger(riddle.targetScore) && riddle.targetScore > 0)) {
        throw new Error(`Énigme ${riddle.id ?? "?"} : « targetScore » doit être un entier positif.`);
      }
    }
    if (isQcm && !(Array.isArray(riddle.choices) && riddle.choices.length >= 2)) {
      throw new Error(`Énigme ${riddle.id ?? "?"} : « choices » doit contenir au moins deux propositions.`);
    }
    if (isGame || isQcm) {
      // Pas de réponse à taper : la « réponse » est un jeton aléatoire que
      // l'application utilise quand le défi est réussi (score atteint,
      // ou toutes les propositions du QCM essayées).
      riddle.answer = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
      riddle.alternatives = [];
    }
    for (const field of ["id", "title", "question", "answer", "clue"]) {
      if (riddle[field] === undefined || riddle[field] === "") {
        throw new Error(`Énigme ${riddle.id ?? "?"} : champ « ${field} » manquant.`);
      }
    }
    if (seen.has(riddle.id)) throw new Error(`Identifiant en double : ${riddle.id}`);
    seen.add(riddle.id);

    // Contenu chiffré de l'indice : le texte seul, ou le texte + une image.
    const payload = riddle.clueImage
      ? JSON.stringify({ text: riddle.clue, image: { ...(await encryptFile(riddle.clueImage.file)), title: riddle.clueImage.title || "" } })
      : riddle.clue;

    const main = await buildAnswer(riddle, riddle.answer, payload);
    const alternatives = [];
    const hashes = new Set([main.answerHash]);
    for (const alt of riddle.alternatives || []) {
      const built = await buildAnswer(riddle, alt, payload);
      if (hashes.has(built.answerHash)) continue; // équivalente après normalisation
      hashes.add(built.answerHash);
      alternatives.push(built);
    }

    const entry = {
      id: riddle.id,
      title: riddle.title,
      question: riddle.question,
    };
    if (isGame) {
      entry.type = "game";
      entry.game = riddle.game || "dino";
      entry.targetScore = riddle.targetScore;
    }
    if (isQcm) {
      entry.type = "qcm";
      entry.choices = riddle.choices;
      entry.reveal = riddle.reveal || "Aucune réponse n'est bonne !";
      if (riddle.popup) entry.popup = riddle.popup;
    }
    if (isGame || isQcm) entry.unlockToken = riddle.answer;
    if (riddle.hint) entry.hint = riddle.hint;
    if (riddle.image) entry.image = riddle.image;
    if (Array.isArray(riddle.images) && riddle.images.length) entry.images = riddle.images;
    entry.answerHash = main.answerHash;
    entry.clue = main.clue;
    if (alternatives.length) entry.alternatives = alternatives;
    riddles.push(entry);
  }

  const identity = await buildIdentity(Array.isArray(data) ? null : data.identity);
  fs.writeFileSync(output, JSON.stringify({ riddles, identity }, null, 2) + "\n");
  console.log(`✔ ${riddles.length} énigme(s) écrite(s) dans ${path.relative(process.cwd(), output)}`);
  if (identity.length) console.log(`✔ « Qui suis-je ? » : ${identity.length} orthographe(s) acceptée(s)`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
