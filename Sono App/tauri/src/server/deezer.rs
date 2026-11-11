// Moteur Deezer (programme Go à côté de l’app) : démarrage avec l’ARL, commandes de lecture, journal, égaliseur.
use super::logic::{add_activity, now_iso, sound_eq};
use super::state::{DeezerConn, Shared};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub fn stop_bridge(app: &Shared) {
    // Fermer son entrée suffit à arrêter le moteur ; on l’arrête aussi directement.
    app.deezer_stdin.lock().unwrap().take();
    if let Some(mut child) = app.deezer_child.lock().unwrap().take() {
        let _ = child.start_kill();
    }
}

/// Lance le moteur Deezer avec ce compte. Il répond sur sa sortie une ligne JSON {ready, port, account}.
pub async fn start_bridge(app: &Shared, arl: String) -> Result<Value, String> {
    let executable = app.binary("sono-deezer-bridge");
    if !executable.exists() { return Err("Le moteur Deezer est introuvable.".into()); }
    stop_bridge(app);
    app.lock().deezer = None;
    let token = uuid::Uuid::new_v4().to_string();
    let mut command = Command::new(&executable);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).env("GOGC", "60").env("GOMEMLIMIT", "300MiB").kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(|_| "Impossible de lancer le moteur Deezer.".to_string())?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let line = format!("{}\n", json!({ "arl": arl, "token": token }));
    let _ = stdin.write_all(line.as_bytes()).await;
    // L’entrée reste ouverte : le moteur s’arrête de lui-même dès que Sono disparaît.
    *app.deezer_stdin.lock().unwrap() = Some(stdin);
    let errors = tokio::spawn(async move { let mut s = String::new(); let _ = stderr.read_to_string(&mut s).await; s });
    *app.deezer_child.lock().unwrap() = Some(child);
    let mut reader = BufReader::new(stdout);
    let mut first = String::new();
    let read = tokio::time::timeout(Duration::from_secs(30), reader.read_line(&mut first)).await;
    // La suite de la sortie est lue (et ignorée) pour que le moteur ne se bloque jamais en écrivant.
    tokio::spawn(async move { let mut sink = Vec::new(); let _ = reader.read_to_end(&mut sink).await; });
    let fail = |app: &Shared, message: String| { stop_bridge(app); Err(message) };
    match read {
        Err(_) => return fail(app, "Le moteur Deezer n’a pas répondu à temps.".into()),
        Ok(Err(_)) | Ok(Ok(0)) => {
            let text = tokio::time::timeout(Duration::from_secs(1), errors).await.ok().and_then(|r| r.ok()).unwrap_or_default();
            let tail: String = text.trim().chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
            return fail(app, if tail.is_empty() { "Le moteur Deezer s’est arrêté pendant la connexion.".into() } else { tail });
        }
        Ok(Ok(_)) => {}
    }
    let message: Value = match serde_json::from_str(first.trim()) { Ok(v) => v, Err(_) => return fail(app, "Le moteur Deezer n’a pas pu démarrer.".into()) };
    let port = message.get("port").and_then(Value::as_u64);
    if message.get("ready") != Some(&json!(true)) || port.is_none() {
        return fail(app, message.get("error").and_then(Value::as_str).unwrap_or("Le moteur Deezer n’a pas pu démarrer.").to_string());
    }
    let account = message.get("account").cloned().unwrap_or(json!({}));
    let user_id = super::logic::text(account.get("userId"), 40);
    {
        let mut s = app.lock();
        s.deezer = Some(DeezerConn { url: format!("http://127.0.0.1:{}", port.unwrap()), token, transient: true, arl: arl.clone(), user_id });
        s.saved_deezer_arl = arl;
    }
    watch_bridge(app.clone());
    let app2 = app.clone();
    tokio::spawn(async move { let _ = apply_sound(&app2).await; });
    Ok(account)
}

/// Le moteur s’arrête (plantage) : la connexion disparaît, comme avant.
fn watch_bridge(app: Shared) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let exited = {
                let mut guard = app.deezer_child.lock().unwrap();
                match guard.as_mut() {
                    None => return,
                    Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                }
            };
            if exited {
                app.deezer_child.lock().unwrap().take();
                let mut s = app.lock();
                if s.deezer.as_ref().map(|d| d.transient).unwrap_or(false) { s.deezer = None; }
                return;
            }
        }
    });
}

