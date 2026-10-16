# 🕵️ Qui suis-je ?

> Cinq épreuves. Cinq indices. Une identité à deviner.

Une petite application web, pensée pour **une seule personne** : celle qui ne me connaît pas encore. Pour apprendre qui je suis, il faut résoudre des énigmes. Chaque énigme réussie révèle un indice sur moi.

👉 **Démo : `https://<ton-pseudo>.github.io/<nom-du-repo>/`**

---

## 🎯 Le concept

1. La personne arrive sur la page d'accueil.
2. Elle découvre la **première énigme** et tente d'y répondre.
3. Bonne réponse → un **indice** sur mon identité se débloque, et l'énigme suivante apparaît.
4. Mauvaise réponse → elle peut réessayer autant de fois qu'elle veut.
5. Après la cinquième épreuve, elle a cinq indices en main et peut me deviner.

| Énigme | Thème | Indice débloqué |
|--------|-------|-----------------|
| 1 | Le nombre mystère (GIF) | _à compléter_ |
| 2 | Le portrait mystère (QCM piégé) | _à compléter_ |
| 3 | Jeu du dinosaure | _à compléter_ |
| 4 | Course de voiture dans les collines | _à compléter_ |
| 5 | Niveau du diable (plateforme piégée) | _à compléter_ |

---

## ✨ Fonctionnalités

