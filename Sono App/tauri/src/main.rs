// App de bureau Sono (macOS et Windows) : le serveur Sono tourne dans l’app (en Rust) et s’affiche dans une
// fenêtre du navigateur intégré au système (WebKit sur Mac, WebView2 sur Windows). Les invités rejoignent
// depuis le navigateur de leur téléphone (QR code, Wi-Fi ou lien « Internet »).
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod server;

use server::state::Shared;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WindowEvent};

static SERVER: OnceLock<Shared> = OnceLock::new();
static QUITTING: AtomicBool = AtomicBool::new(false);
static POPUPS: AtomicU32 = AtomicU32::new(0);

/// Port 7100 comme la version précédente (liens des invités inchangés). S’il est pris, toujours les mêmes ports
/// suivants dans le même ordre, pour que l’adresse de la page (et ce qu’elle garde) change le moins possible.
fn free_port() -> u16 {
    for port in 7100..=7120 { if std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() { return port; } }
    std::net::TcpListener::bind(("0.0.0.0", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(7100)
}

/// Dossier de données : le même que la version précédente, pour retrouver sessions, compte Deezer et réglages.
fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("SONO_DATA_DIR") { return PathBuf::from(dir); }
    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")).unwrap_or_default();
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_default();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = std::env::var("HOME").map(|h| PathBuf::from(h).join(".config")).unwrap_or_default();
    base.join("Sono")
}

fn env_path(name: &str, fallback: PathBuf) -> PathBuf { std::env::var(name).map(PathBuf::from).unwrap_or(fallback) }

/// Logo de Sono posé sur la page dès son ouverture, puis effacé en fondu avec un léger zoom quand l’app est dessinée.
/// La page sait aussi qu’elle tourne dans l’app de bureau, et quand la fenêtre est cachée (animations en pause).
const PAGE_SCRIPT: &str = r#"(() => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  window.sonoDesktop = { desktop: true, onVisibility: (callback) => document.addEventListener('visibilitychange', () => callback(document.visibilityState === 'visible')) };
  let first = true;
  try { first = !sessionStorage.getItem('sono-lancement'); sessionStorage.setItem('sono-lancement', '1'); } catch {}
  if (!first) return;
  const splash = document.createElement('div');
  splash.setAttribute('aria-hidden', 'true');
  splash.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0f0f0d;display:grid;place-items:center;transition:opacity .45s cubic-bezier(.4,0,.2,1);pointer-events:none';
  splash.innerHTML = '<div style="display:flex;gap:11px;align-items:center;height:104px;transition:transform .45s cubic-bezier(.4,0,.2,1)">' + [44, 96, 70, 33].map((h) => `<i style="display:block;width:15px;height:${h}px;border-radius:15px;background:#d7f75b;transform:rotate(-8deg)"></i>`).join('') + '</div>';
  document.documentElement.appendChild(splash);
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    splash.style.opacity = '0';
    splash.firstChild.style.transform = 'scale(1.18)';
    setTimeout(() => splash.remove(), 480);
  };
  const check = () => {
    if (gone) return;
    const root = document.getElementById('root');
    if (root && root.childElementCount) requestAnimationFrame(() => requestAnimationFrame(hide));
    else requestAnimationFrame(check);
  };
  check();
  setTimeout(hide, 8000);
})();"#;

