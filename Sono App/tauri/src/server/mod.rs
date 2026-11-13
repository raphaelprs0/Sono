// Serveur Sono : API, temps réel et interface, pour l’hôte (dans l’app) et les invités (Wi-Fi ou lien public).
pub mod catalog;
pub mod covers;
pub mod deezer;
pub mod logic;
pub mod routes;
pub mod state;
pub mod tunnel;
pub mod ws;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request, State as AxumState};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use serde_json::{json, Value};
use state::{App, Shared, State};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower_http::services::ServeDir;

pub struct Config {
    pub port: u16,
    pub short_port: u16,
    pub data_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub dist_dir: PathBuf,
}

fn load_state(path: &std::path::Path) -> State {
    let mut state = State { host_prefs: json!({ "appearance": null, "sessionCode": null }), ..Default::default() };
    if let Ok(text) = std::fs::read_to_string(path) {
        if let Ok(saved) = serde_json::from_str::<Value>(&text) {
            for session in saved.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default() {
                if let Some(code) = session.get("code").and_then(Value::as_str) { state.sessions.insert(code.to_string(), session.clone()); }
            }
            match saved.get("deezerConnection") {
                Some(d) if d.get("bridgeArl").and_then(Value::as_str).is_some() => state.saved_deezer_arl = d["bridgeArl"].as_str().unwrap().to_string(),
                Some(d) if d.get("url").and_then(Value::as_str).is_some() => state.deezer = Some(state::DeezerConn { url: d["url"].as_str().unwrap().into(), token: logic::str_of(d, "token").into(), transient: false, arl: String::new(), user_id: logic::str_of(d, "userId").into() }),
                _ => {}
            }
            state.preferred_source = saved.get("preferredSource").and_then(Value::as_str).filter(|s| *s == "Apple Music" || *s == "Deezer").map(str::to_string);
            state.apple_linked = logic::truthy(saved.get("appleLinked"));
            state.sound = logic::clean_sound(saved.get("sound"));
            if let Some(prefs) = saved.get("hostPrefs").filter(|p| p.is_object()) {
                state.host_prefs = json!({ "appearance": prefs.get("appearance").cloned().unwrap_or(Value::Null), "sessionCode": prefs.get("sessionCode").cloned().unwrap_or(Value::Null), "lang": prefs.get("lang").cloned().unwrap_or(Value::Null), "publicUsed": logic::truthy(prefs.get("publicUsed")) });
            }
        }
    }
    for session in state.sessions.values_mut() {
        if !session.get("queue").map(Value::is_array).unwrap_or(false) { session["queue"] = json!([]); }
        if !session.get("activity").map(Value::is_array).unwrap_or(false) { session["activity"] = json!([]); }
        // L’app a été fermée : la musique s’est arrêtée, elle ne reprend pas toute seule au lancement suivant.
        session["playing"] = json!(false);
        session["relay"] = Value::Null;
        // Les titres écartés comme « indisponibles » sont retentés : le moteur lit désormais leur version alternative.
        if let Some(fallback) = session.get_mut("fallback").and_then(Value::as_object_mut) { fallback.remove("blocked"); }
    }
    state
}

pub fn create(config: Config) -> Shared {
    let state = load_state(&config.data_dir.join("sessions.json"));
    let grace = std::env::var("SONO_HOST_GRACE_MS").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(20000);
    Arc::new(App {
        state: Mutex::new(state),
        port: config.port,
        short_port: config.short_port,
        short_port_active: AtomicBool::new(false),
        data_dir: config.data_dir,
        bin_dir: config.bin_dir,
        dist_dir: config.dist_dir,
        http: reqwest::Client::builder().user_agent("Sono").build().unwrap(),
        next_client: AtomicU64::new(1),
        pending_broadcasts: Mutex::new(Default::default()),
        broadcast_scheduled: AtomicBool::new(false),
        save_scheduled: AtomicBool::new(false),
        writing: tokio::sync::Mutex::new(()),
        deezer_login: Mutex::new(None),
        clear_cache: Mutex::new(None),
        cache_size: Mutex::new(None),
        quit_app: Mutex::new(None),
        deezer_login_in_progress: AtomicBool::new(false),
        deezer_child: Mutex::new(None),
        deezer_stdin: Mutex::new(None),
        tunnel_child: Mutex::new(None),
        tunnel_start: tokio::sync::Mutex::new(()),
        apple_token: tokio::sync::Mutex::new(None),
        engine_log: Mutex::new(Vec::new()),
        engine_log_scheduled: AtomicBool::new(false),
        packed: Mutex::new(Default::default()),
        host_grace: Duration::from_millis(grace),
        covers_tried: Mutex::new(Default::default()),
    })
}

const DISABLED_PAGE: &str = "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Sono</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#f2f3f5;font:16px system-ui,sans-serif;text-align:center;padding:24px\"><div><h1 style=\"font-size:22px\">Lien non disponible · Link unavailable</h1><p style=\"color:#9a9ca3\">L’accès à distance à cette session est désactivé par l’hôte.<br>Demandez-lui un nouveau lien ou rejoignez son Wi-Fi.</p><p style=\"color:#9a9ca3\">The host turned off remote access to this session.<br>Ask them for a new link or join their Wi-Fi.</p></div></body></html>";

