// Connexions en temps réel (/ws?session=CODE) : arrivées, prénom, validation, départ, absence de l’hôte.
use super::deezer;
use super::logic::*;
use super::state::{send_one, Client, Meta, Shared};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::Ordering;

pub fn via_tunnel(headers: &HeaderMap) -> bool { headers.contains_key("cf-ray") || headers.contains_key("cf-connecting-ip") }

pub async fn upgrade(State(app): State<Shared>, Query(q): Query<HashMap<String, String>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let code = q.get("session").map(|c| c.to_uppercase()).unwrap_or_default();
    let tunnel = via_tunnel(&headers);
    {
        let s = app.lock();
        if !s.sessions.contains_key(&code) || (!s.public_link_enabled && tunnel) { return StatusCode::BAD_REQUEST.into_response(); }
    }
    ws.on_upgrade(move |socket| connection(app, socket, code, tunnel))
}

async fn connection(app: Shared, socket: WebSocket, code: String, tunnel: bool) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    let id = app.next_client.fetch_add(1, Ordering::SeqCst);
    {
        let mut s = app.lock();
        let meta = Meta { client_id: uuid::Uuid::new_v4().to_string(), name: String::new(), host: false, since: now_iso(), greeted: false, via_tunnel: tunnel, last_sent: String::new() };
        s.clients.entry(code.clone()).or_default().push(Client { id, tx, meta });
        send_one(&mut s, &code, id);
    }
    app.broadcast(&code);
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let closing = matches!(message, Message::Close(_));
            if sink.send(message).await.is_err() || closing { break; }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let Message::Text(raw) = message else { if matches!(message, Message::Close(_)) { break; } continue };
        let Ok(message) = serde_json::from_str::<Value>(raw.as_str()) else { continue };
        match message.get("type").and_then(Value::as_str) {
            Some("leave") => { mark_guest_left(&app, &code, id); break; }
            Some("hello") => hello(&app, &code, id, &message),
            _ => {}
        }
    }
    writer.abort();
    closed(&app, &code, id);
}

fn hello(app: &Shared, code: &str, id: u64, message: &Value) {
    let mut s = app.lock();
    let Some(slot) = s.sessions.get_mut(code) else { return };
    let mut session = std::mem::take(slot);
    let client_id = { let c = text(message.get("clientId"), 64); c };
    let owner = matches!(host_access(&session, &text(message.get("hostToken"), 80)), Some(Access::Owner));
    let name: String;
    {
        let Some(client) = s.clients.get_mut(code).and_then(|l| l.iter_mut().find(|c| c.id == id)) else { *s.sessions.get_mut(code).unwrap() = session; return };
        if !client_id.is_empty() { client.meta.client_id = client_id; }
        client.meta.host = owner;
        client.meta.greeted = true;
        if owner { client.meta.name.clear(); }
    }
    let meta_client = s.clients.get(code).and_then(|l| l.iter().find(|c| c.id == id)).map(|c| c.meta.client_id.clone()).unwrap_or_default();
    if !session.get("knownGuests").map(|k| k.is_array()).unwrap_or(false) { session["knownGuests"] = json!([]); }
    if !session.get("members").map(|k| k.is_object()).unwrap_or(false) { session["members"] = json!({}); }
    let mut persist = false;
    if !owner {
        let member = session["members"].get(&meta_client).cloned();
        // Le prénom est choisi une seule fois par appareil et ne change plus pendant la session.
        let existing = member.as_ref().map(|m| str_of(m, "name").to_string()).unwrap_or_default();
        name = if existing.is_empty() { text(message.get("name"), 30) } else { existing.clone() };
        if !name.is_empty() {
            let now = now_iso();
            if existing.is_empty() {
                let mut m = member.clone().and_then(|m| m.as_object().cloned()).unwrap_or_default();
                let since = m.get("since").and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string).unwrap_or_else(|| now.clone());
                m.insert("name".into(), json!(name));
                m.insert("since".into(), json!(since));
                session["members"][&meta_client] = Value::Object(m);
            }
            let retry = truthy(message.get("retry"));
            let current = session["members"][&meta_client].clone();
            let status = str_of(&current, "status").to_string();
            let set = |key: &str, value: Value, session: &mut Value| { session["members"][&meta_client][key] = value; };
            if status == "removed" {
                if retry {
                    set("status", json!("pending"), &mut session);
                    set("since", json!(now), &mut session);
                    add_activity(&mut session, "user", &format!("{name} demande à revenir"));
                }
            } else if status == "left" {
                set("status", json!("accepted"), &mut session);
                add_activity(&mut session, "user", &format!("{name} est de retour"));
            } else if truthy(session.get("requireApproval")) || truthy(current.get("mustAsk")) {
                if status.is_empty() || (status == "refused" && retry) {
                    set("status", json!("pending"), &mut session);
                    set("since", json!(now), &mut session);
                    add_activity(&mut session, "user", &format!("{name} demande à rejoindre"));
                }
            } else if !session["knownGuests"].as_array().unwrap().contains(&json!(meta_client)) {
                let known = session["knownGuests"].as_array_mut().unwrap();
                known.push(json!(meta_client));
                let excess = known.len().saturating_sub(200);
                known.drain(..excess);
                add_activity(&mut session, "user", &format!("{name} a rejoint la session"));
            }
            persist = true;
        }
        if let Some(client) = s.clients.get_mut(code).and_then(|l| l.iter_mut().find(|c| c.id == id)) { client.meta.name = name.clone(); }
    }
    *s.sessions.get_mut(code).unwrap() = session;
    drop(s);
    if persist { app.persist(); }
    app.broadcast(code);
}

