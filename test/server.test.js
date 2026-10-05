import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    assert.equal((await post('safe_pathways', '')).status, 403);
    assert.equal((await post('invalid')).status, 400);
    const replies = await Promise.all(Array.from({ length: 12 }, () => post('safe_pathways')));
    assert.equal(replies.filter(r => r.status === 201).length, 1);
    assert.equal(replies.filter(r => r.status === 409).length, 11);
    const other = await fetch(`${base}/api/session`);
    assert.equal((await post('environment', other.headers.get('set-cookie').split(';')[0])).status, 201);
    assert.equal((await fetch(`${base}/data/votes.json`)).status, 404);
    for (const page of ['/vote', '/feedback', '/results', '/styles.css', '/app.js', '/config_en.json', '/config_ar.json', '/logo.jpg', '/qr-code.png']) assert.equal((await fetch(base + page)).status, 200);
    const en = await (await fetch(`${base}/config_en.json`)).json();
    const ar = await (await fetch(`${base}/config_ar.json`)).json();
    const ids = choices => choices.map(choice => choice.id).sort();
    assert.deepEqual(ids(ar.choices), ids(en.choices));
    assert.deepEqual(en.choices.map(choice => choice.id), ['safe_pathways', 'environment', 'safety', 'landscaping', 'smart_technologies', 'accessible_pathways']);
    assert.deepEqual(en.choices.map(choice => choice.title), ['Safe Pathways', 'Environment', 'Safety', 'Landscaping', 'Smart Technologies', 'Accessible Pathways for People with Disabilities']);
    assert.deepEqual(ar.choices.map(choice => choice.title), ['ممرات آمنة', 'البيئة', 'السلامة', 'التشجير', 'التقنيات الذكية', 'ممرات لذوي الإعاقة']);
    assert.equal(en.commentLink, 'Add a comment');
    assert.equal(ar.commentLink, 'اضف ملاحظة');
    const client = await (await fetch(`${base}/app.js`)).text();
    assert.equal((client.match(/textLink\('\/feedback', 'commentLink'\)/g) || []).length, 2);
    assert.ok(en.choices.every(choice => choice.title && typeof choice.description === 'string'));
    assert.ok(ar.choices.every(choice => choice.title && typeof choice.description === 'string'));
    await stop(); base = await start();
    result = await (await fetch(`${base}/api/results`)).json();
    assert.equal(result.total, 2); assert.equal(result.counts.safe_pathways, 1); assert.equal(result.counts.environment, 1);
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).voted, true);
    assert.equal((await post('safety')).status, 409);
  } finally { if (server?.listening) await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('feedback is appended privately to data/feedbacks.csv', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'poll-test-'));
  let server;
  const start = async () => {
    server = await createApp({ dataDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  const cookieOf = async base => (await fetch(`${base}/api/session`)).headers.get('set-cookie').split(';')[0];
  const post = (base, body, token, headers = {}) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { cookie: token, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    let base = await start();
    const cookie = await cookieOf(base);
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).feedback, false);
    assert.equal((await fetch(`${base}/api/feedback`)).status, 405);
    assert.equal((await post(base, { email: 'a@b.co', name: 'A', comment: 'Hi' }, '')).status, 403);
    assert.equal((await post(base, { email: 'a@b.co' }, cookie, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(base, '{', cookie)).status, 400);
    assert.equal((await post(base, { email: 'not-an-email', name: 'A', comment: 'Hi' }, cookie)).status, 400);
    assert.equal((await post(base, { email: 'a@b.co', name: ' ', comment: 'Hi' }, cookie)).status, 400);
    assert.equal((await post(base, { email: 'a@b.co', name: 'A', comment: '' }, cookie)).status, 400);
    assert.equal((await post(base, { email: 'a@b.co', name: 'A', comment: 'Hi' }, cookie, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await fetch(`${base}/data/feedbacks.csv`)).status, 404);
    assert.equal((await fetch(`${base}/feedbacks.csv`)).status, 404);
    assert.equal((await fetch(`${base}/data/feedback-devices.json`)).status, 404);
    const first = await post(base, { email: '  visitor@example.com ', name: ' Doe, Jane ', comment: 'He said "hello"\nممرات آمنة' }, cookie);
    assert.equal(first.status, 201);
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).feedback, true);
    const repeats = await Promise.all(Array.from({ length: 8 }, () => post(base, { email: 'again@example.com', name: 'Again', comment: 'Again' }, cookie)));
    assert.equal(repeats.filter(reply => reply.status === 409).length, 8);
    const other = await cookieOf(base);
    assert.equal((await post(base, { email: 'one@example.com', name: '=1+1', comment: 'First' }, other)).status, 201);
    assert.equal((await post(base, { email: 'one-again@example.com', name: 'One', comment: 'Nope' }, other)).status, 409);
    await stop();
    base = await start();
    assert.equal((await post(base, { email: 'visitor-again@example.com', name: 'Visitor', comment: 'Nope' }, cookie)).status, 409);
    const third = await cookieOf(base);
    assert.equal((await post(base, { email: 'three@example.com', name: 'Three', comment: 'Third' }, third)).status, 201);
    const csv = await readFile(path.join(dataDir, 'feedbacks.csv'), 'utf8');
    assert.match(csv, /^\uFEFFsubmitted_at,email,name,comment\n/);
    assert.match(csv, /"visitor@example.com","Doe, Jane","He said ""hello""\nممرات آمنة"/);
    assert.match(csv, /"one@example.com","'=1\+1","First"/);
    assert.match(csv, /"three@example.com","Three","Third"/);
    assert.doesNotMatch(csv, /again@example.com|one-again@example.com|visitor-again@example.com/);
    assert.equal(csv.trim().split('\n').length, 5);
  } finally { if (server?.listening) await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('corrupt stored data fails closed', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'poll-test-'));
  try {
    await writeFile(path.join(dataDir, 'votes.json'), '{bad');
    await assert.rejects(createApp({ dataDir }));
    await rm(path.join(dataDir, 'votes.json'));
    await writeFile(path.join(dataDir, 'feedback-devices.json'), '{bad');
    await assert.rejects(createApp({ dataDir }));
  }
  finally { await rm(dataDir, { recursive: true, force: true }); }
});
