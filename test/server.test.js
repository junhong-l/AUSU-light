import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApplication } from '../src/server.js';
import { DEFAULTS } from '../src/lighting.js';

async function fixture(context, apply = async () => {}) {
  const calls = [];
  const dataDir = await mkdtemp(path.join(tmpdir(), 'asus-light-test-'));
  const controller = {
    inspect: async () => ({ keyboard: true, slash: true }),
    apply: async (target, settings) => { calls.push({ target, settings }); await apply(); }
  };
  const server = await createApplication({ controller, dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const state = await (await fetch(`${base}/api/state`)).json();
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Control-Token': state.token };
  return { base, headers, calls, dataDir, state };
}

test('startup and status are read-only, and token is fresh', async context => {
  const { calls, state } = await fixture(context);
  assert.deepEqual(calls, []);
  assert.equal(state.token.length, 64);
  assert.equal(state.appliedAt.keyboard, null);
});

test('valid application persists only the selected target', async context => {
  const { base, headers, calls, dataDir } = await fixture(context);
  const settings = { ...DEFAULTS.keyboard, color: '#00aa88' };
  const response = await fetch(`${base}/api/apply/keyboard`, { method: 'POST', headers, body: JSON.stringify(settings) });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ target: 'keyboard', settings }]);
  const saved = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.keyboard, settings);
  assert.deepEqual(saved.slash, DEFAULTS.slash);
});

test('cross-origin and missing-token requests never reach hardware', async context => {
  const { base, headers, calls } = await fixture(context);
  for (const invalid of [{ ...headers, Origin: 'https://example.com' }, { ...headers, 'X-Control-Token': '' }, { 'Content-Type': 'application/json' }]) {
    const response = await fetch(`${base}/api/apply/keyboard`, { method: 'POST', headers: invalid, body: JSON.stringify(DEFAULTS.keyboard) });
    assert.equal(response.status, 403);
  }
  const stateResponse = await fetch(`${base}/api/state`, { headers: { Origin: 'https://example.com' } });
  assert.equal(stateResponse.status, 403);
  assert.deepEqual(calls, []);
});

test('malformed or unsupported settings do not reach hardware', async context => {
  const { base, headers, calls } = await fixture(context);
  for (const body of ['{', JSON.stringify({ ...DEFAULTS.slash, brightness: 4 })]) {
    const response = await fetch(`${base}/api/apply/slash`, { method: 'POST', headers, body });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(calls, []);
});

test('hardware failure is reported and not recorded as applied', async context => {
  const { base, headers } = await fixture(context, async () => { throw new Error('Device disconnected'); });
  const response = await fetch(`${base}/api/apply/slash`, { method: 'POST', headers, body: JSON.stringify(DEFAULTS.slash) });
  assert.equal(response.status, 500);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.appliedAt.slash, null);
  assert.equal(state.events[0].status, 'error');
});

test('static routing does not expose settings or source files', async context => {
  const { base } = await fixture(context);
  for (const url of ['/data/settings.json', '/src/server.js', '/package.json']) {
    assert.equal((await fetch(`${base}${url}`)).status, 404);
  }
});

test('removed audio and music endpoints cannot change lighting or settings', async context => {
  const { base, headers, calls, state, dataDir } = await fixture(context);
  assert.equal(Object.hasOwn(state, 'music'), false);
  assert.equal((await fetch(`${base}/api/music/state`)).status, 404);
  assert.equal((await fetch(`${base}/api/audio/probe`)).status, 404);
  assert.equal((await fetch(`${base}/api/audio/probe`, { method: 'POST', headers, body: '{}' })).status, 404);
  for (const action of ['start', 'stop', 'heartbeat']) {
    const response = await fetch(`${base}/api/music/${action}`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 404);
  }
  assert.deepEqual(calls, []);
  await assert.rejects(readFile(path.join(dataDir, 'settings.json')), { code: 'ENOENT' });
});