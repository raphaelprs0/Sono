// Logique des sessions : admission des invités, admins, musique de fond, et ce que chacun reçoit.
// Les sessions restent des objets JSON (comme dans le fichier sessions.json) : mêmes champs que la version précédente.
use super::state::{Client, State};
use rand::seq::SliceRandom;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Comme `String(value || '').trim().slice(0, max)`.
pub fn text(value: Option<&Value>, max: usize) -> String {
    let raw = match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            if n.as_f64() == Some(0.0) { String::new() } else { n.to_string() }
        }
        Some(Value::Bool(true)) => "true".into(),
        Some(Value::Object(_)) => "[object Object]".into(),
        Some(Value::Array(a)) if !a.is_empty() => a.iter().map(|v| text(Some(v), usize::MAX)).collect::<Vec<_>>().join(","),
        _ => String::new(),
    };
    raw.trim().chars().take(max).collect()
}

pub fn text_str(value: Option<&str>, max: usize) -> String {
    value.unwrap_or("").trim().chars().take(max).collect()
}

/// Comme `Number(value)` : None pour NaN.
pub fn number(value: Option<&Value>) -> Option<f64> {
    match value {
        None => None,
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(b)) => Some(if *b { 1.0 } else { 0.0 }),
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() { Some(0.0) } else { t.parse::<f64>().ok() }
        }
        _ => None,
    }
}

pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}

/// Nombre JSON comme en JavaScript : 248000 plutôt que 248000.0.
pub fn jnum(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.0e15 { json!(f as i64) } else { json!(f) }
}

pub fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn member_key(code: &str, client_id: &str) -> String {
    let digest = Sha256::digest(format!("{code}:{client_id}").as_bytes());
    hex::encode(digest)[..12].to_string()
}

#[derive(Clone, Debug, Default)]
pub struct Viewer {
    pub host: bool,
    pub client_id: String,
}

impl Viewer {
    pub fn host() -> Self { Viewer { host: true, client_id: String::new() } }
}

/// Quand la validation est active, un invité n’accède à la session qu’après l’accord de l’hôte.
pub fn admission_of(session: &Value, viewer: &Viewer) -> &'static str {
    if viewer.host { return "accepted"; }
    let member = session.get("members").and_then(|m| m.get(&viewer.client_id));
    let status = member.map(|m| str_of(m, "status")).unwrap_or("");
    if status == "removed" { return "removed"; }
    if status == "left" { return "accepted"; }
    let must_ask = member.map(|m| truthy(m.get("mustAsk"))).unwrap_or(false);
    if !truthy(session.get("requireApproval")) && !must_ask { return "accepted"; }
    match status { "accepted" => "accepted", "refused" => "refused", _ => "pending" }
}

pub fn admin_by_key(session: &Value, key: &str) -> Option<(String, Value)> {
    if key.is_empty() { return None; }
    let members = session.get("members")?.as_object()?;
    for (client_id, member) in members {
        if truthy(member.get("admin")) && !str_of(member, "adminKey").is_empty() && str_of(member, "adminKey") == key {
            return Some((client_id.clone(), member.clone()));
        }
    }
    None
}

pub enum Access { Owner, Admin }

pub fn host_access(session: &Value, key: &str) -> Option<Access> {
    if key.is_empty() { return None; }
    if key == str_of(session, "hostToken") { return Some(Access::Owner); }
    // Un admin désigné par l’hôte a toujours les commandes (lecture, file, arrivées).
    admin_by_key(session, key).map(|_| Access::Admin)
}

pub fn is_controller(session: &Value, viewer: &Viewer) -> bool {
    if viewer.host { return true; }
    if viewer.client_id.is_empty() { return false; }
    session.get("members").and_then(|m| m.get(&viewer.client_id)).map(|m| truthy(m.get("admin"))).unwrap_or(false)
}

pub fn clients_of<'a>(state: &'a State, code: &str) -> impl Iterator<Item = &'a Client> {
    state.clients.get(code).into_iter().flatten()
}

pub fn host_online(state: &State, code: &str) -> bool {
    clients_of(state, code).any(|c| c.meta.host)
}