/// Tant que l’hôte n’a pas activé l’accès à distance, le tunnel préparé ne laisse rien passer.
async fn tunnel_gate(AxumState(app): AxumState<Shared>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    if path == "/api/health" || app.lock().public_link_enabled || !ws::via_tunnel(request.headers()) { return next.run(request).await; }
    let message = "L’accès à distance à cette session est désactivé par l’hôte.";
    if path.starts_with("/api/") { return routes::err(StatusCode::SERVICE_UNAVAILABLE, message); }
    (StatusCode::SERVICE_UNAVAILABLE, Html(DISABLED_PAGE)).into_response()
}

/// Fichiers de l’interface : compressés une fois pour toutes, gardés en cache par le navigateur (leur nom change à chaque version).
async fn assets(AxumState(app): AxumState<Shared>, request: Request) -> Response {
    let name = request.uri().path().rsplit('/').next().unwrap_or("").to_string();
    let kind = if name.ends_with(".js") { Some("text/javascript; charset=utf-8") } else if name.ends_with(".css") { Some("text/css; charset=utf-8") } else { None };
    let accept = request.headers().get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let encoding = if accept.split(',').any(|e| e.trim().starts_with("br")) { Some("br") } else if accept.split(',').any(|e| e.trim().starts_with("gzip")) { Some("gzip") } else { None };
    if let (Some(kind), Some(encoding), false) = (kind, encoding, name.contains("..")) {
        let key = format!("{encoding}:{name}");
        let cached = app.packed.lock().unwrap().get(&key).cloned();
        let bytes = match cached {
            Some(b) => Some(b),
            None => match tokio::fs::read(app.dist_dir.join("assets").join(&name)).await {
                Ok(source) => {
                    let packed = tokio::task::spawn_blocking(move || compress(&source, encoding)).await.unwrap_or_default();
                    let packed = Arc::new(packed);
                    app.packed.lock().unwrap().insert(key, packed.clone());
                    Some(packed)
                }
                Err(_) => None,
            },
        };
        if let Some(bytes) = bytes {
            return Response::builder()
                .header(header::CONTENT_TYPE, kind).header(header::CONTENT_ENCODING, encoding).header(header::VARY, "Accept-Encoding")
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .body(Body::from(bytes.as_ref().clone())).unwrap();
        }
    }
    let service = ServeDir::new(app.dist_dir.join("assets"));
    let path = format!("/{name}");
    let (parts, body) = request.into_parts();
    let mut inner = Request::from_parts(parts, body);
    *inner.uri_mut() = path.parse().unwrap_or_default();
    match tower::ServiceExt::oneshot(service, inner).await {
        Ok(mut response) if response.status().is_success() => {
            response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
            response.into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn compress(source: &[u8], encoding: &str) -> Vec<u8> {
    use std::io::Write;
    if encoding == "br" {
        let mut out = Vec::new();
        { let mut w = brotli::CompressorWriter::new(&mut out, 4096, 11, 22); let _ = w.write_all(source); }
        out
    } else {
        let mut w = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        let _ = w.write_all(source);
        w.finish().unwrap_or_default()
    }
}

/// Autres fichiers (icônes…) ; toute autre adresse affiche l’app (elle gère elle-même /session/…, /rejoindre…).
async fn static_or_index(AxumState(app): AxumState<Shared>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    if path != "/" && !path.contains("..") {
        let file = app.dist_dir.join(path.trim_start_matches('/'));
        if file.is_file() {
            return tower::ServiceExt::oneshot(ServeDir::new(&app.dist_dir), request).await.map(IntoResponse::into_response).unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response());
        }
    }
    match tokio::fs::read_to_string(app.dist_dir.join("index.html")).await {
        Ok(html) => ([(header::CACHE_CONTROL, "no-cache")], Html(html)).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Interface introuvable").into_response(),
    }
}

pub fn router(app: Shared) -> Router {
    use routes::*;
    Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(config))
        .route("/api/public-link/prepare", post(public_prepare))
        .route("/api/public-link", post(public_enable).delete(public_disable))
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/{code}", get(get_session).patch(patch_session).delete(delete_session))
        .route("/api/host/resume", post(host_resume))
        .route("/api/host/bootstrap", post(host_bootstrap))
        .route("/api/sessions/{code}/tracks", post(add_track))
        .route("/api/sessions/{code}/tracks/{id}", delete(remove_track))
        .route("/api/sessions/{code}/queue", patch(reorder_queue))
        .route("/api/sessions/{code}/playback", post(playback))
        .route("/api/sessions/{code}/admissions", post(admissions))
        .route("/api/sessions/{code}/members/{id}", delete(remove_member))
        .route("/api/sessions/{code}/admins", patch(set_admin))
        .route("/api/sessions/{code}/stop", post(stop_music))
        .route("/api/integrations/apple/status", get(apple_status))
        .route("/api/integrations/apple/developer-token", get(apple_developer_token))
        .route("/api/integrations/apple/search", get(apple_search))
        .route("/api/sessions/{code}/catalog/search", get(catalog_search))
        .route("/api/sessions/{code}/catalog/mine", get(catalog_mine))
        // Une grande playlist de la bibliothèque Apple Music est envoyée en une fois par l’appareil de l’hôte.
        .route("/api/sessions/{code}/fallback", put(set_fallback).delete(clear_fallback).layer(DefaultBodyLimit::max(16 * 1024 * 1024)))
        .route("/api/sessions/{code}/fallback/upcoming", get(fallback_list))
        .route("/api/sessions/{code}/fallback/order", patch(fallback_order_route))
        .route("/api/sessions/{code}/fallback/tracks/{index}", delete(fallback_remove))
        .route("/api/integrations/opendeezer/login", post(deezer_login))
        .route("/api/integrations/opendeezer/status", get(deezer_status))
        .route("/api/integrations/opendeezer/connect", post(deezer_connect))
        .route("/api/integrations/opendeezer", delete(deezer_disconnect))
        .route("/api/integrations/opendeezer/search", get(deezer_search))
        .route("/api/integrations/opendeezer/play", post(deezer_play))
        .route("/api/integrations/opendeezer/seek", post(deezer_seek))
        .route("/api/integrations/opendeezer/preload", post(deezer_preload))
        .route("/api/integrations/opendeezer/transport", post(deezer_transport))
        .route("/api/local/host", get(local_host_get).put(local_host_put))
        .route("/api/local/cache", get(local_cache_size).post(local_cache_clear))
        .route("/api/sound", get(sound_get).put(sound_put))
        .route("/ws", get(ws::upgrade))
        .route("/assets/{*file}", get(assets))
        .fallback(static_or_index)
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), tunnel_gate))
        .with_state(app)
}

