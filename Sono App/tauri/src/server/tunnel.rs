// Lien public (« Internet ») : tunnel cloudflared préparé en arrière-plan puis gardé ouvert.
// Activer ou désactiver l’accès à distance ne fait qu’ouvrir ou fermer la porte, sans relancer Cloudflare.
use super::state::Shared;
use axum::extract::ws::{CloseFrame, Message};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub fn stop(app: &Shared) {
    if let Some(mut child) = app.tunnel_child.lock().unwrap().take() { let _ = child.start_kill(); }
    let mut s = app.lock();
    s.public_tunnel_url.clear();
    s.public_link_enabled = false;
}

pub fn close_public_sockets(app: &Shared) {
    let s = app.lock();
    for list in s.clients.values() {
        for client in list.iter().filter(|c| c.meta.via_tunnel) {
            let _ = client.tx.send(Message::Close(Some(CloseFrame { code: 4001, reason: "Lien public désactivé".into() })));
        }
    }
}

/// Sonde le tunnel en passant directement par le réseau Cloudflare, sans résolution DNS du nouveau nom :
/// une recherche trop précoce met « introuvable » en cache pendant une minute.
async fn probe(url: &str) -> Result<u16, String> {
    let host = url.trim_start_matches("https://").split('/').next().unwrap_or("").to_string();
    let edge = tokio::net::lookup_host(("api.trycloudflare.com", 443)).await.ok().and_then(|mut a| a.find(|x| x.is_ipv4()));
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(3));
    if let Some(edge) = edge { builder = builder.resolve(&host, edge); }
    let client = builder.build().map_err(|e| e.to_string())?;
    client.get(format!("https://{host}/api/health")).send().await.map(|r| r.status().as_u16()).map_err(|e| e.to_string())
}

// cloudflared n’est plus livré dans l’app (près de 40 Mo sur Mac, 55 Mo sur Windows) : il est téléchargé depuis
// Cloudflare à la première ouverture du lien public, vérifié (empreinte SHA-256 fixée ici), puis gardé dans les données de Sono.
const CLOUDFLARED_VERSION: &str = "2026.10.4";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const CLOUDFLARED_ASSET: (&str, &str) = ("cloudflared-darwin-arm64.tgz", "68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f");
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const CLOUDFLARED_ASSET: (&str, &str) = ("cloudflared-darwin-amd64.tgz", "f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d");
#[cfg(all(windows, target_arch = "x86_64"))]
const CLOUDFLARED_ASSET: (&str, &str) = ("cloudflared-windows-amd64.exe", "411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8");
#[cfg(not(any(all(target_os = "macos", any(target_arch = "aarch64", target_arch = "x86_64")), all(windows, target_arch = "x86_64"))))]
const CLOUDFLARED_ASSET: (&str, &str) = ("", "");

/// Rend le chemin de cloudflared : variable SONO_CLOUDFLARED_BIN, copie livrée avec l’app, ou copie téléchargée.
async fn cloudflared(app: &Shared) -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("SONO_CLOUDFLARED_BIN") { return Ok(path.into()); }
    let bundled = app.binary("cloudflared");
    if bundled.exists() { return Ok(bundled); }
    let dir = app.data_dir.join("bin");
    let exe = if cfg!(windows) { ".exe" } else { "" };
    // Un nom par version : une copie déjà lancée (fichier verrouillé sous Windows) n’a jamais à être remplacée.
    let target = dir.join(format!("cloudflared-{CLOUDFLARED_VERSION}{exe}"));
    if target.exists() { return Ok(target); }
    let (asset, expected) = CLOUDFLARED_ASSET;
    let failed = |e: String| format!("Téléchargement du connecteur d’accès public impossible : {e}");
    if asset.is_empty() { return Err("Impossible de lancer le connecteur d’accès public.".into()); }
    let url = format!("https://github.com/cloudflare/cloudflared/releases/download/{CLOUDFLARED_VERSION}/{asset}");
    let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).build().map_err(|e| failed(e.to_string()))?;
    let bytes = client.get(url).send().await.and_then(|r| r.error_for_status()).map_err(|e| failed(e.to_string()))?.bytes().await.map_err(|e| failed(e.to_string()))?;
    use sha2::Digest;
    if hex::encode(sha2::Sha256::digest(&bytes)) != expected { return Err("Le connecteur d’accès public téléchargé est invalide.".into()); }
    let program = if asset.ends_with(".tgz") { untar_cloudflared(&bytes).ok_or("Le connecteur d’accès public téléchargé est invalide.")? } else { bytes.to_vec() };
    // Écrit sous un nom provisoire unique, puis renommé. Sous Windows, l’antivirus garde souvent le fichier tout
    // juste écrit pendant son analyse (« Accès refusé ») : on réessaie, et au pire la copie provisoire sert telle quelle.
    let temporary = dir.join(format!("cloudflared-{CLOUDFLARED_VERSION}-{:08x}{exe}", rand::random::<u32>()));
    let write = async {
        tokio::fs::create_dir_all(&dir).await?;
        tokio::fs::write(&temporary, &program).await?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; tokio::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o755)).await?; }
        Ok::<(), std::io::Error>(())
    };
    write.await.map_err(|e| failed(e.to_string()))?;
    for _ in 0..20 {
        if tokio::fs::rename(&temporary, &target).await.is_ok() || target.exists() { break; }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let ready = if target.exists() { let _ = std::fs::remove_file(&temporary); target } else { temporary };
    // Les anciennes copies (autres versions, essais interrompus) sont effacées quand elles ne servent plus.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path != ready && (name.starts_with("cloudflared") || name == "cloudflared.version") { let _ = std::fs::remove_file(&path); }
        }
    }
    Ok(ready)
}

