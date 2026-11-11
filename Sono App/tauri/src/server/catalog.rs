// Catalogues : recherche Apple Music (jeton public du site d’Apple), et playlists / albums / artistes
// de Deezer et d’Apple Music pour la musique de fond.
use super::logic::{str_of, text};
use super::state::Shared;
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

fn apple_web() -> String { std::env::var("APPLE_MUSIC_WEB_BASE_URL").unwrap_or_else(|_| "https://beta.music.apple.com".into()).trim_end_matches('/').to_string() }
fn apple_api() -> String { std::env::var("APPLE_MUSIC_API_BASE_URL").unwrap_or_else(|_| "https://amp-api.music.apple.com".into()).trim_end_matches('/').to_string() }
fn deezer_api() -> String { std::env::var("DEEZER_API_BASE_URL").unwrap_or_else(|_| "https://api.deezer.com".into()).trim_end_matches('/').to_string() }
pub const FALLBACK_MAX_TRACKS: usize = 10000;

async fn fetch_text(app: &Shared, url: &str) -> Result<String, String> {
    let response = app.http.get(url).timeout(Duration::from_secs(15)).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Apple Music a répondu avec le code {}.", response.status().as_u16())); }
    let body = response.text().await.map_err(|e| e.to_string())?;
    if body.len() > 8_000_000 { return Err("La réponse publique d’Apple Music est trop volumineuse.".into()); }
    Ok(body)
}

pub async fn apple_token(app: &Shared) -> Result<String, String> {
    let mut cached = app.apple_token.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    if let Some((value, expires)) = cached.as_ref() { if *expires > now + 60_000 { return Ok(value.clone()); } }
    let web = apple_web();
    let html = fetch_text(app, &web).await?;
    let script = regex::Regex::new(r#"<script[^>]+src=["'](/assets/index[^"']+\.js)["']"#).unwrap().captures(&html).map(|c| c[1].to_string());
    let script = script.filter(|p| regex::Regex::new(r"^/assets/index[A-Za-z0-9_.~-]+\.js$").unwrap().is_match(p)).ok_or("Le script public Apple Music est introuvable.")?;
    let javascript = fetch_text(app, &format!("{web}{script}")).await?;
    let value = regex::Regex::new(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+").unwrap().find(&javascript).map(|m| m.as_str().to_string()).ok_or("Le jeton public Apple Music est introuvable.")?;
    let part = value.split('.').nth(1).unwrap_or("");
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).map_err(|_| "Le jeton public Apple Music est illisible.")?;
    let payload: Value = serde_json::from_slice(&decoded).map_err(|_| "Le jeton public Apple Music est illisible.")?;
    let exp = payload.get("exp").and_then(Value::as_i64).unwrap_or(0) * 1000;
    if exp <= now + 60_000 { return Err("Le jeton public Apple Music est expiré.".into()); }
    *cached = Some((value.clone(), exp));
    Ok(value)
}

async fn apple_get(app: &Shared, path: &str) -> Result<Value, String> {
    let token = apple_token(app).await?;
    let response = app.http.get(format!("{}{}", apple_api(), path))
        .header("Authorization", format!("Bearer {token}")).header("Origin", "https://music.apple.com").header("User-Agent", "Mozilla/5.0")
        .timeout(Duration::from_secs(15)).send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        if status == 401 || status == 403 { *app.apple_token.lock().await = None; }
        return Err(format!("Le catalogue Apple Music a répondu avec le code {status}."));
    }
    response.json().await.map_err(|e| e.to_string())
}

fn query(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", k, urlencoding::encode(v))).collect::<Vec<_>>().join("&")
}

pub async fn apple_search(app: &Shared, term: &str, limit: u32) -> Result<Vec<Value>, String> {
    let data = apple_get(app, &format!("/v1/catalog/fr/search?{}", query(&[("term", term), ("types", "songs"), ("limit", &limit.to_string())]))).await?;
    Ok(data.pointer("/results/songs/data").and_then(Value::as_array).cloned().unwrap_or_default())
}

fn artwork(details: &Value) -> String {
    details.pointer("/artwork/url").and_then(Value::as_str).map(|u| u.replace("{w}", "400").replace("{h}", "400")).unwrap_or_default()
}

