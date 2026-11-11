#!/bin/sh
# Compile le moteur Deezer pour Mac (server/bin) et Windows (server/bin/win32-x64), avec les correctifs de _patches/ et _oto_patch/.
# Usage : sh build.sh [mac] [win] [dossier de sortie, par défaut ../bin]
set -e
cd "$(dirname "$0")"
out=${3:-$(mkdir -p ../bin && cd ../bin && pwd)}
module=$(go list -m -f '{{.Dir}}' github.com/Cycl0o0/OpenDeezer/v3)
oto=$(go list -m -f '{{.Dir}}' github.com/ebitengine/oto/v3)
work=$(mktemp -d)
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT
cp -R "$module" "$work/opendeezer"; chmod -R u+w "$work/opendeezer"; cp -R _patches/. "$work/opendeezer/"
# Démarrage plus rapide d’un titre non préchargé : 1 s d’audio d’avance au lieu de 2 s.
grep -q 'prebufferB  = 2 \* bytesPerSec' "$work/opendeezer/internal/audio/player.go"
sed -i '' 's/prebufferB  = 2 \* bytesPerSec/prebufferB  = bytesPerSec/' "$work/opendeezer/internal/audio/player.go"
# Niveau sonore : voir _patches/internal/audio/gain.go.
grep -q '^func dbToFactor(db float64) float64 {$' "$work/opendeezer/internal/audio/player.go"
sed -i '' 's/^func dbToFactor(db float64) float64 {$/func dbToFactor(db float64) float64 {\
	db = adjustGain(db)/' "$work/opendeezer/internal/audio/player.go"
# La sortie audio du Mac doit pouvoir vider sa file (voir _oto_patch).
cp -R "$oto" "$work/oto"; chmod -R u+w "$work/oto"; cp _oto_patch/*.go "$work/oto/"
cp go.mod go.sum "$work/"
go mod edit -modfile="$work/go.mod" -replace "github.com/Cycl0o0/OpenDeezer/v3=$work/opendeezer" -replace "github.com/ebitengine/oto/v3=$work/oto"
for target in ${1:-mac} ${2:-}; do
  if [ "$target" = win ]; then
    mkdir -p "$out/win32-x64"
    CC="zig cc -target x86_64-windows-gnu" CXX="zig c++ -target x86_64-windows-gnu" CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
      go build -modfile="$work/go.mod" -trimpath -ldflags "-s -w" -o "$out/win32-x64/sono-deezer-bridge.exe" .
  else
    go build -modfile="$work/go.mod" -trimpath -ldflags "-s -w" -o "$out/sono-deezer-bridge" .
  fi
  echo "ok $target"
done