pub fn add_activity(session: &mut Value, icon: &str, message: &str) {
    let entry = json!({ "icon": icon, "text": message, "at": now_iso() });
    let list = session.as_object_mut().unwrap().entry("activity").or_insert_with(|| json!([]));
    if !list.is_array() { *list = json!([]); }
    let arr = list.as_array_mut().unwrap();
    arr.insert(0, entry);
    arr.truncate(40);
}

fn requests_of(state: &State, session: &Value) -> Vec<Value> {
    let code = str_of(session, "code");
    let mut by_client: Vec<(String, Value)> = Vec::new();
    for client in clients_of(state, code) {
        let meta = &client.meta;
        let viewer = Viewer { host: false, client_id: meta.client_id.clone() };
        if !meta.greeted || meta.host || meta.name.is_empty() || admission_of(session, &viewer) != "pending" { continue; }
        let since = session.get("members").and_then(|m| m.get(&meta.client_id)).map(|m| str_of(m, "since").to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| meta.since.clone());
        let item = json!({ "id": member_key(code, &meta.client_id), "name": if meta.name.is_empty() { "Invité" } else { &meta.name }, "since": since });
        if let Some(slot) = by_client.iter_mut().find(|(id, _)| *id == meta.client_id) { slot.1 = item; } else { by_client.push((meta.client_id.clone(), item)); }
    }
    let mut list: Vec<Value> = by_client.into_iter().map(|(_, v)| v).collect();
    list.sort_by(|a, b| str_of(a, "since").cmp(str_of(b, "since")));
    list
}

fn participants_of(state: &State, session: &Value) -> Vec<Value> {
    let code = str_of(session, "code");
    let online: std::collections::HashSet<String> = clients_of(state, code).filter(|c| c.meta.greeted).map(|c| c.meta.client_id.clone()).collect();
    let mut guests: Vec<Value> = Vec::new();
    if let Some(members) = session.get("members").and_then(Value::as_object) {
        for (client_id, member) in members {
            let name = str_of(member, "name");
            if name.is_empty() || str_of(member, "status") == "left" { continue; }
            if admission_of(session, &Viewer { host: false, client_id: client_id.clone() }) != "accepted" { continue; }
            guests.push(json!({ "id": member_key(code, client_id), "name": name, "role": "guest", "admin": truthy(member.get("admin")), "since": member.get("since").cloned().unwrap_or(Value::Null), "online": online.contains(client_id) }));
        }
    }
    guests.sort_by(|a, b| {
        let oa = a["online"].as_bool().unwrap_or(false) as i32;
        let ob = b["online"].as_bool().unwrap_or(false) as i32;
        (ob - oa).cmp(&0).then_with(|| text(a.get("since"), usize::MAX).cmp(&text(b.get("since"), usize::MAX)))
    });
    let mut list = vec![json!({ "id": "host", "name": session.get("host").cloned().unwrap_or(Value::Null), "role": "host", "online": true })];
    list.extend(guests);
    list
}

// ───── Musique de fond ─────
fn shuffled(length: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..length).collect();
    order.shuffle(&mut rand::thread_rng());
    order
}

pub fn fallback_order(fallback: &Value) -> Vec<Value> {
    let length = fallback.get("tracks").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    let order: Vec<usize> = if str_of(fallback, "type") == "album" { (0..length).collect() } else { shuffled(length) };
    order.into_iter().map(|i| json!(i)).collect()
}

/// Les titres de fond à venir : une liste d’index, rechargée (et remélangée) quand elle est épuisée.
pub fn fallback_upcoming(session: &mut Value) -> Vec<usize> {
    let Some(fallback) = session.get_mut("fallback").filter(|f| f.is_object()) else { return vec![] };
    let length = fallback.get("tracks").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    if length == 0 { return vec![]; }
    let blocked: std::collections::HashSet<i64> = fallback.get("blocked").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
    let playable = |v: &Value| v.as_f64().map(|f| f.fract() == 0.0 && f >= 0.0 && (f as usize) < length && !blocked.contains(&(f as i64))).unwrap_or(false);
    let mut upcoming: Vec<Value> = fallback.get("upcoming").and_then(Value::as_array).cloned().unwrap_or_default();
    upcoming.retain(|v| playable(v));
    if upcoming.is_empty() { upcoming = fallback_order(fallback).into_iter().filter(|v| playable(v)).collect(); }
    let list: Vec<usize> = upcoming.iter().filter_map(|v| v.as_f64()).map(|f| f as usize).collect();
    fallback["upcoming"] = Value::Array(upcoming);
    list
}

