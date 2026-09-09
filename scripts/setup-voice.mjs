// Optional local install. No global Python, pip, shell installer, or admin access.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { speechHome } from '../server/managed-speech.js';

const uvVersion = '0.12.11';
const targets = {
  'darwin-arm64': ['aarch64-apple-darwin', 'e01b69ee15e81918d5e8fc9cf39b3db7f59c5576e5e306cd9b7aeb2c7b7321c3'],
  'darwin-x64': ['x86_64-apple-darwin', '96d773bf5fda4f9b08c4444847f9183d1c14bc8a28ff9c0490e261a8fc6e5309'],
  'linux-x64': ['x86_64-unknown-linux-gnu', '4ae93e0f148a18434cc094072547cec88912fc4a72b984183c7d0d0e9586cb5e'],
  'win32-x64': ['x86_64-pc-windows-msvc', 'e94225dea91e051472847bd6d146d7d66c4f54ffcd1f106678866a99580845f9'],
};
const win = process.platform === 'win32';
const home = speechHome();
const lock = path.join(home, 'setup.lock');
let lockHeld = false, install;
let activeChild;
const cancellation = new AbortController();
function stopChild(child) {
  if (!child?.pid) return;
  if (win) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}
const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(home, 'python'), UV_CACHE_DIR: path.join(home, 'cache'), UV_NO_PROGRESS: '1' };
for (const key of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete env[key];

function run(command, args, { capture = false, timeoutMs = 25 * 60 * 1000 } = {}) {
  cancellation.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: !win, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    activeChild = child;
    let output = '', expired = false;
    const timer = setTimeout(() => { expired = true; stopChild(child); }, timeoutMs);
    child.stdout?.on('data', chunk => { output = (output + chunk).slice(-16384); });
    child.once('error', error => { clearTimeout(timer); activeChild = null; reject(error); });
    child.once('close', code => { clearTimeout(timer); activeChild = null;
      if (code !== 0 || expired) reject(new Error(expired ? '下载或安装超时，请检查网络后重试。' : '安装命令未成功，请检查上方提示后重试。'));
      else resolve(output.trim());
    });
  });
}

async function acquireLock() {
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = Number(await readFile(path.join(lock, 'pid'), 'utf8')); } catch {}
    if (!Number.isSafeInteger(owner) || owner < 1) throw new Error(`安装锁无法验证；确认没有其他安装进程后删除 ${lock} 再试。`);
    try { process.kill(owner, 0); throw new Error('另一个语音安装正在运行，请等待它完成。'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await rm(lock, { recursive: true });
    await mkdir(lock);
  }
  lockHeld = true;
  await writeFile(path.join(lock, 'pid'), String(process.pid));
}

async function main() {
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw new Error('此平台尚不支持自动语音安装。仍可使用文字输入或手动配置 Whisper。');
  await mkdir(home, { recursive: true });
  await acquireLock();
  install = path.join(home, 'environments', randomUUID());
  await mkdir(install, { recursive: true });
  console.log('安装本机语音：将下载 Python、Whisper、ffmpeg 和 small 模型，可能需要数分钟及约 3 GB 空间。');
  console.log('仅写入用户语音目录，不修改系统 Python。失败仍可使用文字输入。');
  const archiveName = `uv-${target[0]}.${win ? 'zip' : 'tar.gz'}`;
  const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${uvVersion}/${archiveName}`, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(180000)]) });
  if (!response.ok) throw new Error(`下载工具失败（HTTP ${response.status}），请检查 GitHub 网络连接。`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== target[1]) throw new Error('下载工具校验失败，未执行。请重新运行安装。');
  const archive = path.join(install, archiveName);
  await writeFile(archive, bytes);
  await run('tar', ['-xf', archive, '-C', install], { timeoutMs: 60000 });
  const uv = path.join(install, win ? 'uv.exe' : `uv-${target[0]}/uv`);
  await chmod(uv, 0o755);
  const venv = path.join(install, 'venv');
  await run(uv, ['venv', '--python', '3.11', '--managed-python', venv]);
  const python = path.join(venv, win ? 'Scripts/python.exe' : 'bin/python');
  console.log('安装 Whisper 与音频依赖…');
  // CPU wheels avoid downloading CUDA. 2.2.2 is the final Intel macOS torch release.
  await run(uv, ['pip', 'install', '--python', python, 'torch==2.2.2', ...(process.platform === 'darwin' ? [] : ['--index-url', 'https://download.pytorch.org/whl/cpu'])]);
  await run(uv, ['pip', 'install', '--python', python, 'openai-whisper==20250625', 'torch==2.2.2', 'numpy==1.26.4', 'numba==0.61.2', 'imageio-ffmpeg==0.6.0']);
  const modelDir = path.join(home, 'models');
  await mkdir(modelDir, { recursive: true });
  console.log('下载并校验 small 模型，然后验证模型加载及 ffmpeg…');
  const ffmpeg = await run(python, ['-c', 'import whisper,imageio_ffmpeg,sys; whisper.load_model("small",device="cpu",download_root=sys.argv[1]); print(imageio_ffmpeg.get_ffmpeg_exe())', modelDir], { capture: true });
  await run(ffmpeg, ['-version'], { capture: true, timeoutMs: 15000 });
  const whisper = path.join(venv, win ? 'Scripts/whisper.exe' : 'bin/whisper');
  await run(whisper, ['--help'], { capture: true, timeoutMs: 30000 });
  const config = { schema: 1, platform: process.platform, arch: process.arch, python, whisper, ffmpeg, modelDir, uvVersion, installedAt: new Date().toISOString() };
  const staged = path.join(home, `current-${randomUUID()}.json`);
  cancellation.signal.throwIfAborted();
  await writeFile(staged, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(staged, path.join(home, 'current.json'));
  install = null; // Published environment must remain at its original venv path.
  console.log('语音安装完成。关闭并重新打开 Vibe Panel Connector 后即可使用；原有手动语音配置优先。');
}

// Let the child stop before cleanup; never remove an active or published env.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancellation.abort(new Error('安装已取消。')); stopChild(activeChild); process.exitCode = 1; });
try { await main(); }
catch (error) { console.error(`语音安装失败：${error.message}\n可以重新运行安装，或先继续使用文字输入。`); process.exitCode = 1; }
finally {
  if (install) await rm(install, { recursive: true, force: true });
  if (lockHeld) await rm(lock, { recursive: true, force: true });
}
