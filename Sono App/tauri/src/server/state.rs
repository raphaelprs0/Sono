// État du serveur : sessions, invités connectés, moteur Deezer, lien public. Un seul verrou, jamais gardé pendant une attente.
use super::logic::{payload, Sound, Viewer};
use axum::extract::ws::Message;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Clone, Debug)]
pub struct Meta {
    pub client_id: String,
    pub name: String,
    pub host: bool,
    pub since: String,
    pub greeted: bool,
    pub via_tunnel: bool,
    pub last_sent: String,
}

pub struct Client {
    pub id: u64,
    pub tx: UnboundedSender<Message>,
    pub meta: Meta,
}

#[derive(Clone, Debug)]
pub struct DeezerConn {
    pub url: String,
    pub token: String,
    pub transient: bool,
    pub arl: String,
    pub user_id: String,
}

#[derive(Default)]
pub struct State {
    pub sessions: Map<String, Value>,
    pub clients: HashMap<String, Vec<Client>>,
    pub deezer: Option<DeezerConn>,
    pub saved_deezer_arl: String,
    pub deezer_playing_session: Option<String>,
    pub preferred_source: Option<String>,
    pub apple_linked: bool,
    pub sound: Sound,
    pub host_prefs: Value,
    pub public_link_enabled: bool,
    pub public_tunnel_url: String,
}

/// Vide le cache du navigateur de la fenêtre Sono (fourni par l’app de bureau) ; renvoie les octets libérés.
pub type ClearCache = Arc<dyn Fn() -> u64 + Send + Sync>;
pub type QuitApp = Arc<dyn Fn() + Send + Sync>;

pub type DeezerLogin = Arc<dyn Fn() -> futures_util::future::BoxFuture<'static, Result<String, String>> + Send + Sync>;

pub struct App {
    pub state: Mutex<State>,
    pub port: u16,
    pub short_port: u16,
    pub short_port_active: AtomicBool,
    pub data_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub dist_dir: PathBuf,
    pub http: reqwest::Client,
    pub next_client: AtomicU64,
    pub pending_broadcasts: Mutex<HashSet<String>>,
    pub broadcast_scheduled: AtomicBool,
    pub save_scheduled: AtomicBool,
    pub writing: tokio::sync::Mutex<()>,
    pub deezer_login: Mutex<Option<DeezerLogin>>,
    pub clear_cache: Mutex<Option<ClearCache>>,
    pub quit_app: Mutex<Option<QuitApp>>,
    pub deezer_login_in_progress: AtomicBool,
    pub deezer_child: Mutex<Option<tokio::process::Child>>,
    pub deezer_stdin: Mutex<Option<tokio::process::ChildStdin>>,
    pub tunnel_child: Mutex<Option<tokio::process::Child>>,
    pub tunnel_start: tokio::sync::Mutex<()>,
    pub apple_token: tokio::sync::Mutex<Option<(String, i64)>>,
    pub engine_log: Mutex<Vec<String>>,
    pub engine_log_scheduled: AtomicBool,
    pub packed: Mutex<HashMap<String, Arc<Vec<u8>>>>,
    pub host_grace: Duration,
}

pub type Shared = Arc<App>;

impl App {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn store_path(&self) -> PathBuf { self.data_dir.join("sessions.json") }

