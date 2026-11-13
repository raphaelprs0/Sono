# 🎧 Sono · La musique se partage

🇫🇷 **Français** · [🇬🇧 **Anglais**](README.md)

![Version](https://img.shields.io/badge/Version-2.5.8-7927F5)
![Windows](https://img.shields.io/badge/Windows-10%2F11-2798F5?logo=windows)
![macOS](https://img.shields.io/badge/macOS-12%2B-black?logo=apple)
![iOS](https://img.shields.io/badge/iOS-17%2B-black?logo=apple)

![Rust](https://img.shields.io/badge/Serveur-Rust-FF2E2E?logo=rust&logoColor=white)
![SwiftUI](https://img.shields.io/badge/SwiftUI-Natif-FF4A17?logo=swift&logoColor=white)
![Go](https://img.shields.io/badge/Moteur-Go-00ADD8?logo=go&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-FF7C00?logo=cloudflare&logoColor=white)
![Licence](https://img.shields.io/badge/Licence-AGPL--3.0-29A825)

**Vos invités choisissent la musique, votre enceinte la joue.** L’hôte lance une session, les invités scannent un QR code
avec leur téléphone et proposent leurs titres : tout le monde voit la file, la musique est jouée sur **Deezer** ou
**Apple Music**, et personne n’a besoin d’installer quoi que ce soit pour participer.

> 💬 **Contact :** Sur Discord ``@raphaelprs``
>
> 🤖 **Projet Vibe-coder :** En partie écrit par une IA, puis testé à chaque étape sur de vraies machines.
>
> ⚠️ **Projet non officiel :** Sans lien avec Deezer ni Apple : voir [Avertissement](#%EF%B8%8F-avertissement).


**En bref**

- 💻 **App ordinateur** (Mac et Windows) : l’ordinateur joue la musique et accueille les invités, en Wi-Fi ou depuis n’importe où grâce au lien public « Internet ».

- 📱 **App iPhone** : la même chose sans ordinateur, l’iPhone joue la musique et les invités passent par un service en ligne (Wi-Fi ou 4G/5G).
- 🙋 **Invités** : un simple navigateur suffit (iPhone, Android, ordinateur), sans compte et sans application.
- 🎵 **Il faut** : un compte **Deezer** ou **Apple Music** pour l’hôte uniquement.
- 📦 **S’installe** : depuis la page [Releases](../../releases) (.dmg (macOS), .exe (Windows), .ipa (iOS)), ou en fabriquant l’app soi-même.

| | App ordinateur | App iPhone |
|---|---|---|
| Appareils | Mac (Apple Silicon, macOS 12+), Windows 10/11 64 bits | iPhone, iOS 17 ou plus récent |
| Version | 2.5.8 | 2.5.8 (build 18) |
| Interface | Preact (web) dans une fenêtre **Tauri 2** | **SwiftUI** natif |
| Serveur des invités | **Rust** (axum, tokio), intégré à l’app | **Cloudflare Workers** + Durable Objects |
| Lecture Deezer | Moteur **Go** (OpenDeezer) lancé à côté de l’app | Le même moteur **Go**, compilé dans l’app |
| Qualité Deezer | FLAC sans perte si l’abonnement le permet, sinon MP3 320 ou 128 kb/s | Pareil |
| Lecture Apple Music | MusicKit JS (fenêtre Apple Music) | MusicKit d’iOS (lecteur du système) |
| Invités hors du Wi-Fi | Lien public « Internet » (tunnel Cloudflare) | Toujours (service en ligne) |
| Langues | Français, anglais | Français, anglais |
| Taille | DMG ≈ 7 Mo, EXE ≈ 7 Mo | IPA ≈ 3,7 Mo |

---

## 📑 Sommaire

1. [Le but du projet](#-le-but-du-projet)
2. [Fonctionnalités](#-fonctionnalit%C3%A9s)
3. [Télécharger et installer](#-t%C3%A9l%C3%A9charger-et-installer)
4. [Comptes de musique](#-comptes-de-musique)
5. [Vie privée](#-vie-priv%C3%A9e)
6. [Architecture](#-architecture)
7. [Technologies utilisées](#-technologies-utilis%C3%A9es)
8. [Organisation du dépôt](#-organisation-du-d%C3%A9p%C3%B4t)
9. [Fabriquer les apps soi-même](#-fabriquer-les-apps-soi-m%C3%AAme)
10. [Le service en ligne (Cloudflare)](#%EF%B8%8F-le-service-en-ligne-cloudflare)
11. [En cas de problème](#-en-cas-de-probl%C3%A8me)
12. [Crédits](#-cr%C3%A9dits)
13. [Avertissement](#%EF%B8%8F-avertissement)
14. [Licence](#-licence)

---

## 🎯 Le but du projet

En soirée, la musique passe souvent par le téléphone d’une seule personne : les autres doivent lui demander, ou
prendre son téléphone. Sono règle ça :

1. L’**hôte** ouvre Sono et crée une session (un nom, son prénom, éventuellement la validation des invités).
2. Sono affiche un **QR code** et un code court du type `SONO-4821`.
3. Les **invités** scannent le QR code (ou tapent l’adresse) : une page s’ouvre dans leur navigateur, ils donnent leur
   prénom et cherchent des titres.
4. Chaque titre proposé rejoint la **file d’attente commune**, visible par tous, avec le prénom de qui l’a ajouté.
5. L’appareil de l’hôte **joue la file** dans l’ordre, enchaîne les titres et, quand la file est vide, peut continuer
   avec une **musique de fond** (une playlist, un album ou un artiste).

L’hôte garde la main : il réorganise la file, retire un titre, accepte ou refuse les nouveaux venus, nomme des admins
et règle le son. L’objectif : une app **simple pour les invités** (rien à installer, pas de compte), **légère**
(installateurs d’environ 7 Mo, app iPhone d’environ 40 Mo en mémoire) et **agréable à regarder**, jusque sur la TV.

---

## ✨ Fonctionnalités

### 🙋 Pour les invités (dans le navigateur)

- **Rejoindre en un geste** : scanner le QR code, ou ouvrir `adresse/1234`. Sur iPhone, un lien « Ouvrir dans l’app Sono » ouvre la session dans l’app si elle est installée.

- **Prénom** affiché à côté de leurs titres (il ne change plus une fois dans la session).
- **Recherche** de titres (par nom, artiste ou album), sur l’app de lecture choisie par l’hôte (Deezer ou Apple Music).
- **La file en direct** : titre en cours, « Ensuite », titres proposés et musique de fond, mis à jour en temps réel.
- **Salle d’attente** quand l’hôte valide chaque invité : la page attend la réponse, et l’invité peut redemander s’il
  a été refusé.
- **Admins** : un invité nommé admin par l’hôte a directement les commandes (lecture, titre suivant et précédent,
  file d’attente, arrivées), sans pouvoir toucher aux réglages ni aux connexions.
- **Fin de session** : si l’hôte supprime la session, les invités voient un écran de fin.
- **Couleurs et langue de l’hôte** : la page des invités reprend le fond, la couleur et la langue (français ou anglais) choisis par l’hôte.

### 🎛 Pour l’hôte (ordinateur et iPhone)

- **File d’attente** : glisser pour réordonner, retirer un titre (bouton ou glissement vers la gauche sur iPhone), durée totale proposée.

- **Lecture** : lecture/pause, titre suivant et précédent, barre de progression, enchaînement automatique, titre suivant préchargé pour éviter les blancs.
- **Musique de fond** : une playlist, un album ou un artiste prend le relais quand la file est vide ; ses titres peuvent être réordonnés ou passés.
- **Invités** : liste des présents, validation des arrivées (facultative), retrait d’un invité, nomination d’admins, bandeau d’arrivée quand quelqu’un rejoint.
- **Activité** : journal de la session (titres ajoutés, arrivées, changements) et statistiques.
- **Son** : égaliseur 3 bandes (basses, médiums, aigus) avec préréglages (« Neutre », « Plus de basses », « Voix claires »…), pour la lecture Deezer.
- **Apparence** : fonds Noir, Blanc (thème clair), Automatique (noir ou blanc selon le réglage du système) et pochette en cours ; couleurs d’accent Citron, Lilas, Framboise, Or, Pleins Phares et Natif (blanc sur un fond sombre, noir sur un fond clair, jamais de la couleur du fond). Chaque élément (boutons, cartes, fenêtres, Liquid Glass) s’adapte au fond et à la couleur choisis. Liquid Glass désactivé par défaut, et un bouton pour revenir aux réglages d’origine. Par défaut : fond Noir et accent Citron.
- **Langue** : français ou anglais (Réglages → Apparence → Langue). Par défaut, celle de l’appareil ; les invités et l’écran TV suivent la langue de l’hôte.
- **Mode TV** : un écran plein format pour la TV, avec la pochette, le titre, la barre de lecture, le titre suivant et le QR code (leur disposition se règle sur l’app ordinateur). Il s’ouvre en s’agrandissant depuis le lecteur et se referme en revenant s’y poser, avec la même animation à l’envers. Échap quitte le mode TV sans faire sortir la fenêtre du plein écran.
- **Vider le cache** : affiche la taille du cache, puis ferme la session en cours et l’app pour repartir de zéro (après confirmation). Les comptes et le connecteur du lien « Internet » sont gardés.
- **Version de l’app** : affichée en bas des Réglages (ordinateur et iPhone).
- **Reprise sans surprise** : relancer l’app ne relance pas la musique toute seule ; déconnecter l’app de musique remet la session à zéro (titre en cours, file, historique, musique de fond).

### 💻 En plus sur l’app ordinateur

- **Wi-Fi** : les invités du même réseau ouvrent l’adresse locale affichée (avec un lien court sans numéro de port quand c’est possible).

- **« Internet »** : un lien public (tunnel Cloudflare `trycloudflare.com`) pour les invités en 4G/5G. L’outil `cloudflared` n’est pas livré avec l’app : il est téléchargé une seule fois depuis Cloudflare à la première activation (≈ 20 Mo sur Mac, 55 Mo sur Windows) et vérifié avant usage. Le lien est préparé dès que le tableau de bord de l’hôte est ouvert (porte fermée aux invités) : le passage Wi-Fi → Internet est instantané.
- **Raccourcis clavier** : Espace (lecture/pause), → ou N (suivant), ← ou P (précédent), et touches multimédia.
- **Connexion Deezer** par la page officielle, dans une fenêtre privée de l’app.
- **Rejoindre une session iPhone** depuis l’ordinateur, avec son code `SONO-1234`.
- Sur Mac, fermer la fenêtre **garde Sono actif** (musique et invités continuent) ; Cmd+Q le quitte.

### 📱 En plus sur l’app iPhone

- **App native** SwiftUI, légère (≈ 40 Mo de mémoire), avec un lecteur plein écran et un glissement pour fermer.

- **Écran verrouillé et Centre de contrôle** : titre, pochette, position et commandes.
- **AirPlay** : bouton de sortie audio, dans la couleur d’accent quand une enceinte AirPlay est utilisée.
- **CarPlay** : titre en cours, file d’attente et QR code d’invitation sur l’écran de la voiture.
- **TV en recopie** (AirPlay ou câble) : la TV affiche le mode TV en grand pendant que l’iPhone reste utilisable.
- **Rejoindre avec un QR code** : l’appareil photo de Sono lit le QR code d’une session ; elle s’ouvre dans l’app.
- **Musique en arrière-plan** : la lecture continue écran éteint.

---

## 📥 Télécharger et installer

Tout est sur la page **[Releases](../../releases)** du dépôt.

| Fichier | Pour |
|---|---|
| `Sono-<version>-arm64.dmg` | Mac avec puce Apple (M1, M2, M3, M4…). Ne fonctionne pas sur les Mac Intel. |
| `Sono-Setup-<version>.exe` | Windows 10 ou 11, 64 bits. |
| `Sono-<version>.ipa` | iPhone : IPA sans signature, à signer avec son propre compte Apple. |

Les apps ne sont **pas signées par Apple ni par Microsoft** (cela demande des comptes payants) : le système affiche un
avertissement au premier lancement. C’est normal.

### 🍎 Mac

1. Ouvrez le DMG et glissez **Sono** dans **Applications**.
2. Au premier lancement, macOS indique que l’app « ne peut pas être ouverte ». Allez dans **Réglages Système →
   Confidentialité et sécurité**, puis cliquez sur **Ouvrir quand même** en bas de la page.
3. Autorisez Sono à accepter les connexions entrantes si macOS le demande : c’est ce qui permet aux invités du Wi-Fi
   de rejoindre la session.

### 🪟 Windows

1. Lancez `Sono-Setup-<version>.exe`.
2. Si SmartScreen affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires →
   Exécuter quand même**.
3. Autorisez Sono dans le **pare-feu** (réseaux privés) quand Windows le demande.

L’installation se fait pour l’utilisateur courant, sans droits administrateur.

---

## 🔑 Comptes de musique

Seul l’**hôte** a besoin d’un compte. Les invités cherchent dans le catalogue de l’app choisie, sans compte.

### Deezer

- **Connexion par la page officielle de Deezer**, ouverte dans une fenêtre privée de l’app. Dès que la connexion est faite, Sono garde uniquement le cookie de session `arl` et ferme la page.

- Ce cookie donne accès au compte comme un mot de passe : **ne le partagez jamais**.
- Il est gardé **sur l’appareil uniquement**, dans les données de l’app (chiffrées par iOS sur iPhone, exclues des sauvegardes), et disparaît avec elle (voir [Vie privée](#-vie-priv%C3%A9e)).
- Il faut un abonnement Deezer qui permet la lecture à la demande.

### Apple Music

- **iPhone** : Sono demande l’autorisation d’utiliser Apple Music, puis joue les titres avec le lecteur d’iOS.

- **Ordinateur** : connexion dans la fenêtre Apple Music de l’app (MusicKit JS), la lecture se fait sur l’ordinateur.
- Il faut un abonnement Apple Music.

Si les deux apps sont connectées, l’hôte choisit celle qui joue la musique ; la recherche des invités passe par
celle-ci.

---

## 🔐 Vie privée

- **Pas de publicité, pas de mesure d’audience, pas de pistage.** Sono ne contacte que ce qui est nécessaire : Deezer ou Apple pour le catalogue et la lecture, et le service des invités.

- **Les invités** ne donnent qu’un **prénom**. Aucun compte, aucune adresse e-mail.
- **App ordinateur** : la session, la file et les invités restent **sur l’ordinateur** (serveur intégré). Le lien public « Internet » passe par un tunnel Cloudflare uniquement s’il est activé ; l’outil `cloudflared` est alors téléchargé depuis la page officielle de Cloudflare (GitHub), une seule fois.
- **App iPhone** : la session (nom, prénoms des invités, file d’attente, historique) est gardée par le **service en ligne**. Les sessions inutilisées depuis **7 jours** y sont supprimées automatiquement, et 200 sessions au plus sont gardées. Supprimer la session l’efface tout de suite.
- **Identifiants de musique** : jamais envoyés au service des invités ; ils restent sur l’appareil de l’hôte.

### Où sont les données sur l’appareil

| Appareil | Emplacement |
|---|---|
| Mac | `~/Library/Application Support/Sono` |
| Windows | `%APPDATA%\Sono` |
| iPhone | Dans l’app uniquement |

**Vider le cache** (Réglages → Stockage) ferme la session en cours, efface le cache et ferme l’app.

### Ce que la suppression de l’app efface

| Appareil | Comment | Ce qui est supprimé |
|---|---|---|
| iPhone | Supprimer l’app comme d’habitude | Tout : iOS efface l’app et toutes ses données (Sono n’utilise pas le trousseau, qu’iOS garderait) |
| Windows | Paramètres → Applications → Sono → **Désinstaller** | Tout : l’app, ses données, le cache de sa fenêtre et le réglage d’égaliseur du moteur Deezer. Installer une nouvelle version par-dessus garde tout (sessions, comptes, réglages) |
| Mac | Glisser Sono à la Corbeille | L’app seulement (voir ci-dessous) |

> [!IMPORTANT]
> Sur Mac, macOS ne prévient pas une app qu’on la met à la Corbeille : ses données restent. Pour tout effacer, supprimez
> aussi `~/Library/Application Support/Sono`, `~/Library/Caches/app.sono.desktop`, `~/Library/WebKit/app.sono.desktop`
> et `~/Library/Preferences/app.sono.desktop.plist` (Finder → Aller → Aller au dossier).

Les sessions de l’app iPhone gardées par le service en ligne ne dépendent pas de l’appareil : supprimez la session
avant de supprimer l’app, sinon elle disparaît d’elle-même après 7 jours sans activité.

---

## 🧱 Architecture

Sono se compose de **trois parties** qui partagent les mêmes pages pour les invités.

### 💻 App ordinateur

```
┌──────────────────────────── App Sono (Tauri) ─────────────────────────────┐
│   Fenêtre (WebView)  ──  interface Preact : tableau de bord de l’hôte      │
│          │                                                                │
│   Serveur Rust (axum + tokio)  ── sessions, file, invités, admins, son,    │
│          │                        catalogue, temps réel (WebSocket)        │
│          ├── Moteur Deezer (Go, OpenDeezer) : processus à part, piloté en HTTP local
│          ├── cloudflared : lien « Internet », téléchargé au 1er usage       │
│          └── pages des invités (même interface Preact)                     │
└──────────────┬────────────────────────────────────────┬────────────────────┘
               │ Wi-Fi (adresse locale)                 │ 4G/5G (lien public)
          📱 invités                                📱 invités
```

- L’**interface** (Preact) est servie par le **serveur Rust** intégré : la fenêtre de l’app et les téléphones des invités chargent les mêmes pages, l’hôte voit le tableau de bord et les invités leur page.

- Le **temps réel** passe par WebSocket : chaque changement (titre ajouté, lecture, arrivée) est diffusé à tous.
- Le **moteur Deezer** est un petit programme Go basé sur OpenDeezer : il récupère, déchiffre et joue l’audio. Le serveur Rust le lance avec le compte de l’hôte et le pilote (lecture, pause, position, préchargement, égaliseur).
- **Apple Music** est joué par MusicKit JS dans l’interface.

### 📱 App iPhone + service en ligne

```
┌─────────────── App iPhone (SwiftUI) ───────────────┐        ┌──────── Cloudflare ────────┐
│  Écrans SwiftUI · Store (état de la session)       │  HTTPS │  Worker (API Sono)          │
│  Driver : suit la session, pilote la lecture   ────┼───────▶│  Durable Object « SonoHub » │
│    ├── Moteur Deezer (Go, compilé dans l’app)       │  WS    │   (sessions en SQLite)      │
│    └── Apple Music (MPMusicPlayerController)        │◀───────│  Pages des invités (web/)   │
│  CarPlay · écran verrouillé · TV en recopie         │        └──────────────┬──────────────┘
└─────────────────────────────────────────────────────┘                       │ Wi-Fi ou 4G/5G
                                                                         📱 invités
```

- Le **service en ligne** (Cloudflare Workers) remplace le serveur de l’ordinateur : il garde les sessions dans un **Durable Object** (stockage SQLite), sert l’API et les pages des invités, et diffuse les changements en WebSocket. Il reprend les mêmes règles et les mêmes routes que le serveur Rust.

- L’**app iPhone** crée la session, l’affiche (tableau de bord natif) et **joue la musique** : la session décide, l’iPhone suit.
- Le **moteur Deezer** est le même code Go que sur ordinateur, compilé en bibliothèque pour iPhone (`libsonoengine.a`) et lancé dans l’app. **Apple Music** passe par le lecteur d’iOS.
- L’**écran TV** (recopie AirPlay ou câble) affiche le mode TV du site des invités dans une vue web.

---

## 🧰 Technologies utilisées

| Partie | Technologies |
|---|---|
| Interface web (hôte PC et invités) | **Preact** (à la place de React, plus léger), **Vite**, icônes **Lucide**, **qrcode.react**, polices **DM Sans** et **Manrope** |
| App ordinateur | **Tauri 2** (fenêtre native et installateurs), **Rust** 2021 |
| Serveur intégré | **axum** (HTTP et WebSocket), **tokio**, **reqwest** (rustls), **serde_json**, **tower-http** |
| Lien public | **cloudflared** (Cloudflare Quick Tunnel), téléchargé et vérifié (SHA-256) au premier usage |
| Traductions | Dictionnaires maison, sans bibliothèque : `i18n.js` et `i18n-en.js` (pages web), `Strings.swift` (iPhone) |
| Moteur Deezer | **Go**, bibliothèque **OpenDeezer** avec correctifs (tampons, égaliseur, gain, saut), sortie audio **oto** |
| App iPhone | **SwiftUI**, **AVFoundation**, **MediaPlayer**, **CarPlay**, **VisionKit** (QR code), **WebKit**, **Security** |
| Service en ligne | **Cloudflare Workers** + **Durable Objects** (SQLite), outil **Wrangler**, mini-routeur maison façon Express |
| Fabrication | **cargo**, **@tauri-apps/cli** ; Windows depuis Mac avec **cargo-xwin**, **LLVM**, **NSIS** et **Zig** ; iPhone avec **Xcode** |

**Optimisations** : Preact au lieu de React (≈ 120 Ko de moins), styles compressés (lightningcss), parties de l’hôte
chargées seulement quand l’hôte ouvre son tableau de bord ; serveur Rust compilé optimisé pour la taille (`opt-level =
"z"`, LTO, `panic = "abort"`, symboles retirés) ; `cloudflared` téléchargé au premier usage au lieu d’être livré
(installateurs de 25 à 7 Mo) ; Swift compilé pour la taille (`-Osize`) ; moteur Go compilé sans symboles (`-trimpath -ldflags "-s -w"`) ;
ombres et pochettes précalculées sur iPhone pour des défilements fluides.

---

## 🗂 Organisation du dépôt

```
Sono/
├── README-FR.md                    ← ce fichier
├── README.md                       ← la version anglaise
├── LICENSE                         ← licence AGPL-3.0
├── Sono App/                       ← app ordinateur (Mac, Windows)
│   ├── src/                        interface Preact : App.jsx (invités, accueil, tableau de bord),
│   │                               host.jsx (réglages, connexions, activité, mode TV), styles.css,
│   │                               i18n.js + i18n-en.js (langue de l’interface)
│   ├── tauri/
│   │   ├── src/main.rs             fenêtre, logo au démarrage, connexion Deezer, Apple Music
│   │   ├── src/server/             serveur Rust : routes, logique, temps réel, catalogue, Deezer, tunnel
│   │   ├── icon/Sono.icon          icône macOS 26 (claire, sombre, teintée) ; icons/ pour Windows
│   │   └── tauri.conf.json         version, fenêtre, installateurs
│   ├── server/
│   │   └── opendeezer-bridge/      code Go du moteur Deezer et ses correctifs
│   └── packaging/
│       ├── fabriquer-tauri.sh      fabrique le DMG et l’EXE (sur Mac)
│       └── fabriquer-windows.ps1   fabrique l’EXE (sur un PC Windows)
└── Sono Mobile/                    ← app iPhone et service en ligne
    ├── ios/                        app SwiftUI (Sono.xcodeproj, Config.xcconfig, Local.xcconfig.exemple)
    ├── engine/                     moteur Deezer Go pour iPhone (build/ : bibliothèques déjà compilées)
    ├── cloud/                      service en ligne Cloudflare (worker.js, wrangler.jsonc)
    ├── web/                        pages des invités, page Rejoindre et écran TV (Preact)
    ├── deploy.sh                   met en ligne le service et note son adresse pour l’app
    ├── install-iphone.sh           fabrique et installe l’app sur l’iPhone branché
    └── fabriquer-ipa.sh            fabrique l’IPA sans signature
```

---

## 🛠 Fabriquer les apps soi-même

| Ce qu’on fabrique | Sur un Mac | Sur un PC Windows |
|---|---|---|
| App ordinateur pour Mac (DMG) | ✅ | ❌ |
| App ordinateur pour Windows (EXE) | ✅ | ✅ |
| App iPhone (IPA) | ✅ | ❌ (Xcode n’existe que sur Mac) |

Récupérez d’abord le code, avec git :

```bash
git clone https://github.com/raphaelprs0/Sono.git
```

```bash
cd Sono
```

ou avec le bouton **Code → Download ZIP** sur GitHub (décompressez, puis ouvrez le dossier).

Lancez les commandes une par une et attendez la fin de chacune.

### 🍎 Sur un Mac

Tout se fait dans l’app **Terminal** (Applications → Utilitaires → Terminal).

#### Ce qu’il faut

| Outil | Pour | Installation |
|---|---|---|
| **Xcode** | tout (compilateurs, iPhone, icône Mac) | App Store, puis ouvrez-le une fois |
| **Homebrew** | installer les autres outils | [brew.sh](https://brew.sh) |
| **Node.js** 20+ | interface web, service en ligne | `brew install node` |
| **Rust** | app ordinateur | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` (options par défaut), puis rouvrez le Terminal |
| **Go** | moteur Deezer | [go.dev/dl](https://go.dev/dl) |
| **Zig** | moteur Deezer pour Windows (compilé à chaque fabrication de l’app ordinateur) | `brew install zig` |

Pour l’IPA seule, **Xcode suffit** : les autres outils ne servent qu’à l’app ordinateur.

Après Xcode, sélectionnez-le pour le Terminal :

```bash
sudo xcode-select -s /Applications/Xcode.app
```

```bash
sudo xcodebuild -license accept
```

#### 💻 App ordinateur (DMG et EXE)

```bash
cd "Sono App"
```

```bash
npm install
```

```bash
sh packaging/fabriquer-tauri.sh
```

Le script construit l’interface, le moteur Deezer (Mac et Windows) et l’icône, puis fabrique
`Sono-<version>-arm64.dmg` à la racine du dépôt. La première fois prend plusieurs minutes.

**Pour l’EXE Windows**, installez une fois les outils (LLVM, NSIS, cargo-xwin et la cible Windows de Rust ; la licence
du kit Microsoft est acceptée automatiquement), puis relancez la fabrication :

```bash
sh packaging/fabriquer-tauri.sh outils-windows
```

```bash
sh packaging/fabriquer-tauri.sh
```

`Sono-Setup-<version>.exe` arrive à côté du DMG.

**Changer de version** : modifiez `version` dans `Sono App/tauri/tauri.conf.json` (et dans `package.json` et
`tauri/Cargo.toml` pour rester cohérent).

**Mode développement** : `npm run app` compile et lance l’app sans installateur. Elle utilise l’interface déjà
construite (`npx vite build`) et les programmes de `packaging/bin/`, préparés par une première fabrication complète.

#### 📱 IPA (app iPhone)

L’IPA se fabrique avec **une seule commande**. Il faut seulement **Xcode** (avec la plateforme iOS installée : Xcode →
Réglages → Composants) ; le moteur Deezer de l’iPhone est déjà compilé dans `Sono Mobile/engine/build/`.

```bash
cd "Sono Mobile"
```

```bash
./fabriquer-ipa.sh
```

Le script :

1. vérifie que Xcode est installé ;
2. compile l’app en version finale pour iPhone (**Release**), **sans signature** ;
3. range l’app dans un dossier `Payload/` et le compresse en IPA ;
4. affiche son emplacement : `Sono-<version>-iPhone-a-signer.ipa`, à la racine du dépôt.

La première fois prend quelques minutes, les suivantes sont plus rapides. En cas d’erreur, le script affiche seulement
les lignes `error:` de la compilation.

La version de l’IPA est celle du projet Xcode (`MARKETING_VERSION`, actuellement **2.5.8**). Elle n’a **aucune
signature** et ne contient aucune information personnelle : elle doit être signée avec votre propre compte Apple
pour s’installer.

<details>
<summary>Ce que fait le script, en résumé</summary>

```bash
# 1. L’app, en Release, sans signature
xcodebuild -project ios/Sono.xcodeproj -scheme Sono -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" build

# 2. L’IPA : le dossier Payload/ compressé
mkdir -p build/ipa/Payload
cp -R build/dd/Build/Products/Release-iphoneos/Sono.app build/ipa/Payload/
(cd build/ipa && zip -qry ../Sono-2.5.8-iPhone-a-signer.ipa Payload)
```

</details>

**Recompiler le moteur Deezer de l’iPhone** (seulement après une modification du code Go, il faut alors Go) :

```bash
cd "Sono Mobile/engine" && ./build-ios.sh ios
```

#### 📲 Installer directement sur son iPhone (sans IPA)

1. Copiez `Sono Mobile/ios/Local.xcconfig.exemple` en `Sono Mobile/ios/Local.xcconfig` et mettez-y votre **équipe
   Apple** (`DEVELOPMENT_TEAM`, 10 caractères : Xcode → Réglages → Comptes). Ce fichier reste sur votre Mac, il n’est
   jamais envoyé sur GitHub.
2. Si Xcode refuse l’identifiant `app.sono.mobile` (déjà pris par un autre compte Apple), ajoutez dans le même fichier :
   `SONO_BUNDLE_ID = com.votrenom.sono`.
3. Branchez l’iPhone (déverrouillé, Mode développeur activé), puis :

```bash
cd "Sono Mobile"
```

```bash
./install-iphone.sh
```

Le script recompile le moteur Deezer (il faut Go), fabrique l’app et l’installe. Avec un compte Apple gratuit,
relancez-le tous les 7 jours.

> Si vous choisissez votre équipe dans Xcode (Signing & Capabilities), Xcode l’écrit dans le projet : préférez
> `Local.xcconfig` pour ne pas l’envoyer sur GitHub.

### 🪟 Sur un PC Windows

Un PC Windows 10 ou 11 (64 bits) fabrique l’**EXE** de l’app ordinateur. Tout se fait dans **PowerShell** (menu
Démarrer → tapez « PowerShell »).

#### Ce qu’il faut

| Outil | Pour | Installation (dans PowerShell) |
|---|---|---|
| **Node.js** 20+ | interface web | `winget install OpenJS.NodeJS.LTS` |
| **Outils de génération Visual Studio** (C++) | compilateur utilisé par Rust | voir la commande ci-dessous |
| **Rust** | app ordinateur | `winget install Rustlang.Rustup` |
| **Go** | moteur Deezer | `winget install GoLang.Go` |
| **Zig** | compilateur C du moteur Deezer | `winget install zig.zig` |
| **Git** (facultatif) | récupérer le code | `winget install Git.Git` |

Les outils de génération Visual Studio, avec la partie C++ :

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait"
```

**Fermez puis rouvrez PowerShell** après les installations, pour qu’il trouve les nouveaux outils. WebView2, utilisé
par la fenêtre de l’app, est déjà présent sur Windows 10 et 11.

#### Fabriquer l’EXE

```powershell
cd "Sono App"
```

```powershell
powershell -ExecutionPolicy Bypass -File packaging\fabriquer-windows.ps1
```

Le script :

1. vérifie que Node.js, Rust, Go et Zig sont installés ;
2. construit l’interface (pages de l’hôte et des invités) ;
3. compile le moteur Deezer (OpenDeezer avec les correctifs de Sono) ;
4. fabrique l’app et son installateur avec Tauri, qui télécharge NSIS tout seul la première fois.

`Sono-Setup-<version>.exe` arrive à la racine du dépôt. La première fabrication prend plusieurs minutes.

> [!NOTE]
> Ce script est récent et n’a pas encore été essayé sur un vrai PC Windows. La méthode éprouvée reste la fabrication de
> l’EXE depuis un Mac (voir plus haut). Si une étape échoue, ouvrez une *issue* avec le message affiché.

> `-ExecutionPolicy Bypass` autorise ce script seulement pour cette fois : Windows bloque par défaut les scripts
> PowerShell téléchargés.

---

## ☁️ Le service en ligne (Cloudflare)

L’app iPhone (et la fonction « Rejoindre une session iPhone » de l’app ordinateur) utilise un service en ligne. Le
projet est **déjà configuré avec un service en ligne** : l’app fonctionne telle quelle. L’adresse est dans
`Sono Mobile/ios/Config.xcconfig` (`SONO_SERVER_URL`).

Pour avoir **votre propre service** (vos sessions sur votre compte, vos limites gratuites), il suffit d’un compte
**Cloudflare** gratuit.

### 1. Créer le compte

1. Inscrivez-vous sur [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) (gratuit).
2. Ouvrez **Workers & Pages** une première fois : Cloudflare vous fait choisir votre **sous-domaine** `workers.dev`.
   Vos services auront l’adresse `https://<service>.<sous-domaine>.workers.dev`.

### 2. Relier le Mac à Cloudflare

```bash
cd "Sono Mobile/cloud"
```

```bash
npm install
```

```bash
npx wrangler login
```

Le navigateur s’ouvre : autorisez **Wrangler** (l’outil de Cloudflare) à accéder à votre compte.

### 3. (Facultatif) Choisir le nom du service

Dans `Sono Mobile/cloud/wrangler.jsonc`, `"name": "sono-mobile"` donne l’adresse
`https://sono-mobile.<sous-domaine>.workers.dev`. Changez-le avant la première mise en ligne si vous voulez.

Le stockage des sessions (**Durable Object** SQLite) est inclus dans l’offre gratuite : rien à activer.

### 4. Mettre en ligne

```bash
cd "Sono Mobile"
```

```bash
./deploy.sh
```

Le script construit les pages des invités, met le service en ligne et **écrit sa nouvelle adresse** dans
`Config.xcconfig`. Vérifiez en ouvrant `https://<service>.<sous-domaine>.workers.dev/rejoindre` : la page
« Rejoindre » de Sono doit s’afficher.

Ensuite, refabriquez l’**app iPhone** (et l’**app ordinateur**, qui lit la même adresse) pour qu’elles utilisent votre
service. Après une mise à jour, Cloudflare peut mettre une vingtaine de secondes à servir la nouvelle version.

### Essayer sans rien mettre en ligne (simulateur)

```bash
cd "Sono Mobile/cloud" && npm run dev
```

La commande construit les pages des invités, puis lance le service sur votre Mac (`http://127.0.0.1:8787`). Mettez `SONO_SERVER_URL = http:/$()/127.0.0.1:8787` dans
`Config.xcconfig`, puis lancez l’app dans le simulateur depuis Xcode.

---

## 🩺 En cas de problème

| Problème | Solution |
|---|---|
| Mac : « Sono ne peut pas être ouvert » | Réglages Système → Confidentialité et sécurité → **Ouvrir quand même** |
| Windows : « Windows a protégé votre ordinateur » | **Informations complémentaires → Exécuter quand même** |
| Les invités du Wi-Fi n’arrivent pas à ouvrir la page | Même réseau Wi-Fi que l’ordinateur ; autoriser Sono dans le pare-feu ; sinon activer **« Internet »** |
| Le lien « Internet » ne se crée pas | Vérifier la connexion Internet, réessayer ; la première fois, Sono télécharge `cloudflared` (patienter) ; certains réseaux (entreprise, école) bloquent les tunnels |
| Rien ne joue | Connecter Deezer ou Apple Music dans **Connexions**, et vérifier l’abonnement |
| Changer de langue | Réglages → Apparence → **Langue** (ordinateur et iPhone) |
| Revenir aux couleurs d’origine | Réglages → Apparence → **Réinitialiser l’apparence** (ordinateur et iPhone) |
| iPhone : l’app ne s’ouvre plus | La signature gratuite a expiré (7 jours) : réinstaller l’app |
| iPhone : « Développeur non approuvé » | Réglages → Général → VPN et gestion de l’appareil → faire confiance |
| `xcode-select: error` ou `xcodebuild: command not found` | Installer Xcode, puis `sudo xcode-select -s /Applications/Xcode.app` |
| `cargo: command not found` | Installer Rust, puis fermer et rouvrir le Terminal |
| `go: command not found` | Installer Go depuis go.dev/dl |
| Xcode refuse l’identifiant de l’app | Mettre `SONO_BUNDLE_ID = com.votrenom.sono` dans `ios/Local.xcconfig` |
| « Outils Windows absents » | `sh packaging/fabriquer-tauri.sh outils-windows`, puis relancer la fabrication |
| Windows : « l’exécution de scripts est désactivée » | Lancer le script avec `powershell -ExecutionPolicy Bypass -File packaging\fabriquer-windows.ps1` |
| Windows : « link.exe introuvable » ou erreur du linker | Installer les outils de génération Visual Studio avec la partie C++, puis rouvrir PowerShell |
| Windows : « zig », « go » ou « cargo » est introuvable | Installer l’outil avec winget, puis fermer et rouvrir PowerShell |

---

## 🙏 Crédits

- [**OpenDeezer**](https://github.com/Cycl0o0/OpenDeezer) (AGPL-3.0) : la bibliothèque sur laquelle repose le moteur Deezer, utilisée avec des correctifs propres à Sono.

- [**oto**](https://github.com/ebitengine/oto) : sortie audio du moteur Deezer.
- [**Tauri**](https://tauri.app), [**axum**](https://github.com/tokio-rs/axum), [**tokio**](https://tokio.rs) : app ordinateur et serveur.
- [**Preact**](https://preactjs.com), [**Vite**](https://vite.dev), [**Lucide**](https://lucide.dev), [**qrcode.react**](https://github.com/zpao/qrcode.react) : interface web.
- [**cloudflared**](https://github.com/cloudflare/cloudflared) et [**Cloudflare Workers**](https://workers.cloudflare.com) : lien public et service en ligne.
- Polices [**DM Sans**](https://fonts.google.com/specimen/DM+Sans) et [**Manrope**](https://fonts.google.com/specimen/Manrope) (SIL Open Font License).

---

## ⚠️ Avertissement

Sono est un projet indépendant et personnel. Il n’est ni affilié, ni approuvé, ni soutenu par Deezer SA ou Apple Inc.
« Deezer », « Apple Music », « AirPlay » et « CarPlay » sont des marques de leurs propriétaires respectifs. L’app
nécessite votre propre compte et votre propre abonnement, et son utilisation reste soumise aux conditions d’utilisation
de ces services. Les fonds illustrés et les pochettes affichées appartiennent à leurs ayants droit. Ce logiciel est
fourni tel quel, sans aucune garantie.

---

## 📄 Licence

Sono est un logiciel libre distribué sous la licence **GNU Affero General Public License v3.0** (AGPL-3.0) : voir le
fichier [LICENSE](LICENSE). C’est la licence d’OpenDeezer, sur lequel repose le moteur Deezer.

En résumé : vous pouvez utiliser, étudier, modifier et redistribuer Sono, à condition de garder la même licence et de
fournir le code source de vos versions. Comme Sono s’utilise aussi à distance (les invités passent par des pages
web), une version modifiée mise à disposition d’autres personnes doit également leur donner accès à son code source.
Ce résumé ne remplace pas le texte de la licence.
