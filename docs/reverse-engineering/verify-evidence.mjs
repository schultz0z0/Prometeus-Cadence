import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('./', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shots = JSON.parse(await readFile(path.join(root, 'screenshots/manifest.json'), 'utf8'));
if (shots.length !== 18) throw new Error('Expected exactly 18 supplied screenshots');
const shotHashes = [];
for (const shot of shots) {
  const original = await readFile(shot.source);
  const copy = await readFile(path.join(root, 'screenshots', shot.destination));
  if (digest(original) !== digest(copy)) throw new Error(`Screenshot mismatch: ${shot.id}`);
  shotHashes.push({ id: shot.id, file: shot.destination, sha256: digest(copy) });
}
await writeFile(path.join(root, 'screenshots/hashes.json'), JSON.stringify(shotHashes, null, 2) + '\n');

const clientDir = path.join(root, 'artifacts/client');
const clientFiles = (await readdir(clientDir)).sort();
const clientHashes = [];
for (const file of clientFiles) {
  const bytes = await readFile(path.join(clientDir, file));
  clientHashes.push({ file, bytes: bytes.length, sha256: digest(bytes), source: `https://app.cadenceflow.pro/_next/static/chunks/${file}` });
}
if (clientHashes.filter((file) => file.file.endsWith('.js')).length !== 29) throw new Error('Expected 29 JavaScript artifacts');
await writeFile(path.join(root, 'artifacts/client-manifest.json'), JSON.stringify(clientHashes, null, 2) + '\n');

const login = JSON.parse(await readFile(path.join(root, 'evidence/rea-public-login.json'), 'utf8'));
const summary = JSON.parse(await readFile(path.join(root, 'evidence/rea-client-summary.json'), 'utf8'));
if (summary.normalized_result.summary.statistics.parsed_javascript_files !== 29) throw new Error('REA summary mismatch');
if (login.normalized_result.steps.at(-1).after_url.url !== 'https://app.cadenceflow.pro/login') throw new Error('Unexpected REA public final URL');
const bundleBytes = await readFile(path.join(root, 'evidence/rea-evidence-bundle.json'));
const bundle = JSON.parse(bundleBytes.toString('utf8'));
console.log(JSON.stringify({ screenshotsVerified: shotHashes.length, clientArtifacts: clientHashes.length, javascriptArtifacts: 29, publicEvidenceId: login.evidence_id, staticParentEvidenceId: summary.normalized_result.parent_evidence_id, bundleBytes: bundleBytes.length, bundleSha256: digest(bundleBytes), bundleRootKeys: Object.keys(bundle) }, null, 2));
