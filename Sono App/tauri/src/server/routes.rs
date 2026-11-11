// Routes de l’API : mêmes adresses, mêmes réponses et mêmes messages que la version précédente du serveur.
use super::catalog;
use super::deezer::{self, Method};
use super::logic::*;
use super::state::{DeezerConn, Shared, State};
use super::tunnel;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, FromRequest, Query, RawPathParams, Request};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rand::Rng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;

pub struct Req {
    pub app: Shared,
    pub addr: SocketAddr,
    pub headers: HeaderMap,
    pub query: HashMap<String, String>,
    pub params: HashMap<String, String>,
    pub body: Value,
}

impl FromRequest<Shared> for Req {
    type Rejection = Response;
    async fn from_request(req: Request, app: &Shared) -> Result<Self, Self::Rejection> {
        let (mut parts, body) = req.into_parts();
        let addr = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0).unwrap_or_else(|| ([127, 0, 0, 1], 0).into());
        let query = Query::<HashMap<String, String>>::try_from_uri(&parts.uri).map(|q| q.0).unwrap_or_default();
        let params: HashMap<String, String> = <RawPathParams as axum::extract::FromRequestParts<Shared>>::from_request_parts(&mut parts, app).await.map(|p| p.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()).unwrap_or_default();
        let headers = parts.headers.clone();
        let bytes = Bytes::from_request(Request::from_parts(parts, body), app).await.map_err(|_| err(StatusCode::PAYLOAD_TOO_LARGE, "La demande est trop volumineuse."))?;
        let body = if bytes.is_empty() { json!({}) } else { serde_json::from_slice(&bytes).unwrap_or(json!({})) };
        Ok(Req { app: app.clone(), addr, headers, query, params, body })
    }
}