pub fn log_engine(app: &Shared, line: &str) {
    let time = chrono::Local::now().format("%H:%M:%S%.3f");
    {
        let mut log = app.engine_log.lock().unwrap();
        log.push(format!("{time}  {line}"));
        let excess = log.len().saturating_sub(400);
        log.drain(..excess);
    }
    // Journal écrit au plus toutes les 2 s, pas à chaque commande.
    if app.engine_log_scheduled.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        app.engine_log_scheduled.store(false, Ordering::SeqCst);
        let text = format!("{}\n", app.engine_log.lock().unwrap().join("\n"));
        let _ = tokio::fs::write(app.data_dir.join("moteur.log"), text).await;
    });
}

pub enum Method { Get, Post }

pub async fn request(app: &Shared, path: &str, method: Method, body: Option<Value>) -> Result<Value, String> {
    let quiet = ["/status", "/whoami", "/search", "/eq"].iter().any(|p| path.starts_with(p));
    let started = std::time::Instant::now();
    let result = request_raw(app, path, method, body).await;
    if !quiet {
        match &result {
            Ok(_) => log_engine(app, &format!("{path}  → ok ({} ms)", started.elapsed().as_millis())),
            Err(e) => log_engine(app, &format!("{path}  → erreur : {e}")),
        }
    }
    result
}

async fn request_raw(app: &Shared, path: &str, method: Method, body: Option<Value>) -> Result<Value, String> {
    let conn = app.lock().deezer.clone().ok_or("Deezer n’est pas connecté.")?;
    let url = format!("{}{}", conn.url, path);
    let mut builder = match method { Method::Get => app.http.get(&url), Method::Post => app.http.post(&url) };
    if !conn.token.is_empty() { builder = builder.header("X-OpenDeezer-Token", &conn.token); }
    if let Some(body) = body { builder = builder.header("Content-Type", "application/json").body(body.to_string()); }
    let response = builder.timeout(Duration::from_secs(6)).send().await.map_err(|e| if e.is_timeout() { "Le moteur Deezer n’a pas répondu à temps.".to_string() } else { "fetch failed".to_string() })?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let data: Value = if text.is_empty() { json!({ "ok": true }) } else { serde_json::from_str(&text).unwrap_or_else(|_| json!({ "ok": true, "message": text })) };
    if !status.is_success() {
        return Err(data.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("OpenDeezer a répondu avec le code {}.", status.as_u16())));
    }
    Ok(data)
}

pub async fn apply_sound(app: &Shared) -> Result<Value, String> {
    let eq = sound_eq(&app.lock().sound);
    request(app, "/eq", Method::Post, Some(eq)).await
}

pub fn is_unavailable(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("2002") || m.contains("no full-length") || m.contains("sufficient rights") || m.contains("preview only")
}

/// Quand l’hôte quitte ou supprime sa session, la musique s’arrête.
pub async fn stop_session_music(app: &Shared, code: &str, reason: &str) {
    let pause_engine = {
        let mut s = app.lock();
        let deezer_ready = s.deezer.is_some();
        let playing_here = s.deezer_playing_session.as_deref() == Some(code);
        let Some(session) = s.sessions.get_mut(code) else { return };
        if session.get("playing") != Some(&json!(true)) { return; }
        session["playing"] = json!(false);
        // Le lecteur Deezer est partagé : seule la session qui l’a lancé peut le mettre en pause.
        session.get("playbackSource").and_then(Value::as_str) == Some("Deezer") && deezer_ready && playing_here
    };
    if pause_engine {
        if let Ok(status) = request(app, "/status", Method::Get, None).await {
            if status.get("state").and_then(Value::as_str).map(|s| s.to_lowercase()) == Some("playing".into()) {
                let _ = request(app, "/playpause", Method::Post, None).await;
            }
        }
    }
    {
        let mut s = app.lock();
        if let Some(session) = s.sessions.get_mut(code) { add_activity(session, "music", reason); }
    }
    app.persist();
    app.broadcast(code);
    let _ = now_iso;
}
