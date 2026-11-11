#!/bin/sh
# Fabrique l’app iPhone sans signature : Sono-<version>-iPhone-a-signer.ipa, à la racine du projet.
# Elle s’installe ensuite avec un outil qui la signe avec votre compte Apple (Sideloadly, AltStore, Xcode…).
# Il faut seulement Xcode : le moteur Deezer de l’iPhone est déjà compilé dans engine/build/.
set -e
cd "$(dirname "$0")"
command -v xcodebuild >/dev/null || { echo "Xcode est introuvable : installez-le depuis l’App Store, puis : sudo xcode-select -s /Applications/Xcode.app"; exit 1; }
out=$(cd .. && pwd)
version=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' ios/Sono.xcodeproj/project.pbxproj | head -1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Fabrication de Sono $version pour iPhone (quelques minutes la première fois)…"
xcodebuild -project ios/Sono.xcodeproj -scheme Sono -configuration Release -destination "generic/platform=iOS" \
  -derivedDataPath "$work/dd" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" \
  build > "$work/xcodebuild.log" 2>&1 || { grep -E "error:" "$work/xcodebuild.log" | head -20; echo "La fabrication a échoué."; exit 1; }
mkdir -p "$work/Payload"
cp -R "$work/dd/Build/Products/Release-iphoneos/Sono.app" "$work/Payload/"
xattr -cr "$work/Payload"
rm -f "$out/Sono-$version-iPhone-a-signer.ipa"
(cd "$work" && zip -qry -9 -X "$out/Sono-$version-iPhone-a-signer.ipa" Payload)
echo "✅ $out/Sono-$version-iPhone-a-signer.ipa"
