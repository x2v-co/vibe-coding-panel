// Build a portable Connector from an explicit allowlist; never archive the checkout.
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'release');
const work = await mkdtemp(path.join(tmpdir(), 'vibe-package-'));
const app = path.join(work, 'Vibe-Panel-Connector');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
try {
  await mkdir(app);
  for (const file of ['server', 'scripts/connect.mjs', 'scripts/connect-relay.mjs', 'scripts/launch.mjs', 'dist', 'package.json', 'package-lock.json', 'LICENSE', 'Vibe Panel.command', 'Vibe Panel.sh', 'Vibe Panel.bat']) {
    await cp(path.join(root, file), path.join(app, file), { recursive: true, filter: source => !source.endsWith('.test.js') && !source.includes(`${path.sep}fixtures`) });
  }
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, shell: process.platform === 'win32', stdio: 'inherit' });
  if (npm.status !== 0) throw new Error('Could not install locked runtime dependencies');
  // Use an official, relocatable LTS binary, not a Homebrew or system-linked Node.
  const releases = JSON.parse((await download('https://nodejs.org/dist/index.json')).toString());
  const version = releases.find(release => release.version.startsWith('v24.'))?.version;
  if (!version) throw new Error('Node 24 LTS release not found');
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const name = `node-${version}-${platform}-${process.arch}`;
  const archive = `${name}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const base = `https://nodejs.org/dist/${version}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString();
  const expected = sums.split('\n').find(line => line.trim().endsWith(` ${archive}`))?.split(/\s+/)[0];
  if (!expected) throw new Error('Official Node checksum missing');
  const bytes = await download(`${base}/${archive}`);
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node checksum mismatch');
  const archivePath = path.join(work, archive);
  await writeFile(archivePath, bytes);
  execFileSync('tar', ['-xf', archivePath, '-C', work]);
  await mkdir(path.join(app, 'runtime'));
  const binary = process.platform === 'win32' ? 'node.exe' : 'bin/node';
  const target = path.join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  await cp(path.join(work, name, binary), target);
  await chmod(target, 0o755);
  await cp(path.join(work, name, 'LICENSE'), path.join(app, 'runtime', 'NODE-LICENSE'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await writeFile(path.join(app, 'bundle.json'), JSON.stringify({ version: revision, platform: process.platform, arch: process.arch, node: version, nodeArchiveSHA256: expected }, null, 2));
  await cp(path.join(root, 'docs/portable-connector.md'), path.join(app, 'START-HERE.md'));
  await mkdir(out, { recursive: true });
  const destination = path.join(out, `vibe-connector-${process.platform}-${process.arch}.zip`);
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, 'scripts/zip-connector.py'), app, destination]);
  console.log(destination);
} finally { await rm(work, { recursive: true, force: true }); }
