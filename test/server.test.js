import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

test('votes validate, deduplicate concurrent requests, persist, and keep data private', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'poll-test-'));
  let server;
  const start = async () => {
    server = await createApp({ dataDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  try {
    let base = await start();
    let result = await fetch(`${base}/api/results`);
    assert.equal((await result.json()).total, 0);
    const session = await fetch(`${base}/api/session`);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await session.json()).voted, false);
    const post = (choice, token = cookie) => fetch(`${base}/api/vote`, { method: 'POST', headers: { cookie: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    assert.equal((await post('energy', '')).status, 403);
    assert.equal((await post('invalid')).status, 400);
    const replies = await Promise.all(Array.from({ length: 12 }, () => post('energy')));
    assert.equal(replies.filter(r => r.status === 201).length, 1);
    assert.equal(replies.filter(r => r.status === 409).length, 11);
    const other = await fetch(`${base}/api/session`);
    assert.equal((await post('water', other.headers.get('set-cookie').split(';')[0])).status, 201);
    assert.equal((await fetch(`${base}/data/votes.json`)).status, 404);
    for (const page of ['/vote', '/results', '/styles.css', '/app.js', '/config_en.json', '/config_ar.json', '/logo.jpg']) assert.equal((await fetch(base + page)).status, 200);
    const en = await (await fetch(`${base}/config_en.json`)).json();
    const ar = await (await fetch(`${base}/config_ar.json`)).json();
    const ids = choices => choices.map(choice => choice.id).sort();
    assert.deepEqual(ids(ar.choices), ids(en.choices));
    assert.ok(ids(en.choices).includes('energy'));
    assert.ok(en.choices.every(choice => choice.title && choice.description));
    assert.ok(ar.choices.every(choice => choice.title && choice.description));
    await stop(); base = await start();
    result = await (await fetch(`${base}/api/results`)).json();
    assert.equal(result.total, 2); assert.equal(result.counts.energy, 1); assert.equal(result.counts.water, 1);
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).voted, true);
    assert.equal((await post('food')).status, 409);
  } finally { if (server?.listening) await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('corrupt stored data fails closed', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'poll-test-'));
  try { await writeFile(path.join(dataDir, 'votes.json'), '{bad'); await assert.rejects(createApp({ dataDir })); }
  finally { await rm(dataDir, { recursive: true, force: true }); }
});