pub fn normalize_apple_track(track: &Value) -> Value {
    let d = track.get("attributes").cloned().unwrap_or(json!({}));
    json!({
        "providerId": text(track.get("id"), usize::MAX), "title": d.get("name"),
        "artist": d.get("artistName").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("Artiste inconnu"),
        "album": d.get("albumName").and_then(Value::as_str).unwrap_or(""), "duration": d.get("durationInMillis"),
        "cover": artwork(&d), "previewUrl": d.pointer("/previews/0/url").and_then(Value::as_str).unwrap_or(""),
        "url": d.get("url").and_then(Value::as_str).unwrap_or(""),
    })
}

async fn deezer_get(app: &Shared, path: &str) -> Result<Value, String> {
    let response = app.http.get(format!("{}{}", deezer_api(), path)).timeout(Duration::from_secs(10)).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let data: Value = response.json().await.unwrap_or(json!({}));
    if !status.is_success() || data.get("error").map(|e| !e.is_null()).unwrap_or(false) {
        return Err(data.pointer("/error/message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("Deezer a répondu avec le code {}.", status.as_u16())));
    }
    Ok(data)
}

fn fr_number(n: i64) -> String {
    let digits = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 { out.push('\u{202f}'); }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

fn deezer_item(kind: &str, item: &Value) -> Value {
    let subtitle = match kind {
        "playlist" => {
            let user = item.pointer("/user/name").and_then(Value::as_str).unwrap_or("");
            format!("{} titres{}", item.get("nb_tracks").and_then(Value::as_i64).unwrap_or(0), if user.is_empty() { String::new() } else { format!(" · {user}") })
        }
        "album" => item.pointer("/artist/name").and_then(Value::as_str).unwrap_or("").to_string(),
        _ => match item.get("nb_fan").and_then(Value::as_i64).filter(|n| *n != 0) { Some(n) => format!("{} fans", fr_number(n)), None => "Artiste".into() },
    };
    let cover = ["picture_xl", "picture_big", "cover_xl", "cover_big", "picture_medium", "cover_medium"].iter().find_map(|k| item.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty())).unwrap_or("");
    let name = item.get("title").and_then(Value::as_str).filter(|s| !s.is_empty()).or_else(|| item.get("name").and_then(Value::as_str)).unwrap_or("");
    json!({ "type": kind, "id": text(item.get("id"), usize::MAX), "name": name, "subtitle": subtitle, "cover": cover })
}

fn apple_item(kind: &str, item: &Value) -> Value {
    let d = item.get("attributes").cloned().unwrap_or(json!({}));
    let subtitle = match kind {
        "playlist" => d.get("curatorName").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("Playlist").to_string(),
        "album" => str_of(&d, "artistName").to_string(),
        _ => d.pointer("/genreNames/0").and_then(Value::as_str).unwrap_or("Artiste").to_string(),
    };
    json!({ "type": kind, "id": text(item.get("id"), usize::MAX), "name": str_of(&d, "name"), "subtitle": subtitle, "cover": artwork(&d) })
}

fn deezer_track(track: &Value, album: Option<&Value>) -> Value {
    let a = album.cloned().unwrap_or(json!({}));
    json!({
        "providerId": text(track.get("id"), usize::MAX), "title": track.get("title"),
        "artist": track.pointer("/artist/name").and_then(Value::as_str).unwrap_or("Artiste inconnu"),
        "album": track.pointer("/album/title").and_then(Value::as_str).or_else(|| a.get("title").and_then(Value::as_str)).unwrap_or(""),
        "durationMs": super::logic::jnum(track.get("duration").and_then(Value::as_f64).unwrap_or(0.0) * 1000.0),
        "cover": track.pointer("/album/cover_xl").and_then(Value::as_str).or_else(|| track.pointer("/album/cover_big").and_then(Value::as_str)).or_else(|| a.get("cover_xl").and_then(Value::as_str)).unwrap_or(""),
        "source": "Deezer",
    })
}

fn apple_track(track: &Value) -> Value {
    let n = normalize_apple_track(track);
    json!({ "providerId": n["providerId"], "title": n["title"], "artist": n["artist"], "album": n["album"], "durationMs": n.get("duration").filter(|v| !v.is_null()).cloned().unwrap_or(json!(0)), "cover": n["cover"], "source": "Apple Music" })
}

fn items(data: &Value, pointer: &str) -> Vec<Value> { data.pointer(pointer).and_then(Value::as_array).cloned().unwrap_or_default() }

pub async fn catalog_search(app: &Shared, source: &str, q: &str) -> Result<Value, String> {
    if source == "Deezer" {
        let enc = urlencoding::encode(q);
        let (pp, ap, rp) = (format!("/search/playlist?q={enc}&limit=8"), format!("/search/album?q={enc}&limit=8"), format!("/search/artist?q={enc}&limit=8"));
        let (p, a, r) = tokio::try_join!(deezer_get(app, &pp), deezer_get(app, &ap), deezer_get(app, &rp))?;
        return Ok(json!({
            "playlists": items(&p, "/data").iter().map(|i| deezer_item("playlist", i)).collect::<Vec<_>>(),
            "albums": items(&a, "/data").iter().map(|i| deezer_item("album", i)).collect::<Vec<_>>(),
            "artists": items(&r, "/data").iter().map(|i| deezer_item("artist", i)).collect::<Vec<_>>(),
        }));
    }
    let data = apple_get(app, &format!("/v1/catalog/fr/search?{}", query(&[("term", q), ("types", "playlists,albums,artists"), ("limit", "8")]))).await?;
    Ok(json!({
        "playlists": items(&data, "/results/playlists/data").iter().map(|i| apple_item("playlist", i)).collect::<Vec<_>>(),
        "albums": items(&data, "/results/albums/data").iter().map(|i| apple_item("album", i)).collect::<Vec<_>>(),
        "artists": items(&data, "/results/artists/data").iter().map(|i| apple_item("artist", i)).collect::<Vec<_>>(),
    }))
}

pub async fn deezer_user_playlists(app: &Shared, user_id: &str) -> Result<Value, String> {
    let data = deezer_get(app, &format!("/user/{}/playlists?limit=50", urlencoding::encode(user_id))).await?;
    Ok(json!({ "playlists": items(&data, "/data").iter().map(|i| deezer_item("playlist", i)).collect::<Vec<_>>() }))
}

pub async fn catalog_tracks(app: &Shared, source: &str, kind: &str, id: &str) -> Result<Vec<Value>, String> {
    let safe = urlencoding::encode(id);
    let mut tracks = Vec::new();
    if source == "Deezer" {
        if kind == "artist" { return Ok(items(&deezer_get(app, &format!("/artist/{safe}/top?limit=50")).await?, "/data").iter().map(|t| deezer_track(t, None)).collect()); }
        if kind == "album" {
            let album = deezer_get(app, &format!("/album/{safe}")).await?;
            return Ok(items(&album, "/tracks/data").iter().map(|t| deezer_track(t, Some(&album))).collect());
        }
        let mut index = 0usize;
        while tracks.len() < FALLBACK_MAX_TRACKS {
            let page = deezer_get(app, &format!("/playlist/{safe}/tracks?index={index}&limit=1000")).await?;
            let list = items(&page, "/data");
            tracks.extend(list.iter().map(|t| deezer_track(t, None)));
            index += list.len();
            let total = page.get("total").and_then(Value::as_u64).map(|t| t as usize).unwrap_or(index);
            if list.is_empty() || index >= total { break; }
        }
        return Ok(tracks);
    }
    if kind == "artist" { return Ok(items(&apple_get(app, &format!("/v1/catalog/fr/artists/{safe}/view/top-songs?limit=30")).await?, "/data").iter().map(apple_track).collect()); }
    let mut next = Some(format!("/v1/catalog/fr/{}/{safe}/tracks?limit=100", if kind == "album" { "albums" } else { "playlists" }));
    while let Some(path) = next.take() {
        if tracks.len() >= FALLBACK_MAX_TRACKS { break; }
        let page = apple_get(app, &path).await?;
        tracks.extend(items(&page, "/data").iter().filter(|i| i.get("type").map(|t| t == "songs").unwrap_or(true)).map(apple_track));
        next = page.get("next").and_then(Value::as_str).map(str::to_string);
    }
    Ok(tracks)
}

pub fn clean_track(track: &Value) -> Value {
    let cover = text(track.get("cover"), usize::MAX);
    let artist = { let a = text(track.get("artist"), 200); if a.is_empty() { "Artiste inconnu".to_string() } else { a } };
    json!({
        "providerId": text(track.get("providerId"), 80), "title": text(track.get("title"), 200),
        "artist": artist,
        "album": text(track.get("album"), 200),
        "durationMs": super::logic::jnum(super::logic::number(track.get("durationMs")).filter(|f| !f.is_nan()).unwrap_or(0.0).clamp(0.0, 3_600_000.0)),
        "cover": if cover.starts_with("https://") { text(track.get("cover"), 500) } else { String::new() },
        "source": if track.get("source").and_then(Value::as_str) == Some("Deezer") { "Deezer" } else { "Apple Music" },
    })
}
