import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function choiceIds(name) {
  const config = JSON.parse(readFileSync(path.join(root, 'config', name), 'utf8'));
  if (!Array.isArray(config.choices) || !config.choices.length) throw new Error(`${name} must include choices`);
  const ids = config.choices.map((choice, index) => {
    if (!choice || typeof choice.id !== 'string' || !/^[a-z0-9_-]+$/.test(choice.id) || typeof choice.title !== 'string' || typeof choice.description !== 'string') {
      throw new Error(`${name} choice ${index + 1} needs an id, title, and description`);
    }
    return choice.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error(`${name} choice ids must be unique`);
  return ids;
}

const englishChoices = choiceIds('config_en.json');
const arabicChoices = choiceIds('config_ar.json');
if (englishChoices.length !== arabicChoices.length || englishChoices.some(id => !arabicChoices.includes(id))) {
  throw new Error('config_en.json and config_ar.json must contain the same choice ids');
}
export const choices = englishChoices;

export async function createApp({ dataDir = process.env.DATA_DIR || path.join(root, 'data'), secureCookie = process.env.COOKIE_SECURE === 'true' } = {}) {
  await mkdir(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'votes.json');
  let state;
  try {
    state = JSON.parse(await readFile(filename, 'utf8'));
    if (state.version !== 1 || !state.voters || Array.isArray(state.voters) || typeof state.voters !== 'object' || Object.values(state.voters).some(v => !choices.includes(v))) throw new Error('Invalid vote file; restore from backup.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, voters: {} };
  }
  let queue = Promise.resolve();
  const totals = () => {
    const counts = Object.fromEntries(choices.map(id => [id, 0]));
    for (const id of Object.values(state.voters)) counts[id]++;
    return { counts, total: Object.keys(state.voters).length };
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = /(?:^|;\s*)poll_device=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (url.pathname === '/api/session' && req.method === 'GET') {
        const device = token || randomBytes(32).toString('hex');
        res.setHeader('Set-Cookie', `poll_device=${device}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secureCookie ? '; Secure' : ''}`);
        return json(200, { voted: Boolean(state.voters[device]) });
      }
      if (url.pathname === '/api/results' && req.method === 'GET') return json(200, totals());
      if (url.pathname === '/api/vote' && req.method === 'POST') {
        if (!token) return json(403, { error: 'session_required' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'json_required' });
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'cross_site' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return json(413, { error: 'too_large' }); }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'invalid_json' }); }
        if (!choices.includes(input?.choice)) return json(400, { error: 'invalid_choice' });
        const operation = queue.then(async () => {
          if (state.voters[token]) return json(409, { error: 'already_voted' });
          const next = { version: 1, voters: { ...state.voters, [token]: input.choice } };
          await writeFile(`${filename}.tmp`, JSON.stringify(next), { mode: 0o600 });
          await rename(`${filename}.tmp`, filename);
          state = next;
          json(201, { voted: true });
        });
        queue = operation.catch(() => {});
        await operation;
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'method_not_allowed' });
      if (url.pathname === '/') { res.writeHead(302, { Location: '/vote' }); return res.end(); }
      const files = {
        '/vote': ['public', 'index.html', 'text/html; charset=utf-8'],
        '/results': ['public', 'index.html', 'text/html; charset=utf-8'],
        '/app.js': ['public', 'app.js', 'text/javascript; charset=utf-8'],
        '/styles.css': ['public', 'styles.css', 'text/css; charset=utf-8'],
        '/config_en.json': ['config', 'config_en.json', 'application/json; charset=utf-8'],
        '/config_ar.json': ['config', 'config_ar.json', 'application/json; charset=utf-8'],
        '/logo.jpg': ['public', 'logo.jpg', 'image/jpeg'],
        '/qr-code.png': ['public', 'qr-code.png', 'image/png']
      };
      const file = files[url.pathname];
      if (!file) return json(404, { error: 'not_found' });
      const content = await readFile(path.join(root, file[0], file[1]));
      res.writeHead(200, { 'Content-Type': file[2], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { console.error(error); if (!res.headersSent) json(500, { error: 'server_error' }); else res.end(); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`Poll running on http://localhost:${process.env.PORT || 3000}`));
}
