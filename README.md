# 🎧 Sono · Music is for sharing

[🇫🇷 **French**](README-FR.md) · 🇬🇧 **English**

![Version](https://img.shields.io/badge/Version-2.5.12-7927F5)
![Windows](https://img.shields.io/badge/Windows-10%2F11-2798F5?logo=windows)
![macOS](https://img.shields.io/badge/macOS-12%2B-black?logo=apple)
![iOS](https://img.shields.io/badge/iOS-17%2B-black?logo=apple)

![Rust](https://img.shields.io/badge/Server-Rust-FF2E2E?logo=rust&logoColor=white)
![SwiftUI](https://img.shields.io/badge/SwiftUI-Native-FF4A17?logo=swift&logoColor=white)
![Go](https://img.shields.io/badge/Engine-Go-00ADD8?logo=go&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-FF7C00?logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-AGPL--3.0-29A825)

**Your guests pick the music, your speaker plays it.** The host starts a session, guests scan a QR code with their phone and
suggest tracks: everyone sees the queue, the music plays on **Deezer** or **Apple Music**, and nobody has to install
anything to join in.

> 💬 **Contact :** On Discord ``@raphaelprs``
>
> 🤖 **Vibe-coded project :** Partially written by an AI, then tested at every stage on real machines.
>
> ⚠️ **Unofficial app :** Not affiliated with Deezer or Apple: see the [Disclaimer](#%EF%B8%8F-disclaimer).


**At a glance**

- 💻 **Desktop app** (Mac and Windows): the computer plays the music and hosts the guests, on Wi-Fi or from anywhere
  thanks to the « Internet » public link.

- 📱 **iPhone app**: the same thing without a computer, the iPhone plays the music and guests go through an online
  service (Wi-Fi or 4G/5G).
- 🙋 **Guests**: a web browser is all they need (iPhone, Android, computer), no account and no app.
- 🎵 **You need**: a **Deezer** or **Apple Music** account, for the host only.
- 📦 **Install**: from the [Releases](../../releases) page (.dmg for macOS, .exe for Windows, .ipa for iOS), or by
  building the app yourself.

| | Desktop app | iPhone app |
|---|---|---|
| Devices | Mac (Apple Silicon, macOS 12+), Windows 10/11 64-bit | iPhone, iOS 17 or later |
| Version | 2.5.12 | 2.5.12 (build 22) |
| Interface | Preact (web) in a **Tauri 2** window | Native **SwiftUI** |
| Guest server | **Rust** (axum, tokio), built into the app | **Cloudflare Workers** + Durable Objects |
| Deezer playback | **Go** engine (OpenDeezer) running next to the app | The same **Go** engine, compiled into the app |
| Deezer quality | Lossless FLAC when the subscription allows it, otherwise MP3 320 or 128 kbps | Same |
| Apple Music playback | MusicKit JS (Apple Music window) | iOS MusicKit (system player) |
| Guests off the Wi-Fi | « Internet » public link (Cloudflare tunnel) | Always (online service) |
| Languages | English, French | English, French |
| Size | DMG ≈ 7 MB, EXE ≈ 7 MB | IPA ≈ 3.7 MB |

---

## 📑 Contents

1. [Project goal](#-project-goal)
2. [Features](#-features)
3. [Download and install](#-download-and-install)
4. [Music accounts](#-music-accounts)
5. [Privacy](#-privacy)
6. [Architecture](#-architecture)
7. [Technologies](#-technologies)
8. [Repository layout](#-repository-layout)
9. [Building the apps yourself](#-building-the-apps-yourself)
10. [The online service (Cloudflare)](#%EF%B8%8F-the-online-service-cloudflare)
11. [Troubleshooting](#-troubleshooting)
12. [Credits](#-credits)
13. [Disclaimer](#%EF%B8%8F-disclaimer)
14. [License](#-license)

---

## 🎯 Project goal

At a party, the music often goes through one person’s phone: everyone else has to ask them, or grab their phone.
Sono fixes that:

1. The **host** opens Sono and creates a session (a name, their first name, optionally guest approval).
2. Sono shows a **QR code** and a short code such as `SONO-4821`.
3. **Guests** scan the QR code (or type the address): a page opens in their browser, they enter their first name and
   search for tracks.
4. Each suggested track joins the **shared queue**, visible to everyone, with the first name of whoever added it.
5. The host’s device **plays the queue** in order, moves from track to track and, when the queue is empty, can carry on
   with **background music** (a playlist, an album or an artist).

The host stays in control: they rearrange the queue, remove a track, accept or turn down newcomers, appoint admins and
adjust the sound. The aim: an app that is **simple for guests** (nothing to install, no account), **lightweight**
(installers of about 7 MB, an iPhone app using about 40 MB of memory) and **nice to look at**, right up to the TV.

---

## ✨ Features

### 🙋 For guests (in the browser)

- **Join in one move**: scan the QR code, or open `address/1234`. On iPhone, an « Open in the Sono app » link opens the session in the app when it is installed.
- **First name** shown next to their tracks (it can no longer be changed once in the session).

- **Track search** (by title, artist or album), on the playback app chosen by the host (Deezer or Apple Music).
- **The live queue**: current track, “Up next”, suggested tracks and background music, updated in real time.
- **Waiting room** when the host approves each guest: the page waits for the answer, and the guest can ask again if
  they were turned down.
- **Admins**: a guest appointed admin by the host gets the controls straight away (playback, next and previous track,
  queue, arrivals), without access to the settings or the connections.
- **End of session**: if the host deletes the session, guests see an end screen.
- **Host’s colors and language**: the guest page uses the background, the color and the language (English or French) chosen by the host.

### 🎛 For the host (computer and iPhone)

- **Queue**: drag to reorder, remove a track (button, or swipe left on iPhone), total suggested duration.

- **Playback**: play/pause, next and previous track, progress bar, automatic transitions, next track preloaded to avoid
  gaps.
- **Background music**: a playlist, an album or an artist takes over when the queue is empty; its tracks can be
  reordered or skipped.
- **Guests**: list of who is there, approval of arrivals (optional), removing a guest, appointing admins, a banner when
  someone joins.
- **Activity**: session log (tracks added, arrivals, changes) and statistics.
- **Sound**: 3-band equalizer (bass, mids, treble) with presets (“Flat”, “More bass”, “Clear vocals”…), for
  Deezer playback.
- **Appearance**: Black, White (light theme), Automatic (black or white following the system setting) and current
  cover backgrounds; Lemon, Lilac, Raspberry, Gold, Pleins Phares and Native accent colors (Native is white on a dark
  background and black on a light one, never the color of the background). Every element (buttons, cards, windows,
  Liquid Glass) adapts to the chosen background and color. Liquid Glass is off by default, with a button to go back to
  the original settings. By default: Black background and Lemon accent.
- **Language**: English or French (Settings → Appearance → Language). By default, the device’s language; guests and the
  TV screen follow the host’s language.
- **TV mode**: a full-screen view for the TV, with the cover, the title, the progress bar, the next track and the QR
  code (their layout is set in the desktop app). It opens by growing out of the player and closes by shrinking back into
  it, the same animation in reverse. Escape leaves TV mode without taking the window out of full screen. The playback
  buttons sit centered under the bar, large enough to be seen from across the room, and the « current cover » background
  keeps clearly visible colors whether the cover is dark, pale or very bright.
- **Covers found**: a track without a cover (or with Deezer’s empty image) gets one, looked up on Deezer and then on the
  iTunes Store from its artist and title, background music included. Imported tracks (your own files uploaded to Deezer,
  songs from your Apple Music library) keep their cover as it is.
- **Clear the cache**: shows the cache size, then closes the current session and the app to start from scratch (after confirmation). Accounts and the « Internet » link connector are kept.
- **App version**: shown at the bottom of the settings (computer and iPhone).
- **No surprise restarts**: relaunching the app doesn’t restart the music on its own; disconnecting the music app resets
  the session (current track, queue, history, background music).

### 💻 Extra on the desktop app

- **Wi-Fi**: guests on the same network open the local address shown (with a short link without a port number when possible).

- **« Internet »**: a public link (Cloudflare tunnel, `trycloudflare.com`) for guests on 4G/5G. The `cloudflared` tool
  isn’t shipped with the app: it is downloaded once from Cloudflare the first time the link is turned on (≈ 20 MB on
  Mac, 55 MB on Windows) and checked before use. The link is prepared as soon as the host’s dashboard is open (closed to
  guests until then), so switching from Wi-Fi to Internet is instant.
- **Keyboard shortcuts**: Space (play/pause), → or N (next), ← or P (previous), and media keys.
- **Deezer sign-in** through the official page, in a private window of the app.
- **Join an iPhone session** from the computer, with its `SONO-1234` code.
- On Mac, closing the window **keeps Sono running** (music and guests carry on); Cmd+Q quits it.

### 📱 Extra on the iPhone app

- **Native** SwiftUI app, lightweight (≈ 40 MB of memory), with a full-screen player you swipe down to close.

- **Lock screen and Control Center**: title, artwork, position and controls.
- **AirPlay**: audio output button, in the accent color when an AirPlay speaker is in use.
- **CarPlay**: current track, queue and invitation QR code on the car screen.
- **TV mirroring** (AirPlay or cable): the TV shows TV mode full size while the iPhone stays usable.
- **Join with a QR code**: Sono’s camera reads a session’s QR code; the session opens inside the app.
- **Background music**: playback continues with the screen off.

---

## 📥 Download and install

Everything is on the repository’s **[Releases](../../releases)** page.

| File | For |
|---|---|
| `Sono-<version>-arm64.dmg` | Mac with an Apple chip (M1, M2, M3, M4…). Does not run on Intel Macs. |
| `Sono-Setup-<version>.exe` | Windows 10 or 11, 64-bit. |
| `Sono-<version>.ipa` | iPhone: unsigned IPA, to be signed with your own Apple account. |

The apps are **not signed by Apple or Microsoft** (that requires paid accounts): the system shows a warning on first
launch. This is expected.

###  🍎 Mac

1. Open the DMG and drag **Sono** into **Applications**.
2. On first launch, macOS says the app “cannot be opened”. Go to **System Settings → Privacy & Security**, then click
   **Open Anyway** at the bottom of the page.
3. Allow Sono to accept incoming connections if macOS asks: this is what lets Wi-Fi guests join the session.

### 🪟 Windows

1. Run `Sono-Setup-<version>.exe`.
2. If SmartScreen shows “Windows protected your PC”, click **More info → Run anyway**.
3. Allow Sono through the **firewall** (private networks) when Windows asks.

The installation is for the current user, without administrator rights.

---

## 🔑 Music accounts

Only the **host** needs an account. Guests search the chosen app’s catalog without an account.

### Deezer

- **Sign-in through Deezer’s official page**, opened in a private window of the app. Once signed in, Sono keeps only
  the `arl` session cookie and closes the page.

- This cookie gives access to the account like a password: **never share it**.
- It is kept **on the device only**, in the app’s data (encrypted by iOS on iPhone, excluded from backups), and goes
  away with the app (see [Privacy](#-privacy)).
- You need a Deezer subscription that allows on-demand playback.

### Apple Music

- **iPhone**: Sono asks for permission to use Apple Music, then plays the tracks with the iOS player.

- **Computer**: sign in from the app’s Apple Music window (MusicKit JS); playback happens on the computer.
- You need an Apple Music subscription.

If both apps are connected, the host chooses which one plays the music; guest searches go through that one.

---

## 🔐 Privacy

- **No ads, no analytics, no tracking.** Sono only contacts what it needs: Deezer or Apple for the catalog and playback, and the guest service.

- **Guests** only give a **first name**. No account, no email address.
- **Desktop app**: the session, the queue and the guests stay **on the computer** (built-in server). The « Internet »
  public link goes through a Cloudflare tunnel only when it is turned on; the `cloudflared` tool is then downloaded
  once from Cloudflare’s official page (GitHub).
- **iPhone app**: the session (name, guests’ first names, queue, history) is kept by the **online service**. Sessions
  unused for **7 days** are deleted automatically, and at most 200 sessions are kept. Deleting the session erases it
  immediately.
- **Music credentials**: never sent to the guest service; they stay on the host’s device.

### Where the data lives on the device

| Device | Location |
|---|---|
| Mac | `~/Library/Application Support/Sono` |
| Windows | `%APPDATA%\Sono` |
| iPhone | Inside the app only |

**Clear the cache** (Settings → Storage) closes the current session, clears the cache and
closes the app.

### What deleting the app erases

| Device | How | What gets deleted |
|---|---|---|
| iPhone | Delete the app as usual | Everything: iOS erases the app and all its data (Sono doesn’t use the keychain, which iOS would keep) |
| Windows | Settings → Apps → Sono → **Uninstall** | Everything: the app, its data, its window cache and the Deezer engine’s equalizer setting. Installing a new version over it keeps everything (sessions, accounts, settings) |
| Mac | Drag Sono to the Trash | The app only (see below) |

> [!IMPORTANT]
> On Mac, macOS doesn’t tell an app it is being moved to the Trash: its data stays. To erase everything, also delete
> `~/Library/Application Support/Sono`, `~/Library/Caches/app.sono.desktop`, `~/Library/WebKit/app.sono.desktop` and
> `~/Library/Preferences/app.sono.desktop.plist` (Finder → Go → Go to Folder).

iPhone sessions kept by the online service don’t depend on the device: delete the session before deleting the app,
otherwise it disappears on its own after 7 days without activity.

---

## 🧱 Architecture

Sono is made of **three parts** that share the same guest pages.

### 💻 Desktop app

```
┌──────────────────────────── Sono app (Tauri) ─────────────────────────────┐
│   Window (WebView)  ──  Preact interface: host dashboard                  │
│          │                                                                │
│   Rust server (axum + tokio)  ── sessions, queue, guests, admins, sound,   │
│          │                        catalog, real time (WebSocket)           │
│          ├── Deezer engine (Go, OpenDeezer): separate process, driven over local HTTP
│          ├── cloudflared: « Internet » link, downloaded on first use        │
│          └── guest pages (same Preact interface)                          │
└──────────────┬────────────────────────────────────────┬────────────────────┘
               │ Wi-Fi (local address)                  │ 4G/5G (public link)
          📱 guests                                  📱 guests
```

- The **interface** (Preact) is served by the built-in **Rust server**: the app window and the guests’ phones load the same pages, the host sees the dashboard and guests see their page.

- **Real time** goes through WebSocket: every change (track added, playback, arrival) is broadcast to everyone.
- The **Deezer engine** is a small Go program based on OpenDeezer: it fetches, decrypts and plays the audio. The Rust
  server starts it with the host’s account and drives it (playback, pause, position, preloading, equalizer).
- **Apple Music** is played by MusicKit JS in the interface.

### 📱 iPhone app + online service

```
┌─────────────── iPhone app (SwiftUI) ───────────────┐        ┌──────── Cloudflare ────────┐
│  SwiftUI screens · Store (session state)           │  HTTPS │  Worker (Sono API)          │
│  Driver: follows the session, drives playback  ────┼───────▶│  Durable Object « SonoHub » │
│    ├── Deezer engine (Go, compiled into the app)    │  WS    │   (sessions in SQLite)      │
│    └── Apple Music (MPMusicPlayerController)        │◀───────│  Guest pages (web/)         │
│  CarPlay · lock screen · TV mirroring               │        └──────────────┬──────────────┘
└─────────────────────────────────────────────────────┘                       │ Wi-Fi or 4G/5G
                                                                         📱 guests
```

- The **online service** (Cloudflare Workers) replaces the computer’s server: it keeps sessions in a **Durable Object** (SQLite storage), serves the API and the guest pages, and broadcasts changes over WebSocket. It follows the same rules and routes as the Rust server.

- The **iPhone app** creates the session, displays it (native dashboard) and **plays the music**: the session decides, the iPhone follows.
- The **Deezer engine** is the same Go code as on the computer, compiled as a library for iPhone (`libsonoengine.a`) and run inside the app. **Apple Music** goes through the iOS player.
- The **TV screen** (AirPlay or cable mirroring) shows the guest site’s TV mode in a web view.

---

## 🧰 Technologies

| Part | Technologies |
|---|---|
| Web interface (PC host and guests) | **Preact** (instead of React, lighter), **Vite**, **Lucide** icons, **qrcode.react**, **DM Sans** and **Manrope** fonts |
| Desktop app | **Tauri 2** (native window and installers), **Rust** 2021 |
| Built-in server | **axum** (HTTP and WebSocket), **tokio**, **reqwest** (rustls), **serde_json**, **tower-http** |
| Public link | **cloudflared** (Cloudflare Quick Tunnel), downloaded and checked (SHA-256) on first use |
| Translations | Home-made dictionaries, no library: `i18n.js` and `i18n-en.js` (web pages), `Strings.swift` (iPhone) |
| Deezer engine | **Go**, **OpenDeezer** library with patches (buffers, equalizer, gain, skip), **oto** audio output |
| iPhone app | **SwiftUI**, **AVFoundation**, **MediaPlayer**, **CarPlay**, **VisionKit** (QR code), **WebKit**, **Security** |
| Online service | **Cloudflare Workers** + **Durable Objects** (SQLite), **Wrangler** tool, a small home-made Express-style router |
| Build | **cargo**, **@tauri-apps/cli**; Windows from Mac with **cargo-xwin**, **LLVM**, **NSIS** and **Zig**; iPhone with **Xcode** |

**Optimizations**: Preact instead of React (≈ 120 KB less), minified styles (lightningcss), host-only parts loaded only
when the host opens the dashboard; Rust server optimized for size (`opt-level = "z"`, LTO, `panic = "abort"`, symbols
stripped); `cloudflared` downloaded on first use instead of shipped (installers from 25 to 7 MB); Swift built for size
(`-Osize`); Go engine built without symbols (`-trimpath -ldflags "-s -w"`); shadows and covers pre-rendered on iPhone
for smooth scrolling.

---

## 🗂 Repository layout

```
Sono/
├── README.md                       ← this file
├── README-FR.md                    ← French README
├── LICENSE                         ← AGPL-3.0 license
├── Sono App/                       ← desktop app (Mac, Windows)
│   ├── src/                        Preact interface: App.jsx (guests, home, dashboard),
│   │                               host.jsx (settings, connections, activity, TV mode), styles.css,
│   │                               i18n.js + i18n-en.js (interface language)
│   ├── tauri/
│   │   ├── src/main.rs             window, startup logo, Deezer sign-in, Apple Music
│   │   ├── src/server/             Rust server: routes, logic, real time, catalog, Deezer, tunnel
│   │   ├── icon/Sono.icon          macOS 26 icon (light, dark, tinted); icons/ for Windows
│   │   └── tauri.conf.json         version, window, installers
│   ├── server/
│   │   └── opendeezer-bridge/      Go source of the Deezer engine and its patches
│   └── packaging/
│       ├── fabriquer-tauri.sh      builds the DMG and the EXE (on Mac)
│       └── fabriquer-windows.ps1   builds the EXE (on a Windows PC)
└── Sono Mobile/                    ← iPhone app and online service
    ├── ios/                        SwiftUI app (Sono.xcodeproj, Config.xcconfig, Local.xcconfig.exemple)
    ├── engine/                     Go Deezer engine for iPhone (build/: libraries already compiled)
    ├── cloud/                      Cloudflare online service (worker.js, wrangler.jsonc)
    ├── web/                        guest pages, join page and TV screen (Preact)
    ├── deploy.sh                   deploys the service and saves its address for the app
    ├── install-iphone.sh           builds and installs the app on the connected iPhone
    └── fabriquer-ipa.sh            builds the unsigned IPA
```

---

## 🛠 Building the apps yourself

| What you build | On a Mac | On a Windows PC |
|---|---|---|
| Desktop app for Mac (DMG) | ✅ | ❌ |
| Desktop app for Windows (EXE) | ✅ | ✅ |
| iPhone app (IPA) | ✅ | ❌ (Xcode only exists on Mac) |

First get the code, with git:

```bash
git clone https://github.com/raphaelprs0/Sono.git
```

```bash
cd Sono
```

or with the **Code → Download ZIP** button on GitHub (unzip it, then open the folder).

Run the commands one at a time and wait for each one to finish.

### 🍎 On a Mac

Everything happens in the **Terminal** app (Applications → Utilities → Terminal).

#### What you need

| Tool | For | Installation |
|---|---|---|
| **Xcode** | everything (compilers, iPhone, Mac icon) | App Store, then open it once |
| **Homebrew** | installing the other tools | [brew.sh](https://brew.sh) |
| **Node.js** 20+ | web interface, online service | `brew install node` |
| **Rust** | desktop app | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` (default options), then reopen the Terminal |
| **Go** | Deezer engine | [go.dev/dl](https://go.dev/dl) |
| **Zig** | Deezer engine for Windows (built every time the desktop app is built) | `brew install zig` |

For the IPA alone, **Xcode is enough**: the other tools are only needed for the desktop app.

After installing Xcode, select it for the Terminal:

```bash
sudo xcode-select -s /Applications/Xcode.app
```

```bash
sudo xcodebuild -license accept
```

#### 💻 Desktop app (DMG and EXE)

```bash
cd "Sono App"
```

```bash
npm install
```

```bash
sh packaging/fabriquer-tauri.sh
```

The script builds the interface, the Deezer engine (Mac and Windows) and the icon, then produces
`Sono-<version>-arm64.dmg` at the root of the repository. The first run takes several minutes.

**For the Windows EXE**, install the tools once (LLVM, NSIS, cargo-xwin and Rust’s Windows target; the Microsoft SDK
license is accepted automatically), then run the build again:

```bash
sh packaging/fabriquer-tauri.sh outils-windows
```

```bash
sh packaging/fabriquer-tauri.sh
```

`Sono-Setup-<version>.exe` lands next to the DMG.

**Changing the version**: edit `version` in `Sono App/tauri/tauri.conf.json` (and in `package.json` and
`tauri/Cargo.toml` to stay consistent).

**Development mode**: `npm run app` builds and runs the app without an installer. It uses the interface already built
(`npx vite build`) and the programs in `packaging/bin/`, prepared by a first full build.

#### 📱 IPA (iPhone app)

The IPA is built with **a single command**. You only need **Xcode** (with the iOS platform installed: Xcode → Settings
→ Components); the iPhone Deezer engine is already compiled in `Sono Mobile/engine/build/`.

```bash
cd "Sono Mobile"
```

```bash
./fabriquer-ipa.sh
```

The script:

1. checks that Xcode is installed;
2. compiles the app as a final iPhone build (**Release**), **without signing**;
3. puts the app in a `Payload/` folder and zips it into an IPA;
4. prints its location: `Sono-<version>-iPhone-a-signer.ipa`, at the root of the repository.

The first run takes a few minutes, later runs are faster. If something fails, the script prints only the compiler’s
`error:` lines.

The IPA version is the Xcode project’s (`MARKETING_VERSION`, currently **2.5.12**). It has **no signature** and contains no
personal information: it must be signed with your own Apple account to be installed.

<details>
<summary>What the script does, in short</summary>

```bash
# 1. The app, in Release, unsigned
xcodebuild -project ios/Sono.xcodeproj -scheme Sono -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" build

# 2. The IPA: the zipped Payload/ folder
mkdir -p build/ipa/Payload
cp -R build/dd/Build/Products/Release-iphoneos/Sono.app build/ipa/Payload/
(cd build/ipa && zip -qry ../Sono-2.5.12-iPhone-a-signer.ipa Payload)
```

</details>

**Rebuilding the iPhone Deezer engine** (only after changing the Go code, which then requires Go):

```bash
cd "Sono Mobile/engine" && ./build-ios.sh ios
```

#### 📲 Installing directly on your iPhone (without an IPA)

1. Copy `Sono Mobile/ios/Local.xcconfig.exemple` to `Sono Mobile/ios/Local.xcconfig` and put your **Apple team** in it
   (`DEVELOPMENT_TEAM`, 10 characters: Xcode → Settings → Accounts). This file stays on your Mac and is never pushed to
   GitHub.
2. If Xcode rejects the `app.sono.mobile` identifier (already taken by another Apple account), add to the same file:
   `SONO_BUNDLE_ID = com.yourname.sono`.
3. Connect the iPhone (unlocked, Developer Mode on), then:

```bash
cd "Sono Mobile"
```

```bash
./install-iphone.sh
```

The script rebuilds the Deezer engine (Go is required), builds the app and installs it. With a free Apple account,
run it again every 7 days.

> If you choose your team in Xcode (Signing & Capabilities), Xcode writes it into the project: prefer
> `Local.xcconfig` so it doesn’t end up on GitHub.

### 🪟 On a Windows PC

A Windows 10 or 11 (64-bit) PC builds the desktop app’s **EXE**. Everything happens in **PowerShell** (Start menu →
type “PowerShell”).

#### What you need

| Tool | For | Installation (in PowerShell) |
|---|---|---|
| **Node.js** 20+ | web interface | `winget install OpenJS.NodeJS.LTS` |
| **Visual Studio Build Tools** (C++) | compiler used by Rust | see the command below |
| **Rust** | desktop app | `winget install Rustlang.Rustup` |
| **Go** | Deezer engine | `winget install GoLang.Go` |
| **Zig** | C compiler for the Deezer engine | `winget install zig.zig` |
| **Git** (optional) | getting the code | `winget install Git.Git` |

Visual Studio Build Tools, with the C++ workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait"
```

**Close and reopen PowerShell** after installing, so it finds the new tools. WebView2, used by the app window, is
already present on Windows 10 and 11.

#### Building the EXE

```powershell
cd "Sono App"
```

```powershell
powershell -ExecutionPolicy Bypass -File packaging\fabriquer-windows.ps1
```

The script:

1. checks that Node.js, Rust, Go and Zig are installed;
2. builds the interface (host and guest pages);
3. compiles the Deezer engine (OpenDeezer with Sono’s patches);
4. builds the app and its installer with Tauri, which downloads NSIS by itself the first time.

`Sono-Setup-<version>.exe` lands at the root of the repository. The first build takes several minutes.

> [!NOTE]
> This script is new and hasn’t been tried on a real Windows PC yet. The proven method is still building the EXE from a
> Mac (see above). If a step fails, please open an *issue* with the message shown.

> `-ExecutionPolicy Bypass` allows this script just this once: Windows blocks downloaded PowerShell scripts by default.

---

## ☁️ The online service (Cloudflare)

The iPhone app (and the desktop app’s “join an iPhone session” feature) uses an online service. The project is
**already set up with an online service**: the app works as is. The address is in `Sono Mobile/ios/Config.xcconfig`
(`SONO_SERVER_URL`).

To have **your own service** (your sessions on your account, your own free limits), all you need is a free
**Cloudflare** account.

### 1. Create the account

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) (free).
2. Open **Workers & Pages** once: Cloudflare asks you to choose your `workers.dev` **subdomain**. Your services will
   have the address `https://<service>.<subdomain>.workers.dev`.

### 2. Connect the Mac to Cloudflare

```bash
cd "Sono Mobile/cloud"
```

```bash
npm install
```

```bash
npx wrangler login
```

The browser opens: allow **Wrangler** (Cloudflare’s tool) to access your account.

### 3. (Optional) Choose the service name

In `Sono Mobile/cloud/wrangler.jsonc`, `"name": "sono-mobile"` gives the address
`https://sono-mobile.<subdomain>.workers.dev`. Change it before the first deployment if you like.

Session storage (**Durable Object**, SQLite) is included in the free plan: nothing to turn on.

### 4. Deploy

```bash
cd "Sono Mobile"
```

```bash
./deploy.sh
```

The script builds the guest pages, deploys the service and **writes its new address** into `Config.xcconfig`. Check by
opening `https://<service>.<subdomain>.workers.dev/rejoindre`: Sono’s « Rejoindre » (“Join”) page should appear.

Then rebuild the **iPhone app** (and the **desktop app**, which reads the same address) so they use your service. After
an update, Cloudflare can take about twenty seconds to serve the new version.

### Trying it without deploying anything (simulator)

```bash
cd "Sono Mobile/cloud" && npm run dev
```

The command builds the guest pages, then runs the service on your Mac (`http://127.0.0.1:8787`). Put
`SONO_SERVER_URL = http:/$()/127.0.0.1:8787` in `Config.xcconfig`, then run the app in the simulator from Xcode.

---

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| Mac: “Sono cannot be opened” | System Settings → Privacy & Security → **Open Anyway** |
| Windows: “Windows protected your PC” | **More info → Run anyway** |
| Wi-Fi guests can’t open the page | Same Wi-Fi network as the computer; allow Sono through the firewall; otherwise turn on **« Internet »** |
| The « Internet » link isn’t created | Check the internet connection and try again; the first time, Sono downloads `cloudflared` (wait a moment); some networks (company, school) block tunnels |
| Nothing plays | Connect Deezer or Apple Music in **Connections**, and check the subscription |
| Change the language | Settings → Appearance → **Language** (computer and iPhone) |
| Back to the original colors | Settings → Appearance → **Reset appearance** (computer and iPhone) |
| iPhone: the app no longer opens | The free signature expired (7 days): reinstall the app |
| iPhone: “Untrusted Developer” | Settings → General → VPN & Device Management → trust |
| `xcode-select: error` or `xcodebuild: command not found` | Install Xcode, then `sudo xcode-select -s /Applications/Xcode.app` |
| `cargo: command not found` | Install Rust, then close and reopen the Terminal |
| `go: command not found` | Install Go from go.dev/dl |
| Xcode rejects the app identifier | Put `SONO_BUNDLE_ID = com.yourname.sono` in `ios/Local.xcconfig` |
| « Outils Windows absents » (Windows tools missing) | `sh packaging/fabriquer-tauri.sh outils-windows`, then run the build again |
| Windows: “running scripts is disabled” | Run the script with `powershell -ExecutionPolicy Bypass -File packaging\fabriquer-windows.ps1` |
| Windows: “link.exe not found” or a linker error | Install Visual Studio Build Tools with the C++ workload, then reopen PowerShell |
| Windows: “zig”, “go” or “cargo” not found | Install the tool with winget, then close and reopen PowerShell |

---

## 🙏 Credits

- [**OpenDeezer**](https://github.com/Cycl0o0/OpenDeezer) (AGPL-3.0) : the library the Deezer engine is built on, used with Sono-specific patches.

- [**oto**](https://github.com/ebitengine/oto) : the Deezer engine’s audio output.
- [**Tauri**](https://tauri.app), [**axum**](https://github.com/tokio-rs/axum), [**tokio**](https://tokio.rs) : desktop app and server.
- [**Preact**](https://preactjs.com), [**Vite**](https://vite.dev), [**Lucide**](https://lucide.dev),
  [**qrcode.react**](https://github.com/zpao/qrcode.react) : web interface.
- [**cloudflared**](https://github.com/cloudflare/cloudflared) and [**Cloudflare Workers**](https://workers.cloudflare.com) : public link and online service.
- [**DM Sans**](https://fonts.google.com/specimen/DM+Sans) and [**Manrope**](https://fonts.google.com/specimen/Manrope) fonts (SIL Open Font License).

---

## ⚠️ Disclaimer

Sono is an independent, personal project. It is not affiliated with, endorsed by or supported by Deezer SA or Apple Inc.
“Deezer”, “Apple Music”, “AirPlay” and “CarPlay” are trademarks of their respective owners. The app requires your own
account and subscription, and using it remains subject to those services’ terms of use. The illustrated backgrounds and
the covers shown belong to their rights holders. This software is provided as is, without any warranty.

---

## 📄 License

Sono is free software distributed under the **GNU Affero General Public License v3.0** (AGPL-3.0): see the
[LICENSE](LICENSE) file. It is the license of OpenDeezer, which the Deezer engine is built on.

In short: you may use, study, modify and redistribute Sono, as long as you keep the same license and provide the source
code of your versions. Since Sono is also used remotely (guests go through web pages), a modified version made available
to other people must also give them access to its source code. This summary does not replace the license text.