impl Req {
    pub fn header(&self, name: &str) -> &str { self.headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or("") }
    fn key(&self) -> String { self.header("x-host-token").to_string() }
    pub fn viewer(&self, session: &Value) -> Viewer {
        Viewer { host: matches!(host_access(session, &self.key()), Some(Access::Owner)), client_id: text_str(Some(self.header("x-sono-client")), 64) }
    }
    fn b(&self, key: &str) -> Option<&Value> { self.body.get(key) }
    fn q(&self, key: &str) -> Option<&str> { self.query.get(key).map(String::as_str) }
    fn p(&self, key: &str) -> &str { self.params.get(key).map(String::as_str).unwrap_or("") }
    fn is_local(&self) -> bool { self.addr.ip().is_loopback() || matches!(self.addr.ip(), std::net::IpAddr::V6(v6) if v6.to_ipv4_mapped().map(|v4| v4.is_loopback()).unwrap_or(false)) }
    pub fn is_tunnel(&self) -> bool { ["cf-ray", "cf-connecting-ip", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"].iter().any(|h| !self.header(h).is_empty()) }
    fn is_direct_local(&self) -> bool { self.is_local() && !self.is_tunnel() }
    fn code_param(&self) -> String { self.p("code").to_uppercase() }
}

pub fn err(status: StatusCode, message: &str) -> Response { (status, Json(json!({ "error": message }))).into_response() }
fn ok(value: Value) -> Response { Json(value).into_response() }
fn created(value: Value) -> Response { (StatusCode::CREATED, Json(value)).into_response() }
fn not_found() -> Response { err(StatusCode::NOT_FOUND, "Cette session n’existe pas ou a expiré.") }
fn forbidden_host() -> Response { err(StatusCode::FORBIDDEN, "Seul l’hôte peut effectuer cette action.") }
fn sound_json(s: &Sound) -> Value { json!({ "bass": jnum(s.bass), "mid": jnum(s.mid), "treble": jnum(s.treble) }) }

/// Sort la session de l’état le temps de l’action (sans copie), puis la remet.
fn with_session<F>(app: &Shared, code: &str, f: F) -> Response
where F: FnOnce(&mut State, &mut Value) -> Response {
    let mut s = app.lock();
    let Some(slot) = s.sessions.get_mut(code) else { return not_found() };
    let mut session = std::mem::take(slot);
    let response = f(&mut s, &mut session);
    if let Some(slot) = s.sessions.get_mut(code) { *slot = session; }
    response
}

fn is_owner(r: &Req, session: &Value) -> bool { matches!(host_access(session, &r.key()), Some(Access::Owner)) }

fn control_denied(_session: &Value) -> Response {
    err(StatusCode::FORBIDDEN, "Seul l’hôte ou un admin peut effectuer cette action.")
}

fn pay(s: &State, session: &mut Value, viewer: &Viewer) -> Response { ok(payload(s, session, viewer)) }

fn changed(r: &Req, s: &State, session: &mut Value) -> Response {
    r.app.persist();
    r.app.broadcast(str_of(session, "code"));
    let viewer = r.viewer(session);
    pay(s, session, &viewer)
}

fn arr<'a>(session: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    let entry = session.as_object_mut().unwrap().entry(key).or_insert_with(|| json!([]));
    if !entry.is_array() { *entry = json!([]); }
    entry.as_array_mut().unwrap()
}

fn members(session: &mut Value) -> &mut serde_json::Map<String, Value> {
    let entry = session.as_object_mut().unwrap().entry("members").or_insert_with(|| json!({}));
    if !entry.is_object() { *entry = json!({}); }
    entry.as_object_mut().unwrap()
}

fn find_member(session: &Value, id: &str) -> Option<String> {
    let code = str_of(session, "code");
    session.get("members").and_then(Value::as_object)?.keys().find(|k| member_key(code, k) == id).cloned()
}

pub fn network_url(app: &Shared) -> Option<String> {
    let addresses: Vec<std::net::Ipv4Addr> = if_addrs::get_if_addrs().ok()?.into_iter().filter(|i| !i.is_loopback()).filter_map(|i| match i.ip() { std::net::IpAddr::V4(v4) => Some(v4), _ => None }).collect();
    let preferred = addresses.iter().find(|a| a.octets()[0] == 192 && a.octets()[1] == 168).or_else(|| addresses.first())?;
    let shown = if app.short_port_active.load(std::sync::atomic::Ordering::SeqCst) { app.short_port } else { app.port };
    Some(if shown == 80 { format!("http://{preferred}") } else { format!("http://{preferred}:{shown}") })
}

// ───── Divers ─────
pub async fn health() -> Response { ok(json!({ "ok": true, "service": "Sono" })) }

/// Adresse du service en ligne de Sono Mobile (pour rejoindre une session iPhone avec son code), lue à la compilation :
/// « fabriquer-tauri.sh » la prend dans « Sono Mobile/ios/Config.xcconfig », écrit par « Sono Mobile/deploy.sh ».
const MOBILE_SERVICE: &str = match option_env!("SONO_MOBILE_SERVICE") { Some(url) => url, None => "" };

pub async fn join_lookup(r: Req) -> Response {
    let code = r.q("code").unwrap_or("").to_string();
    let digits = regex::Regex::new(r"(?i)^SONO-(\d{4})$").unwrap().captures(&code).map(|c| c[1].to_string());
    let Some(digits) = digits else { return err(StatusCode::BAD_REQUEST, "Code invalide.") };
    if MOBILE_SERVICE.is_empty() { return err(StatusCode::NOT_FOUND, "Session introuvable."); }
    match r.app.http.get(format!("{MOBILE_SERVICE}/api/sessions/SONO-{digits}")).timeout(std::time::Duration::from_secs(5)).send().await {
        Ok(response) if response.status().is_success() => ok(json!({ "url": format!("{MOBILE_SERVICE}/{digits}") })),
        _ => err(StatusCode::NOT_FOUND, "Session introuvable."),
    }
}

pub async fn config(r: Req) -> Response {
    let (enabled, url) = { let s = r.app.lock(); (s.public_link_enabled, s.public_tunnel_url.clone()) };
    ok(json!({ "networkUrl": network_url(&r.app), "publicUrl": if enabled && !url.is_empty() { json!(url) } else { Value::Null } }))
}

// ───── Lien public ─────
fn public_link_host(r: &Req) -> Result<(), Response> {
    let code = text(r.b("code"), 20);
    let s = r.app.lock();
    let Some(session) = s.sessions.get(&code) else { return Err(not_found()) };
    if !is_owner(r, session) { return Err(forbidden_host()); }
    // Jamais au travers du lien public lui-même.
    if r.is_tunnel() { return Err(err(StatusCode::FORBIDDEN, "Le lien public doit être géré depuis le Wi-Fi, pas depuis le lien public.")); }
    Ok(())
}

pub async fn public_prepare(r: Req) -> Response {
    if let Err(response) = public_link_host(&r) { return response; }
    let app = r.app.clone();
    tokio::spawn(async move { let _ = tunnel::start(&app).await; });
    (StatusCode::ACCEPTED, Json(json!({ "ok": true }))).into_response()
}

pub async fn public_enable(r: Req) -> Response {
    if let Err(response) = public_link_host(&r) { return response; }
    match tunnel::start(&r.app).await {
        Ok(url) => {
            { let mut s = r.app.lock(); s.public_link_enabled = true; s.host_prefs["publicUsed"] = json!(true); }
            r.app.persist();
            ok(json!({ "publicUrl": url }))
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Impossible de créer le lien public : {e}")),
    }
}

pub async fn public_disable(r: Req) -> Response {
    if let Err(response) = public_link_host(&r) { return response; }
    r.app.lock().public_link_enabled = false;
    tunnel::close_public_sockets(&r.app);
    ok(json!({ "ok": true }))
}

// ───── Sessions ─────
pub async fn get_session(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| { let v = r.viewer(session); pay(s, session, &v) })
}

pub async fn host_resume(r: Req) -> Response {
    let code = text(r.b("code"), 20);
    with_session(&r.app.clone(), &code, |s, session| {
        if !is_owner(&r, session) { return forbidden_host(); }
        let v = r.viewer(session);
        pay(s, session, &v)
    })
}

pub async fn host_bootstrap(r: Req) -> Response {
    if !r.is_direct_local() { return err(StatusCode::FORBIDDEN, "L’accès hôte doit être initialisé depuis cet appareil, sans passer par le lien public."); }
    let code = text(r.b("code"), 20);
    with_session(&r.app.clone(), &code, |s, session| {
        let mut out = payload(s, session, &Viewer::host());
        out.as_object_mut().unwrap().shift_insert(0, "hostToken".into(), session.get("hostToken").cloned().unwrap_or(Value::Null));
        ok(out)
    })
}

pub async fn create_session(r: Req) -> Response {
    let previous_code = text(r.b("previousCode"), 20);
    let mut s = r.app.lock();
    let trusted = s.sessions.get(&previous_code).filter(|p| !r.key().is_empty() && r.key() == str_of(p, "hostToken")).cloned();
    if trusted.is_none() && r.is_tunnel() { return err(StatusCode::FORBIDDEN, "Une session se crée depuis le réseau Wi-Fi local, pas depuis le lien public."); }
    let name = text(r.b("name"), 80);
    if name.is_empty() { return err(StatusCode::BAD_REQUEST, "Donnez un nom à votre session."); }
    let code = loop {
        let candidate = format!("SONO-{}", rand::thread_rng().gen_range(1000..10000));
        if !s.sessions.contains_key(&candidate) { break candidate; }
    };
    let host = { let h = text(r.b("host"), 30); if !h.is_empty() { h } else { trusted.as_ref().map(|t| str_of(t, "host").to_string()).filter(|h| !h.is_empty()).unwrap_or_else(|| "Hôte".into()) } };
    let require = match r.b("requireApproval") { Some(Value::Bool(b)) => *b, _ => trusted.as_ref().map(|t| truthy(t.get("requireApproval"))).unwrap_or(false) };
    let token = uuid::Uuid::new_v4().to_string();
    let mut session = json!({
        "code": code, "name": name, "host": host, "active": true, "requireApproval": require, "playbackSource": s.preferred_source,
        "members": {}, "hostToken": token, "queue": [], "history": [], "playing": false, "current": null,
        "activity": [{ "icon": "music", "text": "La session est prête", "at": now_iso() }],
    });
    let mut out = payload(&s, &mut session, &Viewer::host());
    s.sessions.insert(code, session);
    drop(s);
    r.app.persist();
    out.as_object_mut().unwrap().shift_insert(0, "hostToken".into(), json!(token));
    created(out)
}

pub async fn add_track(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        let viewer = r.viewer(session);
        let member_name = session.get("members").and_then(|m| m.get(&viewer.client_id)).map(|m| str_of(m, "name").to_string()).unwrap_or_default();
        if !viewer.host && member_name.is_empty() { return err(StatusCode::FORBIDDEN, "Indiquez votre prénom pour rejoindre la session."); }
        if admission_of(session, &viewer) != "accepted" { return err(StatusCode::FORBIDDEN, "L’hôte doit d’abord accepter votre demande."); }
        let track = r.b("track").cloned().unwrap_or(json!({}));
        let title = text(track.get("title"), 180);
        let artist = text(track.get("artist"), 180);
        if title.is_empty() || artist.is_empty() { return err(StatusCode::BAD_REQUEST, "Ce titre est incomplet. Essayez un autre résultat."); }
        let duplicate = session.get("queue").and_then(Value::as_array).map(|q| q.iter().any(|i| str_of(i, "title").to_lowercase() == title.to_lowercase() && str_of(i, "artist").to_lowercase() == artist.to_lowercase())).unwrap_or(false);
        if duplicate { return err(StatusCode::CONFLICT, "Ce titre figure déjà dans la file."); }
        // Le nom affiché vient du serveur : un invité ne peut pas se faire passer pour quelqu’un d’autre.
        let added_by = if viewer.host { str_of(session, "host").to_string() } else { member_name };
        let provider = { let p = text(track.get("providerId"), 120); if p.is_empty() { text(track.get("id"), 120) } else { p } };
        let duration_ms = track.get("durationMs").and_then(Value::as_f64).filter(|f| f.is_finite()).map(jnum).unwrap_or(json!(0));
        let source = { let v = text(track.get("source"), 40); if v.is_empty() { "Recherche".to_string() } else { v } };
        let item = json!({ "id": uuid::Uuid::new_v4().to_string(), "providerId": provider, "title": title, "artist": artist, "album": text(track.get("album"), 180), "duration": text(track.get("duration"), 12), "durationMs": duration_ms, "cover": text(track.get("cover"), 700), "addedBy": added_by, "source": source });
        arr(session, "queue").push(item.clone());
        add_activity(session, "plus", &format!("{added_by} a ajouté « {title} »"));
        r.app.persist();
        r.app.broadcast(&code);
        let mut out = payload(s, session, &viewer);
        out.as_object_mut().unwrap().shift_insert(0, "track".into(), item);
        created(out)
    })
}

