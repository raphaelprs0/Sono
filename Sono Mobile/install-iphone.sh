#!/bin/sh
# Compile et installe Sono sur l’iPhone branché en USB (déverrouillé, mode développeur activé).
set -e
cd "$(dirname "$0")"
(cd engine && ./build-ios.sh ios)
device=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /connected|available \(paired\)/ { for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/ || $i ~ /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/) { print $i; exit } }')
[ -n "$device" ] || { echo "Aucun iPhone branché."; exit 1; }
cd ios
xcodebuild -project Sono.xcodeproj -scheme Sono -configuration Release -destination "id=$device" -derivedDataPath build -allowProvisioningUpdates build | tail -2
xcrun devicectl device install app --device "$device" build/Build/Products/Release-iphoneos/Sono.app
echo "Sono est installé sur l’iPhone."
