//! Liens d’invitation courts : chaque session a un petit token unique (« k7f2q »), et son lien « Internet » passe par
//! le service en ligne de Sono (« join.sono.workers.dev/k7f2q »). Le service renvoie vers le tunnel de cet ordinateur :
//! le lien reste le même d’un lancement à l’autre, même quand l’adresse du tunnel change.
use super::state::Shared;
use rand::Rng;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Duration;

/// Adresse du service en ligne, lue à la compilation (« fabriquer-tauri.sh » la prend dans
/// « Sono Mobile/ios/Config.xcconfig », écrit par « Sono Mobile/deploy.sh »). Vide : liens directs vers le tunnel.
pub const SERVICE: &str = match option_env!("SONO_MOBILE_SERVICE") { Some(url) => url, None => "" };

/// Sans lettres ni chiffres qui se confondent (l, o, 0, 1).
const ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";

pub fn new_token() -> String {
    let mut rng = rand::thread_rng();
    (0..5).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

/// Donne un token et un secret (pour publier son lien) à une session qui n’en a pas encore.
pub fn ensure(session: &mut Value) {
    if session.get("token").and_then(Value::as_str).map(|t| t.len() != 5).unwrap_or(true) { session["token"] = json!(new_token()); }
    if session.get("linkSecret").and_then(Value::as_str).unwrap_or("").is_empty() { session["linkSecret"] = json!(uuid::Uuid::new_v4().simple().to_string()); }
}

/// Publie (ou met à jour) le lien de chaque session vers le tunnel actuel. Sans réponse du service, les liens
/// d’invitation restent ceux du tunnel.
pub async fn publish_all(app: &Shared) {
    app.links_ready.store(false, Ordering::SeqCst);
    if SERVICE.is_empty() { return; }
    let (codes, url): (Vec<String>, String) = { let s = app.lock(); (s.sessions.keys().cloned().collect(), s.public_tunnel_url.clone()) };
    let mut all = true;
    for code in codes { all &= publish(app, &code).await; }
    app.links_ready.store(all, Ordering::SeqCst);
    if all { app.lock().links_url = url; }
    app.broadcast_all();
}

pub async fn publish(app: &Shared, code: &str) -> bool {
    if SERVICE.is_empty() { return false; }
    for _ in 0..3 {
        let (token, secret, url) = {
            let mut s = app.lock();
            let url = s.public_tunnel_url.clone();
            let Some(session) = s.sessions.get_mut(code) else { return false };
            ensure(session);
            (session["token"].as_str().unwrap_or("").to_string(), session["linkSecret"].as_str().unwrap_or("").to_string(), url)
        };
        if url.is_empty() { return false; }
        let sent = app.http.post(format!("{SERVICE}/api/links")).json(&json!({ "token": token, "secret": secret, "url": url }))
            .timeout(Duration::from_secs(8)).send().await;
        match sent.map(|r| r.status().as_u16()) {
            Ok(200..=299) => return true,
            // Token déjà pris sur le service : un autre est tiré pour cette session.
            Ok(409) => {
                let mut s = app.lock();
                if let Some(session) = s.sessions.get_mut(code) { session["token"] = json!(new_token()); }
                drop(s);
                app.persist();
            }
            _ => return false,
        }
    }
    false
}
