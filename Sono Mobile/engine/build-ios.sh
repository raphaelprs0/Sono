#!/bin/sh
# Compile le moteur pour iPhone (ios) et pour le simulateur (sim), avec les correctifs de _patches/.
# Résultat : build/<cible>/libsonoengine.a et son en-tête.
set -e
cd "$(dirname "$0")"
module=$(go list -m -f '{{.Dir}}' github.com/Cycl0o0/OpenDeezer/v3)
work=$(mktemp -d)
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT
cp -R "$module" "$work/opendeezer"; chmod -R u+w "$work/opendeezer"; cp -R _patches/. "$work/opendeezer/"
# Démarrage plus rapide d’un titre non préchargé : 1 s d’audio d’avance au lieu de 2 s.
grep -q 'prebufferB  = 2 \* bytesPerSec' "$work/opendeezer/internal/audio/player.go"
sed -i '' 's/prebufferB  = 2 \* bytesPerSec/prebufferB  = bytesPerSec/' "$work/opendeezer/internal/audio/player.go"
# La sortie audio d’iPhone doit pouvoir vider sa file (voir _oto_patch).
oto=$(go list -m -f '{{.Dir}}' github.com/ebitengine/oto/v3)
cp -R "$oto" "$work/oto"; chmod -R u+w "$work/oto"; cp _oto_patch/*.go "$work/oto/"
cp go.mod go.sum "$work/"
go mod edit -modfile="$work/go.mod" -replace "github.com/ebitengine/oto/v3=$work/oto"
go mod edit -modfile="$work/go.mod" -replace "github.com/Cycl0o0/OpenDeezer/v3=$work/opendeezer"
for target in ${1:-sim ios}; do
  if [ "$target" = sim ]; then sdk=iphonesimulator; tgt=arm64-apple-ios16.0-simulator; else sdk=iphoneos; tgt=arm64-apple-ios16.0; fi
  sysroot=$(xcrun --sdk $sdk --show-sdk-path)
  mkdir -p build/$target
  CC="$(xcrun --sdk $sdk -f clang) -target $tgt -isysroot $sysroot" CGO_ENABLED=1 GOOS=ios GOARCH=arm64 \
    CGO_CFLAGS="-target $tgt -isysroot $sysroot" CGO_LDFLAGS="-target $tgt -isysroot $sysroot" \
    go build -modfile="$work/go.mod" -trimpath -ldflags "-s -w" -buildmode=c-archive -tags ios -o build/$target/libsonoengine.a .
  echo "ok $target"
done
