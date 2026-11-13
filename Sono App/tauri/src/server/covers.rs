//! Pochettes manquantes : un titre sans pochette (ou avec l’image vide de Deezer) en reçoit une, cherchée sur
//! Deezer puis sur l’iTunes Store, à partir de l’artiste et du titre. Chaque titre n’est cherché qu’une fois.
use super::state::Shared;
use serde_json::Value;
use std::time::Duration;

/// Pas de pochette, ou l’image grise que Deezer donne aux albums sans visuel (adresse sans identifiant).
pub fn missing(cover: &str) -> bool {
    !cover.starts_with("https://") || cover.contains("/images/cover//") || cover.contains("/images/artist//")
}

fn key(item: &Value) -> Option<String> {
    let title = item.get("title").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let artist = item.get("artist").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    if title.is_empty() || artist.is_empty() || !missing(item.get("cover").and_then(Value::as_str).unwrap_or("")) { return None; }
    Some(format!("{artist}\u{1f}{title}"))
}

/// Titres en cours, à venir et récents d’une session.
fn tracks(session: &mut Value) -> Vec<&mut Value> {
    let mut list = Vec::new();
    let Some(object) = session.as_object_mut() else { return list };
    for (name, value) in object.iter_mut() {
        match name.as_str() {
            "current" if value.is_object() => list.push(value),
            "queue" => if let Some(items) = value.as_array_mut() { list.extend(items.iter_mut()) },
            "history" => if let Some(items) = value.as_array_mut() { list.extend(items.iter_mut().take(20)) },
            _ => {}
        }
    }
    list
}

/// Lance la recherche des pochettes manquantes d’une session (appelé à chaque diffusion, sans attendre).
pub fn fill(app: &Shared, code: &str) {
    let wanted: Vec<(String, String, String)> = {
        let mut s = app.lock();
        let Some(session) = s.sessions.get_mut(code) else { return };
        let mut tried = app.covers_tried.lock().unwrap();
        let mut out = Vec::new();
        for item in tracks(session) {
            let Some(k) = key(item) else { continue };
            if tried.contains_key(&k) { continue; }
            // Une soirée enchaîne des centaines de titres : seules les recherches récentes restent en mémoire.
            if tried.len() >= 600 { tried.clear(); }
            tried.insert(k.clone(), None);
            let text = |name: &str| item.get(name).and_then(Value::as_str).unwrap_or("").to_string();
            out.push((k, text("artist"), text("title")));
        }
        // Une pochette trouvée plus tôt (pour une autre session ou un titre revenu) s’applique tout de suite.
        let known: Vec<(String, String)> = tracks(session).into_iter().filter_map(|item| key(item).and_then(|k| tried.get(&k).cloned().flatten().map(|c| (k, c)))).collect();
        drop(tried);
        if !known.is_empty() { apply(session, &known); }
        out
    };
    for (k, artist, title) in wanted {
        let app = app.clone();
        let code = code.to_string();
        tokio::spawn(async move {
            let Some(cover) = lookup(&app.http, &artist, &title).await else { return };
            app.covers_tried.lock().unwrap().insert(k.clone(), Some(cover.clone()));
            let changed = {
                let mut s = app.lock();
                s.sessions.get_mut(&code).map(|session| apply(session, &[(k, cover)])).unwrap_or(false)
            };
            if changed { app.persist(); app.broadcast(&code); }
        });
    }
}

fn apply(session: &mut Value, found: &[(String, String)]) -> bool {
    let mut changed = false;
    for item in tracks(session) {
        let Some(k) = key(item) else { continue };
        if let Some((_, cover)) = found.iter().find(|(f, _)| *f == k) {
            item["cover"] = Value::String(cover.clone());
            changed = true;
        }
    }
    changed
}

fn same(a: &str, b: &str) -> bool {
    let clean = |s: &str| s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    let (a, b) = (clean(a), clean(b));
    !a.is_empty() && !b.is_empty() && (a.contains(&b) || b.contains(&a))
}

async fn get(http: &reqwest::Client, url: &str, query: &[(&str, &str)]) -> Option<Value> {
    http.get(url).query(query).timeout(Duration::from_secs(6)).send().await.ok()?.json::<Value>().await.ok()
}

/// Deezer (recherche précise, puis libre), puis l’iTunes Store. Le résultat doit être du même artiste.
pub async fn lookup(http: &reqwest::Client, artist: &str, title: &str) -> Option<String> {
    let exact = format!("artist:\"{artist}\" track:\"{title}\"");
    let loose = format!("{artist} {title}");
    for q in [exact.as_str(), loose.as_str()] {
        let Some(data) = get(http, "https://api.deezer.com/search", &[("q", q), ("limit", "8")]).await else { continue };
        let found = data.get("data").and_then(Value::as_array).into_iter().flatten().find_map(|track| {
            let name = track.pointer("/artist/name").and_then(Value::as_str).unwrap_or("");
            let cover = track.pointer("/album/cover_xl").and_then(Value::as_str).unwrap_or("");
            (same(name, artist) && !missing(cover)).then(|| cover.to_string())
        });
        if found.is_some() { return found; }
    }
    let data = get(http, "https://itunes.apple.com/search", &[("term", loose.as_str()), ("entity", "song"), ("limit", "8")]).await?;
    data.get("results").and_then(Value::as_array).into_iter().flatten().find_map(|track| {
        let name = track.get("artistName").and_then(Value::as_str).unwrap_or("");
        let art = track.get("artworkUrl100").and_then(Value::as_str).unwrap_or("");
        (same(name, artist) && art.starts_with("https://")).then(|| art.replace("100x100bb", "1000x1000bb"))
    })
}