/// Démarre le serveur (port principal, et port 80 s’il est libre pour des liens sans « :7100 »).
pub async fn serve(app: Shared) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", app.port)).await?;
    let router = router(app.clone());
    if app.short_port != 0 && app.short_port != app.port {
        if let Ok(short) = tokio::net::TcpListener::bind(("0.0.0.0", app.short_port)).await {
            app.short_port_active.store(true, Ordering::SeqCst);
            let r = router.clone();
            tokio::spawn(async move { let _ = axum::serve(short, r.into_make_service_with_connect_info::<SocketAddr>()).await; });
        }
    }
    // Compte Deezer gardé : reconnecté au lancement. Juste après une mise à jour, l’antivirus de Windows analyse
    // souvent le nouveau moteur pendant quelques secondes : on réessaie plusieurs fois avant d’abandonner.
    if !app.lock().saved_deezer_arl.is_empty() {
        let app = app.clone();
        tokio::spawn(async move {
            for wait in [0u64, 3, 6, 10, 20, 40] {
                tokio::time::sleep(Duration::from_secs(wait)).await;
                let saved = { let s = app.lock(); if s.deezer.is_some() { return; } s.saved_deezer_arl.clone() };
                if saved.is_empty() { return; }
                match deezer::start_bridge(&app, saved).await {
                    Ok(_) => { app.broadcast_all(); return; }
                    Err(e) => eprintln!("Reconnexion Deezer impossible : {e}"),
                }
            }
        });
    }
    // Les fichiers de l’interface sont compressés dès le démarrage : le premier invité n’attend pas.
    let warm = app.clone();
    tokio::spawn(async move {
        let Ok(mut entries) = tokio::fs::read_dir(warm.dist_dir.join("assets")).await else { return };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !(name.ends_with(".js") || name.ends_with(".css")) { continue; }
            let Ok(source) = tokio::fs::read(entry.path()).await else { continue };
            for encoding in ["br", "gzip"] {
                let source = source.clone();
                if let Ok(packed) = tokio::task::spawn_blocking(move || compress(&source, encoding)).await {
                    warm.packed.lock().unwrap().insert(format!("{encoding}:{name}"), Arc::new(packed));
                }
            }
        }
    });
    println!("Sono est disponible sur le port {}. Adresse Wi-Fi : {}", app.port, routes::network_url(&app).unwrap_or_else(|| "indisponible".into()));
    tokio::spawn(async move { let _ = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await; });
    // Une session d’hôte reprend (ou le lien « Internet » a déjà servi) : le tunnel se prépare dès le lancement,
    // porte fermée, pour un passage instantané.
    let res = { let s = app.lock(); logic::truthy(s.host_prefs.get("publicUsed")) || s.host_prefs.get("sessionCode").and_then(Value::as_str).is_some() }; if res {
        let warm = app.clone();
        tokio::spawn(async move { let _ = tunnel::start(&warm).await; });
    }
    Ok(())
}

/// Fermeture de Sono : enregistrement immédiat, moteur Deezer et lien public arrêtés.
pub fn shutdown(app: &Shared) {
    app.flush_store();
    deezer::stop_bridge(app);
    tunnel::stop(app);
}