pub async fn remove_track(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let id = r.p("id").to_string();
        let queue = arr(session, "queue");
        let track = queue.iter().find(|i| str_of(i, "id") == id).cloned();
        queue.retain(|i| str_of(i, "id") != id);
        if let Some(t) = track { add_activity(session, "music", &format!("L’hôte a retiré « {} »", str_of(&t, "title"))); }
        changed(&r, s, session)
    })
}

pub async fn reorder_queue(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let ids: Vec<String> = r.b("ids").and_then(Value::as_array).map(|a| a.iter().map(|v| text(Some(v), usize::MAX)).collect()).unwrap_or_default();
        let queue = arr(session, "queue").clone();
        let unique: std::collections::HashSet<&String> = ids.iter().collect();
        let valid = ids.len() == queue.len() && unique.len() == ids.len() && ids.iter().all(|id| queue.iter().any(|i| str_of(i, "id") == id));
        if !valid { return err(StatusCode::BAD_REQUEST, "Le nouvel ordre de la file est invalide."); }
        *arr(session, "queue") = ids.iter().map(|id| queue.iter().find(|i| str_of(i, "id") == id).unwrap().clone()).collect();
        changed(&r, s, session)
    })
}

pub async fn playback(r: Req) -> Response {
    let code = r.code_param();
    let app = r.app.clone();
    with_session(&app, &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let action = r.b("action").and_then(Value::as_str).unwrap_or("").to_string();
        if !["next", "previous", "toggle", "ended"].contains(&action.as_str()) { return err(StatusCode::BAD_REQUEST, "Cette commande de lecture est invalide."); }
        let has_current = session.get("current").map(|c| c.is_object()).unwrap_or(false);
        if action == "toggle" && !has_current { return err(StatusCode::BAD_REQUEST, "Aucun titre n’est en cours de lecture."); }
        // Passage automatique : si un autre appareil hôte a déjà avancé, on ne saute pas un deuxième titre.
        if let Some(expected) = r.b("expected") {
            let current_id = session.get("current").and_then(|c| c.get("id")).and_then(Value::as_str).unwrap_or("");
            let expected_id = if truthy(Some(expected)) { text(Some(expected), usize::MAX) } else { String::new() };
            if current_id != expected_id { let v = r.viewer(session); return pay(s, session, &v); }
        }
        arr(session, "history");
        let count = number(r.b("count")).filter(|f| !f.is_nan()).map(|f| f.round() as i64).filter(|n| *n != 0).unwrap_or(1).clamp(1, 100);
        if action == "next" {
            for step in 0..count {
                let track = { let q = arr(session, "queue"); if q.is_empty() { None } else { Some(q.remove(0)) } }.or_else(|| take_fallback(session));
                let Some(track) = track else {
                    if step > 0 { break; }
                    return err(StatusCode::BAD_REQUEST, "La file est vide. Ajoutez un titre ou choisissez une musique de fond.");
                };
                if let Some(current) = session.get("current").filter(|c| c.is_object()).cloned() {
                    let history = arr(session, "history");
                    history.insert(0, current);
                    history.truncate(30);
                }
                session["current"] = track;
            }
            session["playing"] = json!(true);
        } else if action == "previous" {
            for step in 0..count {
                let previous = { let h = arr(session, "history"); if h.is_empty() { None } else { Some(h.remove(0)) } };
                let Some(previous) = previous else {
                    if step > 0 { break; }
                    return err(StatusCode::BAD_REQUEST, "Aucun titre précédent.");
                };
                // Le titre en cours retourne en tête : dans la musique de fond s’il en venait, sinon dans la file.
                let current = session.get("current").filter(|c| c.is_object()).cloned();
                if let Some(current) = current {
                    let index = current.get("fallbackIndex").and_then(Value::as_u64).map(|i| i as usize);
                    let in_fallback = current.get("fromFallback") == Some(&json!(true)) && index.map(|i| session.pointer(&format!("/fallback/tracks/{i}")).is_some()).unwrap_or(false);
                    if in_fallback {
                        let mut upcoming = fallback_upcoming(session);
                        upcoming.insert(0, index.unwrap());
                        set_upcoming(session, &upcoming);
                    } else { arr(session, "queue").insert(0, current); }
                }
                session["current"] = previous;
            }
            session["playing"] = json!(true);
        } else if action == "ended" {
            session["playing"] = json!(false);
        } else {
            let playing = session.get("playing") == Some(&json!(true));
            session["playing"] = json!(!playing);
        }
        let auto = if action == "next" && r.b("expected").is_some() { " (fin de titre)" } else { "" };
        let title = session.get("current").map(|c| str_of(c, "title").to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| "—".into());
        deezer::log_engine(&app, &format!("Sono {action}{auto} → en cours : {title}"));
        changed(&r, s, session)
    })
}