/// « Compte Deezer » : la page de connexion officielle s’ouvre dans une fenêtre de l’app, sans rien partager avec
/// la fenêtre Sono. Dès que Deezer pose son cookie « arl » (connexion réussie), la fenêtre se ferme.
async fn deezer_login(app: AppHandle) -> Result<String, String> {
    let label = format!("deezer-{}", POPUPS.fetch_add(1, Ordering::SeqCst));
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External("https://www.deezer.com/login".parse().unwrap()))
        .title("Deezer").inner_size(520.0, 780.0).incognito(true).center();
    if cfg!(target_os = "macos") {
        // Certains services de connexion (Google, Apple…) refusent les navigateurs intégrés : on se présente comme Safari.
        builder = builder.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    }
    if let Some(main) = app.get_webview_window("main") { builder = builder.parent(&main).map_err(|e| e.to_string())?; }
    builder.build().map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    loop {
        tokio::time::sleep(Duration::from_millis(800)).await;
        let Some(window) = app.get_webview_window(&label) else { return Err("La fenêtre Deezer a été fermée avant la fin de la connexion.".into()) };
        if std::time::Instant::now() > deadline {
            let _ = window.close();
            return Err("La connexion Deezer a expiré. Recommencez et terminez la connexion dans la fenêtre Deezer.".into());
        }
        // Tous les cookies de la fenêtre : celui de Deezer est posé sur « .deezer.com », pas sur « www.deezer.com ».
        if let Ok(cookies) = window.cookies() {
            let deezer_domain = |domain: Option<&str>| domain.map(|d| { let d = d.trim_start_matches('.'); d == "deezer.com" || d.ends_with(".deezer.com") }).unwrap_or(false);
            if let Some(arl) = cookies.iter().find(|c| c.name() == "arl" && !c.value().is_empty() && deezer_domain(c.domain())).map(|c| c.value().to_string()) {
                let _ = window.close();
                return Ok(arl);
            }
        }
    }
}

/// Dossiers du navigateur intégré (cache, données des pages) de la fenêtre Sono.
fn webview_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let id = app.config().identifier.clone();
    let mut dirs = vec![];
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(&home).join("Library/Caches").join(&id));
        dirs.push(PathBuf::from(&home).join("Library/WebKit").join(&id));
    }
    if let Ok(local) = app.path().app_local_data_dir() { dirs.push(local.join("EBWebView")); }
    dirs
}

fn size_of(path: &std::path::Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() { return meta.len(); }
    std::fs::read_dir(path).map(|e| e.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0)
}

/// Vide le cache du navigateur de la fenêtre ; la page se recharge ensuite d’elle-même (la session revient du serveur).
fn clear_webview_cache(app: &AppHandle) -> u64 {
    let before: u64 = webview_dirs(app).iter().map(|d| size_of(d)).sum();
    if let Some(window) = app.get_webview_window("main") { let _ = window.clear_all_browsing_data(); }
    std::thread::sleep(Duration::from_millis(600));
    let after: u64 = webview_dirs(app).iter().map(|d| size_of(d)).sum();
    before.saturating_sub(after)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn create_main(app: &AppHandle, port: u16) -> tauri::Result<()> {
    let local = format!("http://localhost:{port}/");
    let handle = app.clone();
    let local_for_nav = local.clone();
    let handle_popup = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(local.parse().unwrap()))
        .title("Sono")
        .min_inner_size(900.0, 600.0)
        .background_color(tauri::window::Color(15, 15, 13, 255))
        .initialization_script(PAGE_SCRIPT)
        // Le glisser-déposer de la page (file d’attente, aperçu TV) reste à la page, pas au système.
        .disable_drag_drop_handler()
        // Session rejointe sur un autre appareil : en la quittant, on revient à l’accueil de Sono, pas à celui de l’hôte.
        .on_navigation(move |url| {
            let host = url.host_str().unwrap_or("");
            if ["localhost", "127.0.0.1"].contains(&host) || !matches!(url.scheme(), "http" | "https") { return true; }
            let path = url.path().trim_end_matches('/');
            if path.is_empty() || path == "/rejoindre" {
                let handle = handle.clone();
                let target: tauri::Url = local_for_nav.parse().unwrap();
                std::thread::spawn(move || { if let Some(w) = handle.get_webview_window("main") { let _ = w.navigate(target); } });
                return false;
            }
            true
        })
        // Connexion Apple Music : sa fenêtre s’ouvre dans l’app (et reste reliée à la page) ; tout autre lien part dans le navigateur.
        .on_new_window(move |url, features| {
            let apple = url.host_str().map(|h| h == "apple.com" || h.ends_with(".apple.com")).unwrap_or(false);
            if !apple { let _ = open::that(url.as_str()); return NewWindowResponse::Deny; }
            let label = format!("apple-{}", POPUPS.fetch_add(1, Ordering::SeqCst));
            match WebviewWindowBuilder::new(&handle_popup, &label, WebviewUrl::External("about:blank".parse().unwrap())).window_features(features).title("Apple Music").build() {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        });
    // Ouverture à la taille de l’écran (sans la barre des menus ni le Dock), sans passer en plein écran.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        builder = builder.inner_size(area.size.width as f64 / scale, area.size.height as f64 / scale).position(area.position.x as f64 / scale, area.position.y as f64 / scale);
    } else { builder = builder.inner_size(1280.0, 800.0).center(); }
    let window = builder.build()?;
    if cfg!(target_os = "windows") { let _ = window.maximize(); }
    Ok(())
}

