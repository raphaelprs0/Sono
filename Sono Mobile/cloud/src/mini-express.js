// Le strict nécessaire d’Express et de ws pour garder telles quelles les routes du serveur de Sono.
class Res {
  statusCode = 200;
  headers = new Headers();
  body = null;
  status(code) { this.statusCode = code; return this; }
  set(name, value) { this.headers.set(name, value); return this; }
  type(kind) { this.headers.set('Content-Type', kind === 'html' ? 'text/html; charset=utf-8' : kind); return this; }
  json(value) { this.headers.set('Content-Type', 'application/json; charset=utf-8'); this.body = JSON.stringify(value); return this; }
  send(value) { this.body = value; return this; }
  end() { return this; }
}
export class MiniApp {
  routes = [];
  add(method, path, handler) {
    const names = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}/?$`);
    this.routes.push({ method, pattern, names, handler });
  }
  get(path, handler) { this.add('GET', path, handler); }
  post(path, handler) { this.add('POST', path, handler); }
  put(path, handler) { this.add('PUT', path, handler); }
  patch(path, handler) { this.add('PATCH', path, handler); }
  delete(path, handler) { this.add('DELETE', path, handler); }
  async handle(request) {
    const url = new URL(request.url);
    const res = new Res();
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const raw = request.method === 'GET' ? '' : await request.text();
      if (raw.length > 4_000_000) return Response.json({ error: 'Demande trop volumineuse.' }, { status: 413 });
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return Response.json({ error: 'Demande illisible.' }, { status: 400 }); }
      const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      const req = { method: request.method, path: url.pathname, params, body, query: Object.fromEntries(url.searchParams), get: (name) => request.headers.get(name) || undefined };
      try { await route.handler(req, res); }
      catch { return Response.json({ error: 'Le service Sono a rencontré un problème.' }, { status: 500 }); }
      return new Response(res.body, { status: res.statusCode, headers: res.headers });
    }
    return Response.json({ error: 'Introuvable.' }, { status: 404 });
  }
}
export class SocketAdapter {
  sono = null;
  constructor(socket) { this.socket = socket; }
  get readyState() { return this.socket.readyState; }
  send(data) { try { this.socket.send(data); } catch { /* déjà fermée */ } }
  close(code, reason) { try { this.socket.close(code, reason); } catch { /* déjà fermée */ } }
  on(event, handler) { this.socket.addEventListener(event, (message) => handler(event === 'message' ? message.data : message)); }
}