pub async fn patch_session(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if !is_owner(&r, session) { return forbidden_host(); }
        if r.b("name").is_some() {
            let name = text(r.b("name"), 80);
            if name.is_empty() { return err(StatusCode::BAD_REQUEST, "Le nom de la session ne peut pas être vide."); }
            session["name"] = json!(name);
        }
        if r.b("host").is_some() {
            let host = text(r.b("host"), 30);
            if host.is_empty() { return err(StatusCode::BAD_REQUEST, "Indiquez le nom affiché aux invités."); }
            session["host"] = json!(host);
        }
        if let Some(source) = r.b("playbackSource") {
            let valid = source.is_null() || source == "Apple Music" || source == "Deezer";
            if !valid { return err(StatusCode::BAD_REQUEST, "Cette source de lecture est inconnue."); }
            if source == "Deezer" && s.deezer.is_none() { return err(StatusCode::BAD_REQUEST, "Connectez d’abord Deezer."); }
            session["playbackSource"] = source.clone();
            if let Some(name) = source.as_str() { s.preferred_source = Some(name.to_string()); }
            if source == "Apple Music" { s.apple_linked = true; }
        }
        if let Some(Value::Bool(linked)) = r.b("appleLinked") {
            // Apple Music déconnecté : la session repart de zéro.
            if s.apple_linked && !*linked { reset_session(session); }
            s.apple_linked = *linked;
        }
        if r.b("theme").is_some() { session["theme"] = clean_theme(r.b("theme")); }
        if let Some(Value::Bool(require)) = r.b("requireApproval") {
            if *require && !truthy(session.get("requireApproval")) {
                // Les invités déjà présents, connectés ou non, restent dans la session.
                for member in members(session).values_mut() {
                    if !str_of(member, "name").is_empty() && str_of(member, "status").is_empty() { member["status"] = json!("accepted"); }
                }
            }
            session["requireApproval"] = json!(*require);
        }
        changed(&r, s, session)
    })
}

pub async fn admissions(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let decision = r.b("decision").and_then(Value::as_str).unwrap_or("");
        if decision != "accept" && decision != "refuse" { return err(StatusCode::BAD_REQUEST, "Cette décision est invalide."); }
        let id = text(r.b("id"), 20);
        let live: Vec<(String, String, String)> = s.clients.get(&code).map(|l| l.iter().filter(|c| !c.meta.host).map(|c| (c.meta.client_id.clone(), c.meta.name.clone(), c.meta.since.clone())).collect()).unwrap_or_default();
        let mut candidates: Vec<String> = session.get("members").and_then(Value::as_object).map(|m| m.keys().cloned().collect()).unwrap_or_default();
        for (cid, _, _) in &live { if !candidates.contains(cid) { candidates.push(cid.clone()); } }
        let Some(client_id) = candidates.into_iter().find(|c| member_key(&code, c) == id) else { return err(StatusCode::NOT_FOUND, "Cette demande n’existe plus."); };
        let live_meta = live.iter().find(|(c, _, _)| *c == client_id);
        let existing = session.get("members").and_then(|m| m.get(&client_id)).cloned().unwrap_or(json!({}));
        let name = Some(str_of(&existing, "name")).filter(|n| !n.is_empty()).map(str::to_string).or_else(|| live_meta.map(|l| l.1.clone()).filter(|n| !n.is_empty())).unwrap_or_else(|| "Un invité".into());
        let accepted = decision == "accept";
        let since = Some(str_of(&existing, "since")).filter(|v| !v.is_empty()).map(str::to_string).or_else(|| live_meta.map(|l| l.2.clone())).unwrap_or_else(now_iso);
        let mut member = existing.as_object().cloned().unwrap_or_default();
        member.insert("status".into(), json!(if accepted { "accepted" } else { "refused" }));
        member.insert("name".into(), json!(name));
        member.insert("since".into(), json!(since));
        if accepted { member.remove("mustAsk"); }
        members(session).insert(client_id.clone(), Value::Object(member));
        if accepted {
            let known = arr(session, "knownGuests");
            known.push(json!(client_id));
            let excess = known.len().saturating_sub(200);
            known.drain(..excess);
            add_activity(session, "user", &format!("{name} a rejoint la session"));
        } else { add_activity(session, "user", &format!("La demande de {name} a été refusée")); }
        changed(&r, s, session)
    })
}

pub async fn remove_member(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if !is_owner(&r, session) { return forbidden_host(); }
        let id = text_str(Some(r.p("id")), 20);
        let Some(client_id) = find_member(session, &id) else { return err(StatusCode::NOT_FOUND, "Cet invité ne fait plus partie de la session."); };
        let member = members(session).get_mut(&client_id).unwrap();
        if let Some(m) = member.as_object_mut() { m.remove("admin"); m.remove("adminKey"); }
        member["status"] = json!("removed");
        member["mustAsk"] = json!(true);
        let name = str_of(member, "name").to_string();
        add_activity(session, "user", &format!("{name} a été retiré de la session"));
        changed(&r, s, session)
    })
}

pub async fn set_admin(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if !is_owner(&r, session) { return forbidden_host(); }
        let id = text(r.b("id"), 20);
        let client_id = find_member(session, &id);
        let valid = client_id.as_ref().and_then(|c| session.pointer(&format!("/members/{}", c.replace('~', "~0").replace('/', "~1")))).map(|m| !str_of(m, "name").is_empty() && str_of(m, "status") != "removed" && str_of(m, "status") != "left").unwrap_or(false);
        if !valid { return err(StatusCode::NOT_FOUND, "Cet invité ne fait plus partie de la session."); }
        let client_id = client_id.unwrap();
        let admin = truthy(r.b("admin"));
        let member = members(session).get_mut(&client_id).unwrap();
        let name = str_of(member, "name").to_string();
        let is_admin = truthy(member.get("admin"));
        if admin && !is_admin {
            member["admin"] = json!(true);
            member["adminKey"] = json!(hex::encode(rand::thread_rng().gen::<[u8; 24]>()));
            add_activity(session, "user", &format!("{name} est maintenant admin"));
        } else if !admin && is_admin {
            if let Some(m) = member.as_object_mut() { m.remove("admin"); m.remove("adminKey"); }
            add_activity(session, "user", &format!("{name} n’est plus admin"));
        }
        changed(&r, s, session)
    })
}