/// Extrait le fichier « cloudflared » de l’archive .tgz publiée par Cloudflare (format tar simple).
fn untar_cloudflared(tgz: &[u8]) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut tar = Vec::new();
    flate2::read::GzDecoder::new(tgz).read_to_end(&mut tar).ok()?;
    let mut offset = 0;
    while offset + 512 <= tar.len() {
        let header = &tar[offset..offset + 512];
        let name = String::from_utf8_lossy(&header[..100]).trim_end_matches('\0').to_string();
        if name.is_empty() { return None; }
        let size = usize::from_str_radix(String::from_utf8_lossy(&header[124..136]).trim_matches(|c: char| c == '\0' || c == ' '), 8).ok()?;
        let start = offset + 512;
        if name.trim_start_matches("./") == "cloudflared" { return tar.get(start..start + size).map(<[u8]>::to_vec); }
        offset = start + size.div_ceil(512) * 512;
    }
    None
}

pub async fn start(app: &Shared) -> Result<String, String> {
    let _guard = app.tunnel_start.lock().await;
    {
        let s = app.lock();
        if !s.public_tunnel_url.is_empty() { return Ok(s.public_tunnel_url.clone()); }
    }
    let executable = cloudflared(app).await?;
    if !executable.exists() { return Err("Impossible de lancer le connecteur d’accès public.".into()); }
    let mut command = Command::new(&executable);
    command.args(["tunnel", "--url", &format!("http://127.0.0.1:{}", app.port), "--no-autoupdate"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).env("GOGC", "60").env("GOMEMLIMIT", "80MiB").kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(|_| "Impossible de lancer le connecteur d’accès public.".to_string())?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)].into_iter().flatten() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(line)) = lines.next_line().await { if std::env::var("SONO_DEBUG").is_ok() { eprintln!("[tunnel] {line}"); } let _ = tx.send(line); }
        });
    }
    drop(tx);
    *app.tunnel_child.lock().unwrap() = Some(child);
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut url: Option<String> = None;
    let mut registered = false;
    let pattern = regex::Regex::new(r"(?i)https://[a-z0-9-]+\.trycloudflare\.com").unwrap();
    let failure = |app: &Shared, message: &str| { stop(app); Err(message.to_string()) };
    while !(registered && url.is_some()) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, rx.recv()).await {
            Err(_) => return failure(app, "Le service d’accès public n’a pas répondu à temps. Vérifiez votre connexion Internet."),
            Ok(None) => return failure(app, "Le connecteur d’accès public s’est arrêté avant de créer le lien."),
            Ok(Some(line)) => {
                if url.is_none() { url = pattern.find(&line).map(|m| m.as_str().to_string()); }
                if line.contains("Registered tunnel connection") { registered = true; }
            }
        }
    }
    let url = url.unwrap();
    // Cloudflare met environ une seconde à router un tunnel tout juste enregistré : sondé toutes les demi-secondes.
    loop {
        if Instant::now() > deadline { return failure(app, "Le service d’accès public n’a pas répondu à temps. Vérifiez votre connexion Internet."); }
        if app.tunnel_child.lock().unwrap().is_none() { return Err("Le connecteur d’accès public s’est arrêté avant de créer le lien.".into()); }
        if probe(&url).await == Ok(200) { break; }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    app.lock().public_tunnel_url = url.clone();
    // Le connecteur s’arrête plus tard (réseau coupé…) : le lien disparaît avec lui.
    let watcher = app.clone();
    let mine = url.clone();
    tokio::spawn(async move {
        while rx.recv().await.is_some() {}
        let mut s = watcher.lock();
        if s.public_tunnel_url != mine { return; }
        s.public_tunnel_url.clear();
        s.public_link_enabled = false;
        drop(s);
        watcher.tunnel_child.lock().unwrap().take();
    });
    Ok(url)
}