    pub fn binary(&self, name: &str) -> PathBuf {
        self.bin_dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() })
    }

    pub fn store_json(&self) -> String {
        let s = self.lock();
        let deezer = match &s.deezer {
            Some(d) if d.transient => if d.arl.is_empty() { Value::Null } else { json!({ "bridgeArl": d.arl }) },
            Some(d) => json!({ "url": d.url, "token": d.token, "userId": d.user_id }),
            None => if s.saved_deezer_arl.is_empty() { Value::Null } else { json!({ "bridgeArl": s.saved_deezer_arl }) },
        };
        let sessions: Vec<Value> = s.sessions.values().cloned().collect();
        serde_json::to_string(&json!({
            "sessions": sessions, "deezerConnection": deezer, "preferredSource": s.preferred_source,
            "appleLinked": s.apple_linked, "sound": s.sound, "hostPrefs": s.host_prefs,
        })).unwrap_or_default()
    }

    /// Enregistrement sur disque regroupé et différé : une action n’attend jamais le disque pour répondre.
    pub fn persist(self: &Arc<Self>) {
        if self.save_scheduled.swap(true, Ordering::SeqCst) { return; }
        let app = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            app.save_scheduled.store(false, Ordering::SeqCst);
            app.write_store().await;
        });
    }

    pub async fn write_store(&self) {
        let _guard = self.writing.lock().await;
        let json = self.store_json();
        let _ = tokio::fs::create_dir_all(&self.data_dir).await;
        let tmp = self.data_dir.join("sessions.json.tmp");
        if tokio::fs::write(&tmp, json).await.is_ok() {
            restrict(&tmp);
            // Windows refuse parfois de remplacer un fichier ouvert un instant par l’antivirus : on réessaie.
            for attempt in 0..10 {
                match tokio::fs::rename(&tmp, self.store_path()).await {
                    Ok(()) => return,
                    Err(error) if attempt == 9 => eprintln!("Enregistrement impossible : {error}"),
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(150)).await,
                }
            }
        }
    }

    /// À la fermeture : ce qui reste à écrire l’est tout de suite.
    pub fn flush_store(&self) {
        let json = self.store_json();
        let _ = std::fs::create_dir_all(&self.data_dir);
        let tmp = self.data_dir.join("sessions.json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            restrict(&tmp);
            for _ in 0..10 {
                if std::fs::rename(&tmp, self.store_path()).is_ok() { break; }
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        }
    }

    /// Plusieurs changements rapprochés ne font qu’une diffusion, et un invité ne reçoit rien si rien n’a changé pour lui.
    pub fn broadcast(self: &Arc<Self>, code: &str) {
        self.pending_broadcasts.lock().unwrap().insert(code.to_string());
        if self.broadcast_scheduled.swap(true, Ordering::SeqCst) { return; }
        let app = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(15)).await;
            app.broadcast_scheduled.store(false, Ordering::SeqCst);
            let codes: Vec<String> = app.pending_broadcasts.lock().unwrap().drain().collect();
            let mut s = app.lock();
            for code in codes { send_all(&mut s, &code); }
        });
    }

    pub fn broadcast_all(self: &Arc<Self>) {
        let codes: Vec<String> = self.lock().sessions.keys().cloned().collect();
        for code in codes { self.broadcast(&code); }
    }
}

fn restrict(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    let _ = path;
}

/// Envoie à chaque client de la session ce qui a changé pour lui.
pub fn send_all(s: &mut State, code: &str) {
    let Some(slot) = s.sessions.get_mut(code) else { return };
    // La session est sortie de l’état le temps du calcul (sans copie), puis remise à sa place.
    let mut session = std::mem::take(slot);
    let metas: Vec<(u64, Viewer, String)> = s.clients.get(code).map(|list| list.iter().map(|c| (c.id, Viewer { host: c.meta.host, client_id: c.meta.client_id.clone() }, c.meta.last_sent.clone())).collect()).unwrap_or_default();
    let mut outgoing = Vec::new();
    for (id, viewer, last) in metas {
        let message = payload(s, &mut session, &viewer).to_string();
        if message != last { outgoing.push((id, message)); }
    }
    *s.sessions.get_mut(code).unwrap() = session;
    if let Some(list) = s.clients.get_mut(code) {
        for (id, message) in outgoing {
            if let Some(client) = list.iter_mut().find(|c| c.id == id) {
                client.meta.last_sent = message.clone();
                let _ = client.tx.send(Message::Text(message.into()));
            }
        }
    }
}

pub fn send_one(s: &mut State, code: &str, client_id: u64) {
    let Some(viewer) = s.clients.get(code).and_then(|l| l.iter().find(|c| c.id == client_id)).map(|c| Viewer { host: c.meta.host, client_id: c.meta.client_id.clone() }) else { return };
    let Some(slot) = s.sessions.get_mut(code) else { return };
    let mut session = std::mem::take(slot);
    let message = payload(s, &mut session, &viewer).to_string();
    *s.sessions.get_mut(code).unwrap() = session;
    if let Some(client) = s.clients.get_mut(code).and_then(|l| l.iter_mut().find(|c| c.id == client_id)) {
        if client.meta.last_sent != message {
            client.meta.last_sent = message.clone();
            let _ = client.tx.send(Message::Text(message.into()));
        }
    }
}