fn owner_check(r: &Req, code: &str) -> Result<(), Response> {
    let s = r.app.lock();
    let Some(session) = s.sessions.get(code) else { return Err(not_found()) };
    if !is_owner(r, session) { return Err(forbidden_host()); }
    Ok(())
}

pub async fn stop_music(r: Req) -> Response {
    let code = r.code_param();
    if let Err(response) = owner_check(&r, &code) { return response; }
    deezer::stop_session_music(&r.app, &code, "Musique coupée : l’hôte a quitté la session").await;
    with_session(&r.app.clone(), &code, |s, session| { let v = r.viewer(session); pay(s, session, &v) })
}

pub async fn delete_session(r: Req) -> Response {
    let code = r.code_param();
    if let Err(response) = owner_check(&r, &code) { return response; }
    deezer::stop_session_music(&r.app, &code, "Musique coupée : session supprimée").await;
    {
        let mut s = r.app.lock();
        if let Some(list) = s.clients.remove(&code) {
            for client in list { let _ = client.tx.send(axum::extract::ws::Message::Close(Some(axum::extract::ws::CloseFrame { code: 4004, reason: "Session supprimée".into() }))); }
        }
        s.sessions.shift_remove(&code);
        if s.host_prefs.get("sessionCode").and_then(Value::as_str) == Some(&code) { s.host_prefs["sessionCode"] = Value::Null; }
    }
    r.app.persist();
    ok(json!({ "ok": true }))
}

// ───── Apple Music ─────
pub async fn apple_status(r: Req) -> Response {
    match catalog::apple_search(&r.app, "As It Was", 1).await {
        Ok(tracks) if !tracks.is_empty() => ok(json!({ "available": true, "title": tracks[0].pointer("/attributes/name").cloned().unwrap_or(json!("Apple Music")) })),
        Ok(_) => (StatusCode::BAD_GATEWAY, Json(json!({ "available": false, "error": "Catalogue Apple Music indisponible : Le catalogue Apple Music n’a retourné aucun titre." }))).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({ "available": false, "error": format!("Catalogue Apple Music indisponible : {e}") }))).into_response(),
    }
}

pub async fn apple_developer_token(r: Req) -> Response {
    let mut response = match catalog::apple_token(&r.app).await {
        Ok(token) => ok(json!({ "developerToken": token })),
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Connexion Apple Music indisponible : {e}")),
    };
    response.headers_mut().insert("Cache-Control", "no-store".parse().unwrap());
    response
}

pub async fn apple_search(r: Req) -> Response {
    let q = text_str(r.q("q"), 120);
    if q.is_empty() { return ok(json!({ "tracks": [] })); }
    match catalog::apple_search(&r.app, &q, 10).await {
        Ok(tracks) => ok(json!({ "tracks": tracks.iter().map(catalog::normalize_apple_track).collect::<Vec<_>>() })),
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Recherche Apple Music impossible : {e}")),
    }
}

// ───── Catalogue et musique de fond ─────
fn catalog_source(r: &Req, session: &Value) -> Result<String, Response> {
    let source = r.q("source").map(str::to_string).or_else(|| r.b("source").and_then(Value::as_str).map(str::to_string)).or_else(|| session.get("playbackSource").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
    if source == "Apple Music" || source == "Deezer" { Ok(source) } else { Err(err(StatusCode::BAD_REQUEST, "Connectez d’abord Apple Music ou Deezer.")) }
}

fn owner_session(r: &Req, code: &str) -> Result<Value, Response> {
    let s = r.app.lock();
    let Some(session) = s.sessions.get(code) else { return Err(not_found()) };
    if !is_owner(r, session) { return Err(forbidden_host()); }
    Ok(json!({ "playbackSource": session.get("playbackSource") }))
}

pub async fn catalog_search(r: Req) -> Response {
    let code = r.code_param();
    let session = match owner_session(&r, &code) { Ok(s) => s, Err(e) => return e };
    let source = match catalog_source(&r, &session) { Ok(s) => s, Err(e) => return e };
    let q = text_str(r.q("q"), 120);
    if q.is_empty() { return ok(json!({ "playlists": [], "albums": [], "artists": [] })); }
    match catalog::catalog_search(&r.app, &source, &q).await {
        Ok(v) => ok(v),
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Recherche {source} impossible : {e}")),
    }
}

pub async fn catalog_mine(r: Req) -> Response {
    let code = r.code_param();
    if let Err(e) = owner_session(&r, &code) { return e; }
    let user = r.app.lock().deezer.as_ref().map(|d| d.user_id.clone()).unwrap_or_default();
    if user.is_empty() { return ok(json!({ "playlists": [] })); }
    match catalog::deezer_user_playlists(&r.app, &user).await {
        Ok(v) => ok(v),
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Vos playlists Deezer sont indisponibles : {e}")),
    }
}

pub async fn set_fallback(r: Req) -> Response {
    let code = r.code_param();
    let session = match owner_session(&r, &code) { Ok(s) => s, Err(e) => return e };
    let source = match catalog_source(&r, &session) { Ok(s) => s, Err(e) => return e };
    let kind = r.b("type").and_then(Value::as_str).filter(|t| ["playlist", "album", "artist"].contains(t)).map(str::to_string);
    let id = text(r.b("id"), 80);
    let Some(kind) = kind.filter(|_| !id.is_empty()) else { return err(StatusCode::BAD_REQUEST, "Choisissez une playlist, un album ou un artiste."); };
    // Les playlists de la bibliothèque Apple Music ne sont lisibles que depuis l’appareil de l’hôte, qui envoie leurs titres.
    let tracks: Vec<Value> = match r.b("tracks").and_then(Value::as_array) {
        Some(list) => list.iter().take(catalog::FALLBACK_MAX_TRACKS).map(catalog::clean_track).collect(),
        None => match catalog::catalog_tracks(&r.app, &source, &kind, &id).await {
            Ok(list) => list.into_iter().take(catalog::FALLBACK_MAX_TRACKS).collect(),
            Err(e) => return err(StatusCode::BAD_GATEWAY, &format!("Impossible de charger cette sélection : {e}")),
        },
    };
    let tracks: Vec<Value> = tracks.into_iter().filter(|t| !text(t.get("providerId"), usize::MAX).is_empty() && !text(t.get("title"), usize::MAX).is_empty()).collect();
    if tracks.is_empty() { return err(StatusCode::BAD_REQUEST, "Aucun titre lisible n’a été trouvé dans cette sélection."); }
    with_session(&r.app.clone(), &code, |s, session| {
        let name = { let n = text(r.b("name"), 120); if n.is_empty() { "Musique de fond".to_string() } else { n } };
        let cover = text(r.b("cover"), usize::MAX);
        let mut fallback = json!({ "type": kind, "id": id, "source": source, "name": name, "subtitle": text(r.b("subtitle"), 160), "cover": if cover.starts_with("https://") { text(r.b("cover"), 500) } else { String::new() }, "tracks": tracks });
        fallback["upcoming"] = Value::Array(fallback_order(&fallback));
        session["fallback"] = fallback;
        add_activity(session, "music", &format!("Musique de fond : {name}"));
        changed(&r, s, session)
    })
}

pub async fn fallback_list(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |_, session| {
        let viewer = r.viewer(session);
        if admission_of(session, &viewer) != "accepted" { return err(StatusCode::FORBIDDEN, "Vous n’avez pas encore accès à cette session."); }
        let has = session.get("fallback").map(|f| f.is_object()).unwrap_or(false);
        let upcoming = if has { fallback_upcoming(session) } else { vec![] };
        ok(json!({ "tracks": upcoming.iter().map(|i| fallback_item(session, *i)).collect::<Vec<_>>(), "total": upcoming.len() }))
    })
}