fn run_server_only() {
    let runtime = tokio::runtime::Runtime::new().expect("tokio");
    runtime.block_on(async {
        let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7100);
        let short = std::env::var("SONO_SHORT_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(80);
        let here = std::env::current_dir().unwrap_or_default();
        let app = server::create(server::Config { port, short_port: short, data_dir: data_dir(), bin_dir: env_path("SONO_BIN_DIR", here.join("bin")), dist_dir: env_path("SONO_DIST_DIR", here.join("dist")) });
        server::serve(app.clone()).await.expect("serveur");
        let _ = tokio::signal::ctrl_c().await;
        server::shutdown(&app);
    });
}

fn main() {
    if std::env::args().any(|a| a == "--server-only") { return run_server_only(); }

    let app = tauri::Builder::default()
        // Une seule copie de Sono : une seconde ouverture ramène la fenêtre existante, sans relancer de serveur.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .setup(|app| {
            let resources = app.path().resource_dir().unwrap_or_default();
            let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or_else(free_port);
            let short = std::env::var("SONO_SHORT_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(80);
            let config = server::Config {
                port, short_port: short, data_dir: data_dir(),
                bin_dir: env_path("SONO_BIN_DIR", resources.join("bin")),
                dist_dir: env_path("SONO_DIST_DIR", resources.join("dist")),
            };
            let shared = server::create(config);
            let handle = app.handle().clone();
            *shared.deezer_login.lock().unwrap() = Some(Arc::new(move || { let h = handle.clone(); Box::pin(deezer_login(h)) }));
            let cache_handle = app.handle().clone();
            *shared.clear_cache.lock().unwrap() = Some(Arc::new(move || clear_webview_cache(&cache_handle)));
            let size_handle = app.handle().clone();
            *shared.cache_size.lock().unwrap() = Some(Arc::new(move || webview_dirs(&size_handle).iter().map(|d| size_of(d)).sum()));
            let quit_handle = app.handle().clone();
            *shared.quit_app.lock().unwrap() = Some(Arc::new(move || quit_handle.exit(0)));
            let _ = SERVER.set(shared.clone());
            tauri::async_runtime::block_on(server::serve(shared))?;
            create_main(app.handle(), port)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Mac : la croix rouge cache la fenêtre, Sono continue (musique, invités) ; Cmd+Q le quitte vraiment.
                if cfg!(target_os = "macos") && !QUITTING.load(Ordering::SeqCst) { api.prevent_close(); let _ = window.hide(); }
                // Windows : fermer la fenêtre quitte Sono (le serveur des invités vit avec l’app).
                else { window.app_handle().exit(0); }
            }
        })
        .build(tauri::generate_context!())
        .expect("Sono n’a pas pu démarrer");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested { .. } => { QUITTING.store(true, Ordering::SeqCst); }
        RunEvent::Exit => { if let Some(s) = SERVER.get() { server::shutdown(s); } }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(handle),
        _ => { let _ = handle; }
    });
}