/// « Quitter la session » : l’invité sort de la liste et pourra revenir librement.
fn mark_guest_left(app: &Shared, code: &str, id: u64) {
    let mut s = app.lock();
    let Some(meta) = s.clients.get(code).and_then(|l| l.iter().find(|c| c.id == id)).map(|c| c.meta.clone()) else { return };
    let Some(session) = s.sessions.get_mut(code) else { return };
    let viewer = Viewer { host: false, client_id: meta.client_id.clone() };
    let name = session.get("members").and_then(|m| m.get(&meta.client_id)).map(|m| str_of(m, "name").to_string()).unwrap_or_default();
    if meta.host || name.is_empty() || admission_of(session, &viewer) != "accepted" { return; }
    session["members"][&meta.client_id]["status"] = json!("left");
    add_activity(session, "user", &format!("{name} a quitté la session"));
    drop(s);
    app.persist();
    app.broadcast(code);
}

fn closed(app: &Shared, code: &str, id: u64) {
    let meta = {
        let mut s = app.lock();
        let Some(list) = s.clients.get_mut(code) else { return };
        let Some(position) = list.iter().position(|c| c.id == id) else { return };
        list.remove(position).meta
    };
    app.broadcast(code);
    let grace = app.host_grace;
    if meta.host {
        let app = app.clone();
        let code = code.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(grace).await;
            if app.lock().sessions.contains_key(&code) { review_host_absence(&app, &code).await; }
        });
    }
}

/// Plus personne côté hôte : sans retour rapide (rechargement), la musique s’arrête, sauf si un admin est là pour garder la soirée en route.
async fn review_host_absence(app: &Shared, code: &str) {
    let admin_ready = {
        let mut s = app.lock();
        let online: Vec<Meta> = s.clients.get(code).map(|l| l.iter().map(|c| c.meta.clone()).collect()).unwrap_or_default();
        if online.iter().any(|m| m.host) { return; }
        let Some(session) = s.sessions.get_mut(code) else { return };
        let ready = online.iter().any(|m| m.greeted && !m.host && session.get("members").and_then(|ms| ms.get(&m.client_id)).map(|mm| truthy(mm.get("admin"))).unwrap_or(false));
        if ready {
            let already = session.pointer("/activity/0/text").and_then(Value::as_str).map(|t| t.contains("s’est absenté")).unwrap_or(false);
            if !already { add_activity(session, "user", "L’hôte s’est absenté : les admins gardent les commandes"); }
            if already { return; }
        }
        ready
    };
    if admin_ready { app.persist(); app.broadcast(code); }
    else { deezer::stop_session_music(app, code, "Musique coupée : l’hôte a quitté la session").await; }
}