pub async fn fallback_order_route(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let mut upcoming = fallback_upcoming(session);
        let wanted = number(r.b("index"));
        let Some(from) = upcoming.iter().position(|i| Some(*i as f64) == wanted) else { return err(StatusCode::NOT_FOUND, "Ce titre n’est plus dans la musique de fond à venir."); };
        let to = (number(r.b("to")).filter(|f| !f.is_nan()).unwrap_or(0.0).round() as i64).clamp(0, upcoming.len() as i64 - 1) as usize;
        let item = upcoming.remove(from);
        upcoming.insert(to.min(upcoming.len()), item);
        set_upcoming(session, &upcoming);
        changed(&r, s, session)
    })
}

pub async fn fallback_remove(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if host_access(session, &r.key()).is_none() { return control_denied(session); }
        let index = r.p("index").parse::<f64>().ok();
        let mut upcoming = fallback_upcoming(session);
        let Some(position) = upcoming.iter().position(|i| Some(*i as f64) == index) else { return err(StatusCode::NOT_FOUND, "Ce titre n’est plus dans la musique de fond à venir."); };
        let removed = upcoming.remove(position);
        set_upcoming(session, &upcoming);
        // Titre que le compte ne peut pas lire : il ne reviendra plus aux tours suivants.
        if r.q("unavailable").map(|v| !v.is_empty()).unwrap_or(false) {
            let fallback = &mut session["fallback"];
            let mut blocked: Vec<Value> = fallback.get("blocked").and_then(Value::as_array).cloned().unwrap_or_default();
            if !blocked.contains(&json!(removed)) { blocked.push(json!(removed)); }
            fallback["blocked"] = Value::Array(blocked);
        }
        changed(&r, s, session)
    })
}

pub async fn clear_fallback(r: Req) -> Response {
    let code = r.code_param();
    with_session(&r.app.clone(), &code, |s, session| {
        if !is_owner(&r, session) { return forbidden_host(); }
        session["fallback"] = Value::Null;
        changed(&r, s, session)
    })
}

// ───── Deezer ─────
fn body_session_access(r: &Req, owner_only: bool) -> Result<String, Response> {
    let code = text(r.b("code").or_else(|| None), 20);
    let code = if code.is_empty() { text_str(r.q("code"), 20) } else { code };
    let s = r.app.lock();
    let Some(session) = s.sessions.get(&code) else { return Err(not_found()) };
    let access = host_access(session, &r.key());
    match (owner_only, access) {
        (true, Some(Access::Owner)) => Ok(code),
        (true, _) => Err(forbidden_host()),
        (false, Some(_)) => Ok(code),
        (false, None) => Err(control_denied(session)),
    }
}

fn network_error(message: String) -> String {
    if message == "fetch failed" { "Impossible de contacter Deezer. Vérifiez votre connexion Internet.".into() } else { message }
}

