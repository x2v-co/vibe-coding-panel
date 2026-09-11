// Package the already-built Relay with only its runtime dependency closure.
// No installation/network access; the source node_modules must come from npm ci.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.');
const output = path.resolve(process.argv[3] || 'relay-runtime');
if (existsSync(output)) throw new Error('Output must be a new directory');
await mkdir(output, { recursive: true });
const seen = new Set(), dependencies = {};
async function collect(name, parent) {
  const require = createRequire(path.join(parent, 'package.json'));
  const directory = require.resolve.paths(name).map(base => path.join(base, name)).find(candidate => existsSync(path.join(candidate, 'package.json')));
  if (!directory) throw new Error(`Cannot locate ${name}`);
  const relative = path.relative(root, directory);
  if (!relative.startsWith(`node_modules${path.sep}`)) throw new Error(`Dependency outside locked node_modules: ${name}`);
  if (seen.has(directory)) return;
  seen.add(directory);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  dependencies[relative] = pkg.version;
  await cp(directory, path.join(output, relative), { recursive: true });
  for (const child of Object.keys(pkg.dependencies || {})) await collect(child, directory);
}
await collect('express', root);
await collect('ws', root);
for (const file of ['server', 'dist', 'package.json', 'package-lock.json', 'LICENSE']) {
  if (!existsSync(path.join(root, file)) && file === 'LICENSE') continue;
  await cp(path.join(root, file), path.join(output, file), { recursive: true, filter: source => !source.endsWith('.test.js') && !source.includes(`${path.sep}fixtures`) });
}
await writeFile(path.join(output, 'runtime-dependencies.json'), JSON.stringify(dependencies, null, 2));
console.log(`Packaged ${seen.size} locked runtime dependencies`);
