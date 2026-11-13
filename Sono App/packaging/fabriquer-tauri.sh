#!/bin/sh
# Fabrique Sono 2 (Tauri + serveur Rust) : Sono-<version>-arm64.dmg (Mac) et Sono-Setup-<version>.exe (Windows),
# copiés à côté du projet. Version : celle de « tauri/tauri.conf.json » (à augmenter à chaque nouvelle version).
# Outils : Xcode et Rust (rustup). Pour l’installateur Windows en plus : cible x86_64-pc-windows-msvc, cargo-xwin,
# LLVM et NSIS (sans eux, seul le Mac est fabriqué ; « sh fabriquer-tauri.sh outils-windows » les installe).
set -e
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
if [ "$1" = outils-windows ]; then
  brew install llvm makensis && rustup target add x86_64-pc-windows-msvc && cargo install --locked cargo-xwin
  exit 0
fi
K=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$K/.." && pwd)
out=$(cd "$app/.." && pwd)
# makensis plante avec la langue « C » du terminal : on lui donne le français.
export LC_ALL=fr_FR.UTF-8 LANG=fr_FR.UTF-8
version=$(node -p "require('$app/tauri/tauri.conf.json').version")
# Les chemins de ce Mac (dossier personnel) ne doivent pas rester dans les programmes distribués.
export CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS="--remap-path-prefix=$HOME=~" CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="--remap-path-prefix=$HOME=~"
cd "$app"
npx vite build
# cloudflared (lien « Internet ») n’est plus livré : Sono le télécharge et le vérifie au premier usage (tauri/src/server/tunnel.rs).
mkdir -p "$K/bin/win32-x64"
sh server/opendeezer-bridge/build.sh mac win "$K/bin"
cd "$app/tauri"
# Icône macOS 26 (claire, sombre, teintée) compilée depuis tauri/icon/Sono.icon.
xcrun actool "$app/tauri/icon/Sono.icon" --compile "$app/tauri/icon" --platform macosx --minimum-deployment-target 12.0 --app-icon Sono --output-partial-info-plist /dev/null >/dev/null
rm -f "$app/tauri/icon/Sono.icns"
# Mac : l’app, puis un DMG compressé (sans mise en page par le Finder).
npx --yes @tauri-apps/cli@2 build --bundles app
root=$(mktemp -d); cp -R target/release/bundle/macos/Sono.app "$root/"; ln -s /Applications "$root/Applications"
rm -f "$out/Sono-$version-arm64.dmg"; hdiutil create -volname "Sono $version" -srcfolder "$root" -format ULMO "$out/Sono-$version-arm64.dmg" >/dev/null; rm -rf "$root"
# La copie de fabrication ne doit pas apparaître en double dans la recherche du Mac.
rm -rf target/release/bundle; touch target/.metadata_never_index
# Windows : compilé depuis le Mac (licence du kit Microsoft acceptée).
if ! command -v cargo-xwin >/dev/null || ! command -v makensis >/dev/null; then
  echo "Outils Windows absents : seul le Mac a été fabriqué. Pour l’EXE : sh \"$K/fabriquer-tauri.sh\" outils-windows"
  ls -la "$out/Sono-$version-arm64.dmg"; exit 0
fi
XWIN_ACCEPT_LICENSE=1 npx --yes @tauri-apps/cli@2 build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
cp "target/x86_64-pc-windows-msvc/release/bundle/nsis/Sono_${version}_x64-setup.exe" "$out/Sono-Setup-$version.exe"
rm -rf target/x86_64-pc-windows-msvc/release/bundle
ls -la "$out/Sono-$version-arm64.dmg" "$out/Sono-Setup-$version.exe"