pub async fn deezer_login(r: Req) -> Response {
    let code = match body_session_access(&r, true) { Ok(c) => c, Err(e) => return e };
    let app = r.app.clone();
    if app.deezer_login_in_progress.load(std::sync::atomic::Ordering::SeqCst) { return err(StatusCode::CONFLICT, "Une connexion Deezer est déjà en cours. Terminez-la dans la fenêtre officielle."); }
    let method = text(r.b("method"), 20);
    let arl = text(r.b("arl"), 500);
    if method == "arl" && arl.chars().count() < 20 { return err(StatusCode::BAD_REQUEST, "Cet ARL est trop court. Copiez la valeur complète du cookie Deezer."); }
    if method != "arl" && method != "browser" { return err(StatusCode::BAD_REQUEST, "Choisissez la fenêtre officielle Deezer ou la connexion par ARL."); }
    app.deezer_login_in_progress.store(true, std::sync::atomic::Ordering::SeqCst);
    let result = async {
        let arl = if method == "arl" { arl } else {
            let login = app.deezer_login.lock().unwrap().clone();
            match login { Some(login) => login().await?, None => return Err("la fenêtre de connexion Deezer n’est disponible que dans l’app Sono. Utilisez « Mon ARL » ou l’app.".to_string()) }
        };
        let account = deezer::start_bridge(&app, arl).await?;
        let status = deezer::request(&app, "/status", Method::Get, None).await?;
        Ok::<_, String>((account, status))
    }.await;
    app.deezer_login_in_progress.store(false, std::sync::atomic::Ordering::SeqCst);
    match result {
        Ok((account, status)) => {
            {
                let mut s = app.lock();
                if let Some(session) = s.sessions.get_mut(&code) { session["playbackSource"] = json!("Deezer"); }
                s.preferred_source = Some("Deezer".into());
            }
            app.persist();
            app.broadcast_all();
            ok(json!({ "connected": true, "account": account, "status": status }))
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Connexion Deezer refusée : {}", network_error(e))),
    }
}

pub async fn deezer_status(r: Req) -> Response {
    if let Err(e) = body_session_access(&r, false) { return e; }
    let (account, status) = tokio::join!(deezer::request(&r.app, "/whoami", Method::Get, None), deezer::request(&r.app, "/status", Method::Get, None));
    match (account, status) {
        (Ok(account), Ok(status)) => ok(json!({ "connected": true, "account": account, "status": status })),
        (Err(e), _) | (_, Err(e)) => err(StatusCode::BAD_GATEWAY, &e),
    }
}

pub async fn deezer_connect(r: Req) -> Response {
    let code = match body_session_access(&r, true) { Ok(c) => c, Err(e) => return e };
    let raw = text(r.b("url"), 300);
    let result = async {
        let parsed = reqwest::Url::parse(&raw).map_err(|_| "Invalid URL".to_string())?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" { return Err("Adresse invalide.".to_string()); }
        let url = parsed.to_string().trim_end_matches('/').to_string();
        let token = { let t = text(r.b("token"), 500); if !t.is_empty() { t } else { r.app.lock().deezer.as_ref().filter(|d| d.url == url).map(|d| d.token.clone()).unwrap_or_default() } };
        let get = |path: &str| {
            let mut b = r.app.http.get(format!("{url}{path}")).timeout(std::time::Duration::from_secs(6));
            if !token.is_empty() { b = b.header("X-OpenDeezer-Token", &token); }
            b.send()
        };
        let (who, status) = tokio::join!(get("/whoami"), get("/status"));
        let (who, status) = (who.map_err(|_| "fetch failed".to_string())?, status.map_err(|_| "fetch failed".to_string())?);
        if !who.status().is_success() || !status.status().is_success() { return Err("Authentification Deezer refusée.".into()); }
        let account: Value = who.json().await.map_err(|e| e.to_string())?;
        let status: Value = status.json().await.map_err(|e| e.to_string())?;
        Ok((url, token, account, status))
    }.await;
    match result {
        Ok((url, token, account, status)) => {
            deezer::stop_bridge(&r.app);
            {
                let mut s = r.app.lock();
                s.deezer = Some(DeezerConn { url, token, transient: false, arl: String::new(), user_id: String::new() });
                if let Some(session) = s.sessions.get_mut(&code) { session["playbackSource"] = json!("Deezer"); }
                s.preferred_source = Some("Deezer".into());
            }
            r.app.persist();
            r.app.broadcast_all();
            ok(json!({ "connected": true, "account": account, "status": status }))
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, &format!("Connexion refusée : {e}")),
    }
}

pub async fn deezer_disconnect(r: Req) -> Response {
    if let Err(e) = body_session_access(&r, true) { return e; }
    deezer::stop_bridge(&r.app);
    {
        let mut s = r.app.lock();
        s.deezer = None;
        s.saved_deezer_arl.clear();
        if s.preferred_source.as_deref() == Some("Deezer") { s.preferred_source = None; }
        for session in s.sessions.values_mut() {
            if str_of(session, "playbackSource") == "Deezer" { session["playbackSource"] = Value::Null; }
            reset_session(session);
        }
    }
    r.app.persist();
    r.app.broadcast_all();
    ok(json!({ "ok": true }))
}

pub async fn deezer_search(r: Req) -> Response {
    let q = urlencoding::encode(&text_str(r.q("q"), 120)).into_owned();
    match deezer::request(&r.app, &format!("/search?q={q}"), Method::Get, None).await { Ok(v) => ok(v), Err(e) => err(StatusCode::BAD_GATEWAY, &e) }
}

fn unavailable() -> Response { (StatusCode::CONFLICT, Json(json!({ "error": "Ce titre n’est pas disponible en entier sur votre compte Deezer.", "unavailable": true }))).into_response() }

pub async fn deezer_play(r: Req) -> Response {
    let code = match body_session_access(&r, false) { Ok(c) => c, Err(e) => return e };
    let id = urlencoding::encode(&text(r.b("id"), 80)).into_owned();
    match deezer::request(&r.app, &format!("/play/track?id={id}"), Method::Post, None).await {
        Ok(v) => { r.app.lock().deezer_playing_session = Some(code); ok(v) }
        Err(e) if deezer::is_unavailable(&e) => unavailable(),
        Err(e) => err(StatusCode::BAD_GATEWAY, &e),
    }
}

pub async fn deezer_seek(r: Req) -> Response {
    if let Err(e) = body_session_access(&r, false) { return e; }
    let ms = number(r.b("ms")).filter(|f| !f.is_nan()).unwrap_or(0.0).round().max(0.0) as i64;
    match deezer::request(&r.app, &format!("/seek?ms={ms}"), Method::Post, None).await { Ok(v) => ok(v), Err(e) => err(StatusCode::BAD_GATEWAY, &e) }
}

pub async fn deezer_preload(r: Req) -> Response {
    if let Err(e) = body_session_access(&r, false) { return e; }
    let id = urlencoding::encode(&text(r.b("id"), 80)).into_owned();
    match deezer::request(&r.app, &format!("/preload/track?id={id}"), Method::Post, None).await {
        Ok(v) => ok(v),
        Err(e) if deezer::is_unavailable(&e) => unavailable(),
        Err(e) => err(StatusCode::BAD_GATEWAY, &e),
    }
}

pub async fn deezer_transport(r: Req) -> Response {
    if let Err(e) = body_session_access(&r, false) { return e; }
    let action = r.b("action").and_then(Value::as_str).filter(|a| ["playpause", "stop", "resume", "pause"].contains(a)).unwrap_or("playpause").to_string();
    let result = async {
        // Reprise en un seul aller-retour : si le moteur a encore ce titre en pause, il repart ; sinon la page le relance.
        if action == "resume" {
            let status = deezer::request(&r.app, "/status", Method::Get, None).await?;
            let same = text(status.pointer("/track/id"), usize::MAX) == text(r.b("id"), usize::MAX);
            let state = status.get("state").and_then(Value::as_str).unwrap_or("").to_lowercase();
            if same && state == "paused" { deezer::request(&r.app, "/resume", Method::Post, None).await?; }
            return Ok(json!({ "resumed": same && (state == "paused" || state == "playing"), "status": status }));
        }
        deezer::request(&r.app, &format!("/{action}"), Method::Post, None).await
    }.await;
    match result { Ok(v) => ok(v), Err(e) => err(StatusCode::BAD_GATEWAY, &e) }
}

// ───── Préférences de l’ordinateur hôte et son ─────
pub async fn local_host_get(r: Req) -> Response {
    if !r.is_direct_local() { return err(StatusCode::NOT_FOUND, "Introuvable."); }
    let s = r.app.lock();
    let code = s.host_prefs.get("sessionCode").and_then(Value::as_str).unwrap_or("");
    let session = s.sessions.get(code).map(|session| json!({ "code": session.get("code"), "hostToken": session.get("hostToken") })).unwrap_or(Value::Null);
    ok(json!({ "appearance": s.host_prefs.get("appearance").cloned().unwrap_or(Value::Null), "lang": s.host_prefs.get("lang").cloned().unwrap_or(Value::Null), "session": session }))
}

pub async fn local_host_put(r: Req) -> Response {
    if !r.is_direct_local() { return err(StatusCode::NOT_FOUND, "Introuvable."); }
    let mut s = r.app.lock();
    if let Some(appearance) = r.b("appearance") {
        if !appearance.is_null() && (!appearance.is_object() || appearance.to_string().len() > 20000) { return err(StatusCode::BAD_REQUEST, "Style illisible."); }
        s.host_prefs["appearance"] = appearance.clone();
    }
    // Langue de l’interface choisie par l’hôte (la page peut changer d’adresse, donc de stockage, d’un lancement à l’autre).
    if let Some(lang) = r.b("lang").and_then(Value::as_str).filter(|l| *l == "fr" || *l == "en") { s.host_prefs["lang"] = json!(lang); }
    if let Some(wanted) = r.b("sessionCode") {
        // Une session n’est retenue qu’avec sa clé d’hôte ; null l’oublie.
        if wanted.is_null() { s.host_prefs["sessionCode"] = Value::Null; } else {
            let code = text(Some(wanted), 20);
            let token = r.b("hostToken").and_then(Value::as_str).unwrap_or("");
            match s.sessions.get(&code) {
                Some(session) if token == str_of(session, "hostToken") => { s.host_prefs["sessionCode"] = json!(code); }
                _ => return err(StatusCode::FORBIDDEN, "Session inconnue."),
            }
        }
    }
    drop(s);
    r.app.persist();
    ok(json!({ "ok": true }))
}

fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() { return meta.len(); }
    std::fs::read_dir(path).map(|entries| entries.flatten().map(|e| dir_size(&e.path())).sum()).unwrap_or(0)
}

