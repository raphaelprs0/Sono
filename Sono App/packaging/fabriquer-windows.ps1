# Fabrique Sono sur un PC Windows : Sono-Setup-<version>.exe, à la racine du projet.
# Version : celle de « tauri/tauri.conf.json ».
# Outils : Node.js, Rust (rustup) avec les « Outils de génération Visual Studio » (C++), Go et Zig.
# Lancement (depuis le dossier « Sono App ») :
#   powershell -ExecutionPolicy Bypass -File packaging\fabriquer-windows.ps1
$ErrorActionPreference = 'Stop'
$K = $PSScriptRoot
$app = Split-Path $K -Parent
$root = Split-Path $app -Parent

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "« $cmd » est introuvable : $hint" }
}
function Run($what) {
  if ($LASTEXITCODE -ne 0) { throw "Échec : $what (code $LASTEXITCODE)." }
}
Need node 'installez Node.js depuis nodejs.org, puis rouvrez PowerShell.'
Need cargo 'installez Rust depuis rustup.rs, puis rouvrez PowerShell.'
Need go 'installez Go depuis go.dev/dl, puis rouvrez PowerShell.'
Need zig 'installez Zig (winget install zig.zig), puis rouvrez PowerShell.'

$version = (Get-Content (Join-Path $app 'tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
Write-Host "Fabrication de Sono $version pour Windows..."

# Le chemin du dossier personnel ne doit pas rester dans le programme distribué.
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"

# 1. Interface (pages de l'hôte et des invités)
Push-Location $app
npm install --no-fund --no-audit; Run 'npm install'
npx vite build; Run "construction de l'interface"
Pop-Location

# 2. Dossier des outils livrés avec l'app (cloudflared n'y est plus : Sono le télécharge au premier lien « Internet »)
$bin = Join-Path $K 'bin/win32-x64'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

# 3. Moteur Deezer (Go, OpenDeezer avec les correctifs de _patches/ et _oto_patch/), comme server/opendeezer-bridge/build.sh
Write-Host 'Compilation du moteur Deezer...'
$bridge = Join-Path $app 'server/opendeezer-bridge'
Push-Location $bridge
$module = (go list -m -f '{{.Dir}}' github.com/Cycl0o0/OpenDeezer/v3); Run "téléchargement d'OpenDeezer"
$oto = (go list -m -f '{{.Dir}}' github.com/ebitengine/oto/v3); Run "téléchargement d'oto"
$work = Join-Path ([IO.Path]::GetTempPath()) ("sono-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  # Les fichiers du cache de Go sont en lecture seule : la copie est rendue modifiable.
  Copy-Item -Recurse $module (Join-Path $work 'opendeezer')
  Copy-Item -Recurse $oto (Join-Path $work 'oto')
  Get-ChildItem $work -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
  Copy-Item -Recurse -Force (Join-Path $bridge '_patches/*') (Join-Path $work 'opendeezer')
  Copy-Item -Force (Join-Path $bridge '_oto_patch/*.go') (Join-Path $work 'oto')
  $player = Join-Path $work 'opendeezer/internal/audio/player.go'
  $source = [IO.File]::ReadAllText($player)
  # Démarrage plus rapide d'un titre non préchargé : 1 s d'audio d'avance au lieu de 2 s.
  if (-not $source.Contains('prebufferB  = 2 * bytesPerSec')) { throw 'OpenDeezer a changé : correctif « prebuffer » introuvable.' }
  $source = $source.Replace('prebufferB  = 2 * bytesPerSec', 'prebufferB  = bytesPerSec')
  # Niveau sonore : voir _patches/internal/audio/gain.go.
  $gain = [regex]'(?m)^func dbToFactor\(db float64\) float64 \{\r?$'
  if (-not $gain.IsMatch($source)) { throw 'OpenDeezer a changé : correctif « gain » introuvable.' }
  $source = $gain.Replace($source, "func dbToFactor(db float64) float64 {`n`tdb = adjustGain(db)", 1)
  [IO.File]::WriteAllText($player, $source)
  Copy-Item (Join-Path $bridge 'go.mod'), (Join-Path $bridge 'go.sum') $work
  $modfile = Join-Path $work 'go.mod'
  go mod edit "-modfile=$modfile" "-replace=github.com/Cycl0o0/OpenDeezer/v3=$(Join-Path $work 'opendeezer')" "-replace=github.com/ebitengine/oto/v3=$(Join-Path $work 'oto')"; Run 'préparation du moteur'
  $env:CGO_ENABLED = '1'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
  $env:CC = 'zig cc -target x86_64-windows-gnu'; $env:CXX = 'zig c++ -target x86_64-windows-gnu'
  go build "-modfile=$modfile" -trimpath -ldflags '-s -w' -o (Join-Path $bin 'sono-deezer-bridge.exe') .; Run 'compilation du moteur Deezer'
} finally {
  Pop-Location
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  Remove-Item Env:CC, Env:CXX, Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

# 4. App et installateur (Tauri télécharge NSIS lui-même la première fois)
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
  Write-Host "Pas sous Windows : arrêt avant l'installateur (le moteur et l'interface sont prêts)."
  exit 0
}
Write-Host "Fabrication de l'app et de l'installateur (plusieurs minutes la première fois)..."
Push-Location (Join-Path $app 'tauri')
npx --yes '@tauri-apps/cli@2' build --bundles nsis; Run "fabrication de l'app"
$setup = "target/release/bundle/nsis/Sono_${version}_x64-setup.exe"
Copy-Item -Force $setup (Join-Path $root "Sono-Setup-$version.exe")
Remove-Item -Recurse -Force 'target/release/bundle' -ErrorAction SilentlyContinue
Pop-Location
Write-Host "✅ $(Join-Path $root "Sono-Setup-$version.exe")"