pub fn set_upcoming(session: &mut Value, list: &[usize]) {
    if let Some(fallback) = session.get_mut("fallback").filter(|f| f.is_object()) {
        fallback["upcoming"] = Value::Array(list.iter().map(|i| json!(i)).collect());
    }
}

pub fn fallback_item(session: &Value, index: usize) -> Value {
    let fallback = &session["fallback"];
    let mut item = fallback["tracks"][index].as_object().cloned().unwrap_or_default();
    item.insert("id".into(), json!(format!("fond-{index}")));
    item.insert("addedBy".into(), fallback.get("name").cloned().unwrap_or(Value::Null));
    item.insert("fromFallback".into(), json!(true));
    item.insert("fallbackIndex".into(), json!(index));
    Value::Object(item)
}

fn peek_fallback(session: &mut Value) -> Value {
    let upcoming = fallback_upcoming(session);
    upcoming.first().map(|i| fallback_item(session, *i)).unwrap_or(Value::Null)
}

pub fn take_fallback(session: &mut Value) -> Option<Value> {
    let mut upcoming = fallback_upcoming(session);
    if upcoming.is_empty() { return None; }
    let index = upcoming.remove(0);
    set_upcoming(session, &upcoming);
    let mut item = fallback_item(session, index);
    item["id"] = json!(uuid::Uuid::new_v4().to_string());
    Some(item)
}

const FALLBACK_VISIBLE: usize = 15;

fn fallback_queue_of(session: &mut Value) -> Value {
    let upcoming = fallback_upcoming(session);
    let tracks: Vec<Value> = upcoming.iter().take(FALLBACK_VISIBLE).map(|i| fallback_item(session, *i)).collect();
    json!({ "tracks": tracks, "total": upcoming.len() })
}

fn fallback_summary(session: &mut Value, viewer: &Viewer) -> Value {
    let Some(fallback) = session.get("fallback").filter(|f| f.is_object()) else { return Value::Null };
    let mut summary = json!({
        "type": fallback.get("type"), "name": fallback.get("name"), "subtitle": fallback.get("subtitle"), "cover": fallback.get("cover"),
        "source": fallback.get("source"), "count": fallback.get("tracks").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0),
    });
    if is_controller(session, viewer) { summary["next"] = peek_fallback(session); }
    summary
}

// Couleurs choisies par l’hôte, reprises sur les écrans des invités.
const THEME_BACKGROUNDS: [&str; 4] = ["black", "white", "auto", "cover"];

pub fn clean_theme(theme: Option<&Value>) -> Value {
    let Some(theme) = theme.filter(|t| t.is_object()) else { return Value::Null };
    let background = str_of(theme, "background");
    let accent = str_of(theme, "accent");
    let valid_accent = accent.len() == 7 && accent.starts_with('#') && accent[1..].chars().all(|c| c.is_ascii_hexdigit());
    json!({
        "background": if THEME_BACKGROUNDS.contains(&background) { background } else { "black" },
        "accent": if valid_accent { accent.to_lowercase() } else { "#d7f75b".into() },
        "glass": theme.get("glass") == Some(&json!(true)),
        "lang": if str_of(theme, "lang") == "en" { "en" } else { "fr" },
    })
}

pub fn public_session(state: &State, session: &mut Value, viewer: &Viewer) -> Value {
    let playback = session.get("playbackSource").and_then(Value::as_str).map(str::to_string);
    let source = match playback.as_deref() { Some("Deezer") if state.deezer.is_none() => Value::Null, Some(s) => json!(s), None => Value::Null };
    let mut apps = vec![];
    if state.apple_linked { apps.push("Apple Music"); }
    if state.deezer.is_some() { apps.push("Deezer"); }
    let code = str_of(session, "code").to_string();
    let mut base = json!({
        "code": code, "name": session.get("name"), "host": session.get("host"), "active": session.get("active"),
        "requireApproval": truthy(session.get("requireApproval")), "source": source, "apps": apps,
        "theme": clean_theme(session.get("theme")), "hostOnline": host_online(state, &code),
    });
    if admission_of(session, viewer) != "accepted" {
        base["guests"] = json!(0);
        base["participants"] = json!([]);
        return base;
    }
    let participants = participants_of(state, session);
    base["fallback"] = fallback_summary(session, viewer);
    base["guests"] = json!(participants.iter().filter(|p| p["role"] != "host" && p["online"] == true).count());
    base["participants"] = Value::Array(participants);
    if is_controller(session, viewer) { base["requests"] = Value::Array(requests_of(state, session)); }
    base
}