- 5 épreuves à réussir dans l'ordre : une énigme, un QCM piégé et trois mini-jeux
- Un indice par énigme réussie
- Une fois l'enquête terminée, une « salle d'arcade » permet de rejouer aux mini-jeux
- À tout moment, une fenêtre permet de tenter mon prénom : si c'est le bon, ma photo apparaît sous une pluie de confettis
- Un indice peut être accompagné d'une photo (avec une légende)
- Réponses tolérantes (majuscules, accents et espaces ignorés)
- Progression sauvegardée dans le navigateur (on peut fermer l'onglet et revenir)
- 100 % statique : pas de serveur, pas de base de données
- Adapté au mobile

---

## 🗂️ Structure du projet

```
.
├── index.html        # Page unique de l'application
├── style.css         # Styles
├── app.js            # Logique : affichage, vérification, progression
├── dino.js           # Mini-jeu du dinosaure (énigme de type « jeu »)
├── hill.js           # Mini-jeu de voiture façon Hill Climb Racing
├── devil.js          # Mini-jeu de plateforme piégé façon Level Devil
├── wallpaper.jpg     # Fond d'écran
├── riddles.json      # Les énigmes, les empreintes des réponses et les indices
├── data/             # Images publiques des énigmes (GIF, portrait du QCM…)
├── enc/              # Photos privées chiffrées (générées par le script)
├── tools/
│   ├── build-riddles.js       # Script local pour générer riddles.json (voir plus bas)
│   └── secrets.example.json   # Modèle de fichier secret (énigmes en clair)
└── README.md
```

---

## ✍️ Écrire tes énigmes

Tout le contenu se trouve dans **`riddles.json`**. Chaque énigme suit ce format :

```json
{
  "id": 1,
  "title": "Titre de l'énigme",
  "question": "Le texte de l'énigme, tel qu'il sera affiché.",
  "hint": "Un petit coup de pouce optionnel si la personne bloque.",
  "answerHash": "<empreinte SHA-256 de la réponse normalisée>",
  "clue": "<indice chiffré avec la réponse>",
  "alternatives": [
    { "answerHash": "<empreinte d'une autre réponse acceptée>", "clue": "<indice chiffré avec elle>" }
  ]
}
```

`alternatives` est optionnel : il permet d'accepter plusieurs formulations (« carte », « une carte »…).

`images` est optionnel aussi : une liste de chemins d'images (GIF, PNG…) qui flottent sur tout l'écran pendant l'énigme et rebondissent sur les bords, façon économiseur d'écran (sans bloquer les clics). Elles partent chacune d'un coin, et restent immobiles dans les coins si le système demande de réduire les animations. Une image introuvable est simplement masquée. Exemple : `"images": ["data/67a.gif", "data/67b.gif", "data/67c.gif", "data/67d.gif"]`.

### Pourquoi des champs « hash » et « chiffré » ?

GitHub Pages sert des fichiers **publics** : n'importe qui peut ouvrir le code source de la page. Si les réponses et les indices étaient écrits en clair dans `riddles.json`, il suffirait de lire le fichier pour tout découvrir.

On évite ça ainsi :

- **`answerHash`** : seule l'empreinte SHA-256 de la réponse est stockée. L'application compare l'empreinte de ce que tape la personne avec celle-ci.
- **`clue`** : l'indice est **chiffré** (AES-GCM) avec une clé dérivée de la bonne réponse. Il ne peut être lu qu'en connaissant la réponse.

### Générer le fichier

Tu écris tes énigmes, réponses et indices en clair dans un fichier **local, non versionné** (`tools/secrets.json`, déjà listé dans `.gitignore`). Pars du modèle :

```bash
cp tools/secrets.example.json tools/secrets.json
```

Le fichier contient la liste des énigmes (`riddles`) et, en option, le prénom à deviner (`identity`) :

```json
{
  "identity": {
    "answers": ["Rémi"],
    "title": "OUI ! C'est bien moi, Rémi ! 🎉",
    "image": "data/moi.png"
  },
  "riddles": [ … ]
}
```

`identity` active la fenêtre « c_est_toi.exe » : à tout moment, la personne peut taper un prénom. S'il fait partie de `answers` (après normalisation : « remi », « RÉMI » et « Rémi ! » se valent), une pop-up s'ouvre avec des confettis, `title` et la photo `image`.

Chaque énigme de `riddles` ressemble à ceci :

```json
{
  "id": 1,
  "title": "Titre de l'énigme",
  "question": "Le texte de l'énigme.",
  "hint": "Coup de pouce optionnel.",
  "answer": "carte",
  "alternatives": ["une carte", "la carte"],
  "clue": "L'indice sur toi, en clair."
}
```

#### Une énigme « QCM piégé »

Une énigme peut proposer des choix cliquables au lieu d'un champ de réponse. Chaque proposition essayée est barrée ; quand toutes l'ont été, le message `reveal` s'affiche et l'indice se débloque. (Il n'y a donc pas de bonne réponse : c'est la blague.) `image` affiche une image dans la fenêtre de l'énigme.

```json
{
  "id": 2,
  "type": "qcm",
  "title": "Le portrait mystère",
  "question": "Qui est ce personnage ?",
  "image": "data/bob-shrek-removebg.png",
  "choices": ["Shrek Razowski", "Bob Shrekowski", "Schrok Babowski", "Brok Shrakowski"],
  "reveal": "Aucune réponse n'est bonne ! 😈",
  "popup": { "image": "data/bob.jpg", "text": "Tu passes un bon moment ?", "button": "Oui" },
  "clue": "L'indice sur toi, en clair."
}
```

`popup` est optionnel : une fenêtre qui s'ouvre une fois toutes les propositions essayées, et qu'on ne peut fermer qu'avec son bouton (pas avec Échap) pour passer à l'épreuve suivante.

#### Une énigme « mini-jeu »

À la place d'une question, une énigme peut être un mini-jeu : l'indice se débloque quand l'objectif est atteint. Il suffit de remplacer `answer` / `alternatives` par `type`, `game` et `targetScore`.

| `game` | Jeu | `targetScore` |
|--------|-----|---------------|
| `"dino"` | Dinosaure de Chrome : sauter les cactus, esquiver les oiseaux | Score à atteindre |
| `"hill"` | Voiture façon Hill Climb Racing : gaz/frein, essence, ne pas se cogner la tête | Distance de la ligne d'arrivée, en mètres |
| `"devil"` | Plateforme piégée façon Level Devil : sol qui s'effondre, pics, porte qui s'enfuit… | Nombre de niveaux à finir (1 à 3) |


```json
{
  "id": 3,
  "type": "game",
  "game": "dino",
  "title": "Le jeu du dinosaure",
  "question": "Saute par-dessus les cactus jusqu'au score demandé.",
  "hint": "Appui long = grand saut, appui bref = petit saut.",
  "targetScore": 600,
  "clue": "L'indice sur toi, en clair."
}
```

Pour te repérer : 600 points au dinosaure ≈ 36 secondes sans faute, de plus en plus vite, avec des oiseaux à partir de 150 points (il faut parfois se baisser) ; 500 m en voiture ≈ 40 secondes pour qui maîtrise le gaz, avec une piste de plus en plus accidentée et des bidons d'essence espacés (il faudra sans doute plusieurs essais).

Puis tu lances :

```bash
node tools/build-riddles.js
```

Le script produit `riddles.json` avec les empreintes et les indices chiffrés, ainsi que les photos privées chiffrées dans `enc/` (il vide ce dossier à chaque fois). C'est ce qu'il faut publier : `riddles.json` et `enc/`, jamais les originaux.

#### Une photo jointe à un indice

`clueImage` affiche une photo sous l'indice dans le carnet, avec `title` en légende. La photo est chiffrée dans `enc/` et ne peut être lue qu'une fois l'indice débloqué :

```json
"clueImage": { "file": "data/fabian.jpeg", "title": "Le canard en plastique" }
```

> 🔐 Les photos privées (celle du prénom, celles des indices) ne doivent pas être publiées en clair : ajoute leur original à `.gitignore` (c'est déjà fait pour `data/moi.png` et `data/fabian.jpeg`).

> ⚠️ Ne commite jamais `tools/secrets.json`.

### Normalisation des réponses

Avant comparaison, la réponse est : mise en minuscules, débarrassée de ses accents, et privée des espaces et de la ponctuation en trop. « Été », « ete » et « ÉTÉ ! » sont donc équivalents. Pense à écrire tes réponses en gardant ça en tête.

---

## 🚀 Déploiement sur GitHub Pages

1. Crée un dépôt GitHub (public, pour la version gratuite de Pages).
2. Pousse le code :
   ```bash
   git init
   git add .
   git commit -m "Première version"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/<nom-du-repo>.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages**.
4. Dans **Build and deployment**, choisis **Deploy from a branch**, branche `main`, dossier `/ (root)`.
5. Après une minute ou deux, le site est en ligne à l'adresse :
   `https://<ton-pseudo>.github.io/<nom-du-repo>/`

Envoie ce lien à la personne, et le jeu commence.

---

## 🧪 Tester en local

Les navigateurs bloquent `fetch()` sur les fichiers ouverts directement (`file://`). Lance un petit serveur :

```bash
# avec Python
python3 -m http.server 8000

# ou avec Node
npx serve .
```

Puis ouvre `http://localhost:8000`.

---

## 🔒 Limites à connaître

- L'indice d'une énigme « mini-jeu » ou « QCM piégé » est moins protégé que les autres : la clé qui le déchiffre (`unlockToken`) est forcément dans `riddles.json`, puisque c'est le navigateur qui décide de la réussite. Quelqu'un qui lit le code peut donc l'obtenir sans jouer.
- Le prénom se devine aussi par force brute : il suffit de tester une liste de prénoms courants. Ta photo est donc à l'abri d'un simple coup d'œil dans le code, pas d'un curieux outillé. Même chose pour la photo d'un indice de mini-jeu, qui se déchiffre avec le même `unlockToken` que l'indice.
- Ce n'est **pas** un système infaillible : quelqu'un de très déterminé pourrait tester des réponses par force brute. Pour un jeu entre humains, c'est largement suffisant.
- Le repo étant public, évite d'y mettre des informations personnelles sensibles : les indices doivent rester des indices, pas un dossier complet.
- La progression est stockée dans le `localStorage` du navigateur : changer d'appareil ou vider les données du site remet le jeu à zéro.

---

## 🛣️ Idées pour la suite

- [x] Un champ « Qui suis-je ? » pour que la personne tente sa réponse
- [x] Message de félicitations personnalisé
- [ ] Compteur de tentatives
- [ ] Mode sombre
- [ ] Un formulaire pour me renvoyer sa réponse finale

---

## 📄 Licence

Projet personnel. À toi de choisir : MIT si tu veux le partager, ou aucune licence si tu veux le garder pour toi.