/// Ferme toutes les sessions de cet ordinateur : la musique s’arrête et les invités voient la fin de session.
async fn close_all_sessions(app: &Shared, reason: &str) {
    let codes: Vec<String> = app.lock().sessions.keys().cloned().collect();
    for code in &codes { deezer::stop_session_music(app, code, reason).await; }
    {
        let mut s = app.lock();
        for code in &codes {
            if let Some(list) = s.clients.remove(code) {
                for client in list { let _ = client.tx.send(axum::extract::ws::Message::Close(Some(axum::extract::ws::CloseFrame { code: 4004, reason: "Session fermée".into() }))); }
            }
            s.sessions.shift_remove(code);
        }
        if s.host_prefs.get("sessionCode").is_some() { s.host_prefs["sessionCode"] = Value::Null; }
    }
    app.persist();
}

/// « Vider le cache » (Réglages, sur cet ordinateur seulement) : la session en cours est fermée (les invités voient la fin
/// de session), puis le cache du navigateur de la fenêtre, les fichiers compressés gardés en mémoire et les restes de
/// l’ancienne version Electron sont effacés, et Sono se ferme pour repartir vraiment de zéro. Le compte Deezer est gardé.
pub async fn local_cache_clear(r: Req) -> Response {
    if !r.is_direct_local() { return err(StatusCode::NOT_FOUND, "Introuvable."); }
    close_all_sessions(&r.app, "Musique coupée : cache vidé").await;
    r.app.packed.lock().unwrap().clear();
    let data = r.app.data_dir.clone();
    let callback = r.app.clear_cache.lock().unwrap().clone();
    let freed = tokio::task::spawn_blocking(move || {
        let mut freed = 0u64;
        // Tout ce que l’ancienne version (Electron) laissait dans le dossier de données, sauf ce que Sono utilise encore.
        if let Ok(entries) = std::fs::read_dir(&data) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if ["sessions.json", "sessions.json.tmp"].contains(&name.as_str()) { continue; }
                let size = dir_size(&entry.path());
                let removed = if entry.path().is_dir() { std::fs::remove_dir_all(entry.path()) } else { std::fs::remove_file(entry.path()) };
                if removed.is_ok() { freed += size; }
            }
        }
        freed + callback.map(|clear| clear()).unwrap_or(0)
    }).await.unwrap_or(0);
    // La réponse part d’abord, puis Sono se ferme.
    if let Some(quit) = r.app.quit_app.lock().unwrap().clone() {
        tokio::spawn(async move { tokio::time::sleep(std::time::Duration::from_millis(1500)).await; quit(); });
    }
    ok(json!({ "ok": true, "freed": freed }))
}

pub async fn sound_get(r: Req) -> Response {
    let code = text_str(r.q("code"), 20);
    let s = r.app.lock();
    let Some(session) = s.sessions.get(&code) else { return not_found() };
    if !is_owner(&r, session) { return forbidden_host(); }
    ok(json!({ "sound": sound_json(&s.sound), "engine": s.deezer.is_some() }))
}

pub async fn sound_put(r: Req) -> Response {
    let code = text(r.b("code"), 20);
    {
        let mut s = r.app.lock();
        let Some(session) = s.sessions.get(&code) else { return not_found() };
        if !is_owner(&r, session) { return forbidden_host(); }
        s.sound = clean_sound(r.b("sound"));
    }
    r.app.persist();
    let engine = r.app.lock().deezer.is_some();
    if engine { let _ = deezer::apply_sound(&r.app).await; }
    let s = r.app.lock();
    ok(json!({ "sound": sound_json(&s.sound), "engine": s.deezer.is_some() }))
}