pub fn payload(state: &State, session: &mut Value, viewer: &Viewer) -> Value {
    let admission = admission_of(session, viewer);
    let member = if !viewer.host && !viewer.client_id.is_empty() { session.get("members").and_then(|m| m.get(&viewer.client_id)).cloned() } else { None };
    let mut out = Map::new();
    out.insert("session".into(), public_session(state, session, viewer));
    out.insert("admission".into(), json!(admission));
    if !viewer.host && !viewer.client_id.is_empty() {
        out.insert("you".into(), member.as_ref().and_then(|m| m.get("name")).cloned().unwrap_or(Value::Null));
        if let Some(m) = &member {
            if truthy(m.get("admin")) && !str_of(m, "adminKey").is_empty() {
                out.insert("admin".into(), json!({ "key": m["adminKey"], "id": member_key(str_of(session, "code"), &viewer.client_id) }));
            }
        }
    }
    if admission != "accepted" { return Value::Object(out); }
    out.insert("queue".into(), session.get("queue").cloned().unwrap_or(json!([])));
    let fallback_queue = if session.get("fallback").map(|f| f.is_object()).unwrap_or(false) { fallback_queue_of(session) } else { Value::Null };
    out.insert("fallbackQueue".into(), fallback_queue);
    if is_controller(session, viewer) {
        let history = session.get("history").and_then(Value::as_array).cloned().unwrap_or_default();
        out.insert("previous".into(), history.first().cloned().unwrap_or(Value::Null));
        out.insert("history".into(), Value::Array(history.into_iter().take(5).collect()));
    }
    out.insert("current".into(), session.get("current").cloned().unwrap_or(Value::Null));
    out.insert("playing".into(), session.get("playing").cloned().unwrap_or(json!(false)));
    out.insert("activity".into(), session.get("activity").cloned().unwrap_or(json!([])));
    Value::Object(out)
}

// ───── Son ─────
#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Sound { pub bass: f64, pub mid: f64, pub treble: f64 }

pub fn clean_sound(value: Option<&Value>) -> Sound {
    let db = |key: &str| {
        let v = number(value.and_then(|v| v.get(key))).filter(|f| !f.is_nan()).unwrap_or(0.0);
        ((v * 2.0).round() / 2.0).clamp(-12.0, 12.0)
    };
    Sound { bass: db("bass"), mid: db("mid"), treble: db("treble") }
}

const SOUND_WEIGHTS: [(&str, [f64; 10]); 3] = [
    ("bass", [1.0, 1.0, 0.85, 0.5, 0.15, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("mid", [0.0, 0.0, 0.1, 0.4, 0.85, 1.0, 0.85, 0.4, 0.1, 0.0]),
    ("treble", [0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.4, 0.8, 1.0, 1.0]),
];

pub fn sound_eq(s: &Sound) -> Value {
    let gains: Vec<f64> = (0..10).map(|band| {
        let sum: f64 = SOUND_WEIGHTS.iter().map(|(key, w)| w[band] * match *key { "bass" => s.bass, "mid" => s.mid, _ => s.treble }).sum();
        sum.clamp(-12.0, 12.0)
    }).collect();
    let max = gains.iter().cloned().fold(0.0_f64, f64::max);
    json!({ "gains": gains, "preampDb": -max })
}

/// L’app de musique a été déconnectée : la session repart de zéro (lecture, file, historique, musique de fond),
/// avec les mêmes invités et le même code.
pub fn reset_session(session: &mut Value) {
    session["playing"] = json!(false);
    session["current"] = Value::Null;
    session["queue"] = json!([]);
    session["history"] = json!([]);
    session["fallback"] = Value::Null;
    add_activity(session, "music", "App de musique déconnectée : la file repart de zéro");
}
