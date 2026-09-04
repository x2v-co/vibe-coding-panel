import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function readCookie(cookieHeader, name) {
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return '';
}

export function isLoopbackRequest(req) {
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return false;
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export class PairingStore {
  constructor({ filePath, codeTtlMs = 10 * 60 * 1000, now = Date.now, random = randomBytes }) {
    this.filePath = filePath;
    this.codeTtlMs = codeTtlMs;
    this.now = now;
    this.random = random;
    this.codes = new Map();
    this.devices = [];
  }

  async init() {
    try {
      const payload = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.devices = Array.isArray(payload.devices) ? payload.devices : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  createCode() {
    const raw = Array.from(this.random(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const expiresAt = this.now() + this.codeTtlMs;
    this.codes.set(normalizeCode(code), { expiresAt });
    this.pruneCodes();
    return { code, expiresAt };
  }

  async exchange(code, metadata = {}) {
    this.pruneCodes();
    const normalized = normalizeCode(code);
    const pending = this.codes.get(normalized);
    if (!pending || pending.expiresAt <= this.now()) throw new Error('配对码无效或已过期');
    this.codes.delete(normalized);

    const token = this.random(32).toString('base64url');
    const device = {
      id: randomUUID(),
      name: String(metadata.name || 'Mobile browser').trim().slice(0, 80) || 'Mobile browser',
      userAgent: String(metadata.userAgent || '').slice(0, 240),
      tokenHash: hashToken(token),
      createdAt: this.now(),
      lastSeenAt: this.now(),
    };
    this.devices.push(device);
    await this.persist();
    return { token, device: this.toPublicDevice(device) };
  }

  async authenticate(token) {
    if (!token) return null;
    const candidate = hashToken(token);
    const device = this.devices.find((item) => safeEqual(item.tokenHash, candidate));
    if (!device) return null;
    const previous = device.lastSeenAt;
    device.lastSeenAt = this.now();
    if (!previous || device.lastSeenAt - previous > 60_000) await this.persist();
    return this.toPublicDevice(device);
  }

  listDevices() {
    return this.devices.map((device) => this.toPublicDevice(device));
  }

  async revoke(deviceId) {
    const previousLength = this.devices.length;
    this.devices = this.devices.filter((device) => device.id !== deviceId);
    if (this.devices.length === previousLength) return false;
    await this.persist();
    return true;
  }

  pruneCodes() {
    const now = this.now();
    for (const [code, pending] of this.codes) {
      if (pending.expiresAt <= now) this.codes.delete(code);
    }
  }

  toPublicDevice(device) {
    const { tokenHash: _tokenHash, ...safeDevice } = device;
    return safeDevice;
  }

  async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify({ devices: this.devices }, null, 2)}\n`, { mode: 0o600 });
  }
}
