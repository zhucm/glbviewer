import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, get } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGlbPreviewMiddleware } from './glb-preview-server.js';

test('directory listing only exposes GLB files and serves listed files without modifying them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'glbviewer-preview-'));
  await mkdir(join(root, 'nested'));
  const binary = Buffer.from('glTF-test-model');
  await writeFile(join(root, 'a.glb'), binary);
  await writeFile(join(root, 'nested', 'B.GLB'), binary);
  await writeFile(join(root, 'private.txt'), 'not a model');
  const middleware = createGlbPreviewMiddleware();
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/__glb-preview/list?directory=${encodeURIComponent(root)}`);
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.deepEqual(listing.entries.map((entry) => entry.path).sort(), ['a.glb', 'nested/B.GLB']);
    for (const entry of listing.entries) {
      const model = await fetch(base + entry.url);
      assert.equal(model.status, 200);
      assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
      assert.deepEqual(Buffer.from(await model.arrayBuffer()), binary);
    }
    assert.equal((await fetch(`${base}/__glb-preview/file?id=unknown`)).status, 404);
    assert.equal((await fetch(`${base}/__glb-preview/file?path=${encodeURIComponent(join(root, 'private.txt'))}`)).status, 404);
    assert.equal((await fetch(`${base}/__glb-preview/list?directory=relative`)).status, 400);
    assert.equal((await fetch(`${base}/__glb-preview/list?directory=${encodeURIComponent(join(root, 'missing'))}`)).status, 400);
    assert.equal((await fetch(`${base}/__glb-preview/list`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/__glb-preview/list`, { headers: { Origin: 'https://example.com' } })).status, 403);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      get(`${base}/__glb-preview/list`, { headers: { Host: 'example.com' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
