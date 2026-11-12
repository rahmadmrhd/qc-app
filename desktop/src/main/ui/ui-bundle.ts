// Pengelola bundel UI terunduh (hibrid, spek §3.4): memeriksa manifest bertanda tangan di server,
// mengunduh berkas ke staging, memverifikasi (tanda tangan Ed25519, jalur aman, ukuran, sha256,
// minBridge), lalu memindahkan ATOMIK ke `versions/<uiVersion>`. Bundel baru baru dipakai pada
// peluncuran berikutnya atau `applyReady()` (tidak pernah di tengah inject). Dua kegagalan muat
// berturut-turut mengembalikan ke `previous`, lalu ke UI dasar, dan menandai versi `bad`.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { parseUiManifest, type UiManifest, verifyUiManifest } from '@countrylock/ui-manifest';

export type UpdateStatus = 'none' | 'ready' | 'rejected' | 'busy' | 'error';
export interface UpdateResult {
  status: UpdateStatus;
  reason?: string;
  uiVersion?: string;
}
/** Tindakan setelah gagal memuat: `retry` = coba muat ulang sekali, `rolled-back` = root berganti. */
export type LoadFailureAction = 'none' | 'retry' | 'rolled-back';

export interface UiBundleDeps {
  /** Folder data bundel (`<userData>/ui`). */
  dir: string;
  /** UI dasar terkemas (selalu tersedia). */
  baselineDir: string;
  serverUrl: () => string;
  /** `null` = pembaruan dinonaktifkan (kunci publik belum diserahkan). */
  publicKeyPem: string | null;
  bridgeVersion: number;
  /** Ada inject berjalan? Bundel tidak ditukar dan tidak diperiksa saat true. */
  isBusy: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface UiBundleManager {
  activeRoot(): string;
  checkForUpdate(): Promise<UpdateResult>;
  /** Menerapkan bundel `ready` (bila tak sibuk). `true` bila root berganti. */
  applyReady(): boolean;
  /** Versi yang sudah diunduh dan menunggu diterapkan. */
  readyVersion(): string | null;
  markLoadFailed(): LoadFailureAction;
  markLoadOk(): void;
}

interface State {
  active: string | null;
  previous: string | null;
  ready: string | null;
  bad: string[];
  failures: number;
  etag: string | null;
}

type ManifestFetch =
  | { kind: 'none'; reason: string }
  | { kind: 'ok'; manifestJson: string; signature: string; etag: string | null };

const HEX64 = /^[0-9a-f]{64}$/;
const MANIFEST_PATH = '/api/desktop/ui-manifest';
const MANIFEST_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 60_000;
const MAX_MANIFEST_CHARS = 2 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_BAD = 50;
const FAILURES_BEFORE_ROLLBACK = 2;

/**
 * Lokasi berkas di bawah `root`, atau melempar `Rejected`. Pertahanan berlapis di samping
 * `isSafeUiPath`: tanpa `:` (drive/ADS Windows) dan hasil resolve tak boleh keluar dari `root`.
 */
function destinationOf(root: string, path: string): string {
  const segments = path.split('/');
  if (segments.some((s) => s.includes(':'))) throw new Rejected('Jalur berkas tidak aman');
  const rootAbs = resolve(root);
  const dest = resolve(rootAbs, ...segments);
  if (!dest.startsWith(rootAbs + sep)) throw new Rejected('Jalur berkas keluar dari folder bundel');
  return dest;
}

/** Bundel gagal diverifikasi (bukan sekadar jaringan): status `rejected`. */
class Rejected extends Error {}

function emptyState(): State {
  return { active: null, previous: null, ready: null, bad: [], failures: 0, etag: null };
}

function versionOrNull(value: unknown): string | null {
  return typeof value === 'string' && HEX64.test(value) ? value : null;
}

function readState(file: string): State {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const bad = Array.isArray(raw.bad)
      ? raw.bad
          .map(versionOrNull)
          .filter((v): v is string => v !== null)
          .slice(-MAX_BAD)
      : [];
    const failures =
      typeof raw.failures === 'number' && Number.isInteger(raw.failures) && raw.failures >= 0
        ? Math.min(raw.failures, 10)
        : 0;
    return {
      active: versionOrNull(raw.active),
      previous: versionOrNull(raw.previous),
      ready: versionOrNull(raw.ready),
      bad,
      failures,
      etag: typeof raw.etag === 'string' && raw.etag.length <= 256 ? raw.etag : null,
    };
  } catch {
    return emptyState();
  }
}

export function createUiBundleManager(deps: UiBundleDeps): UiBundleManager {
  const doFetch = deps.fetchImpl ?? fetch;
  const versionsDir = join(deps.dir, 'versions');
  const stagingDir = join(deps.dir, 'staging');
  const stateFile = join(deps.dir, 'state.json');
  const state = readState(stateFile);
  let inflight: Promise<UpdateResult> | null = null;

  const versionDir = (version: string): string => join(versionsDir, version);
  const usable = (version: string | null): version is string =>
    version !== null && existsSync(join(versionDir(version), 'index.html'));

  const persist = (): void => {
    try {
      mkdirSync(deps.dir, { recursive: true });
      const temp = `${stateFile}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      renameSync(temp, stateFile);
    } catch {
      // Gagal menulis keadaan tak boleh menjatuhkan aplikasi; keadaan memori tetap berlaku.
    }
  };

  /** Hapus semua versi selain active/previous/ready (paling banyak 3 tersimpan). */
  const prune = (): void => {
    const keep = new Set([state.active, state.previous, state.ready].filter((v) => v !== null));
    try {
      for (const entry of readdirSync(versionsDir)) {
        if (!keep.has(entry)) rmSync(join(versionsDir, entry), { recursive: true, force: true });
      }
    } catch {
      // Folder belum ada.
    }
  };

  const markBad = (version: string): void => {
    if (!state.bad.includes(version)) state.bad = [...state.bad, version].slice(-MAX_BAD);
  };

  // Awal: bundel aktif yang berkasnya hilang/rusak diabaikan (kembali ke dasar).
  if (state.active && !usable(state.active)) {
    markBad(state.active);
    state.active = null;
  }
  if (state.previous && !usable(state.previous)) state.previous = null;
  let current: string | null = state.active;
  rmSync(stagingDir, { recursive: true, force: true }); // sisa unduhan terputus pada sesi lalu

  const applyReady = (): boolean => {
    if (state.ready === null) return false;
    if (deps.isBusy()) return false;
    if (!usable(state.ready)) {
      state.ready = null;
      persist();
      return false;
    }
    state.previous = state.active;
    state.active = state.ready;
    state.ready = null;
    state.failures = 0;
    current = state.active;
    prune();
    persist();
    return true;
  };

  // Peluncuran: terapkan bundel yang sudah diunduh pada sesi sebelumnya.
  applyReady();
  if (existsSync(deps.dir)) persist();

  function remember(etag: string | null): void {
    state.etag = etag;
    persist();
  }

  function failure(error: unknown): UpdateResult {
    if (error instanceof Rejected) return { status: 'rejected', reason: error.message };
    // Pesan jaringan tidak diteruskan apa adanya (dapat memuat alamat); cukup ringkas.
    const reason =
      error instanceof Error && /^(Gagal mengunduh|Server menjawab)/.test(error.message)
        ? error.message
        : 'Server tidak dapat dihubungi atau unduhan terputus';
    return { status: 'error', reason };
  }

  async function fetchManifest(): Promise<ManifestFetch> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (state.etag) headers['If-None-Match'] = state.etag;
    const response = await doFetch(`${deps.serverUrl()}${MANIFEST_PATH}`, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (response.status === 304) return { kind: 'none', reason: 'sudah terbaru' };
    // 404: server belum punya manifest bertanda tangan; bukan galat.
    if (response.status === 404) {
      return { kind: 'none', reason: 'server belum menyediakan manifest' };
    }
    if (response.status !== 200) throw new Error(`Server menjawab ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_MANIFEST_CHARS) throw new Rejected('Manifest terlalu besar');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Rejected('Manifest bukan JSON');
    }
    const record =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (
      typeof record.signature !== 'string' ||
      typeof record.manifest !== 'object' ||
      record.manifest === null
    ) {
      throw new Rejected('Bentuk manifest salah');
    }
    return {
      kind: 'ok',
      // Byte yang ditandatangani = serialisasi kanonik objek manifest (sama dengan server/skrip).
      manifestJson: JSON.stringify(record.manifest),
      signature: record.signature,
      etag: response.headers.get('etag'),
    };
  }

  async function downloadFile(
    base: string,
    entry: UiManifest['files'][number],
    root: string,
  ): Promise<void> {
    const segments = entry.path.split('/');
    const dest = destinationOf(root, entry.path);
    const url = `${base}/${segments.map(encodeURIComponent).join('/')}`;
    const response = await doFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    if (response.status !== 200 || !response.body) {
      throw new Error(`Gagal mengunduh ${entry.path} (${response.status})`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > entry.size) {
        await reader.cancel();
        throw new Rejected(`Ukuran ${entry.path} melebihi manifest`);
      }
      chunks.push(value);
    }
    if (total !== entry.size) {
      throw new Rejected(`Ukuran ${entry.path} tidak cocok dengan manifest`);
    }
    const data = Buffer.concat(chunks);
    if (createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      throw new Rejected(`Hash ${entry.path} tidak cocok dengan manifest`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }

  async function check(): Promise<UpdateResult> {
    if (deps.publicKeyPem === null) {
      return { status: 'none', reason: 'kunci publik pembaruan UI belum diisi' };
    }
    if (deps.isBusy()) return { status: 'busy', reason: 'inject sedang berjalan' };

    let manifest: UiManifest;
    let newEtag: string | null = null;
    try {
      const fetched = await fetchManifest();
      if (fetched.kind === 'none') return { status: 'none', reason: fetched.reason };
      if (!verifyUiManifest(fetched.manifestJson, fetched.signature, deps.publicKeyPem)) {
        throw new Rejected('Tanda tangan manifest tidak sah');
      }
      const parsed = parseUiManifest(fetched.manifestJson);
      if (!parsed) throw new Rejected('Isi manifest tidak valid');
      manifest = parsed;
      newEtag = fetched.etag;
    } catch (error) {
      return failure(error);
    }

    const { uiVersion } = manifest;
    if (manifest.minBridge > deps.bridgeVersion) {
      return {
        status: 'rejected',
        reason: `UI ini butuh jembatan versi ${manifest.minBridge} (aplikasi: ${deps.bridgeVersion}); perbarui aplikasi`,
        uiVersion,
      };
    }
    if (state.bad.includes(uiVersion)) {
      return { status: 'none', reason: 'versi ini pernah gagal dimuat', uiVersion };
    }
    if (uiVersion === state.active || uiVersion === state.ready) {
      remember(newEtag);
      return { status: 'none', reason: 'sudah terbaru', uiVersion };
    }
    const totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    if (
      manifest.files.length > MAX_FILES ||
      totalBytes > MAX_TOTAL_BYTES ||
      manifest.files.some((f) => f.size > MAX_FILE_BYTES)
    ) {
      return { status: 'rejected', reason: 'Bundel melebihi batas ukuran', uiVersion };
    }
    if (!manifest.files.some((f) => f.path === 'index.html')) {
      return { status: 'rejected', reason: 'Bundel tanpa index.html', uiVersion };
    }

    // Versi lama yang masih tersimpan (mis. server kembali ke build sebelumnya): cukup diterapkan.
    if (usable(uiVersion)) {
      state.ready = uiVersion;
      remember(newEtag);
      return { status: 'ready', uiVersion };
    }

    const staging = join(stagingDir, uiVersion);
    try {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const base = deps.serverUrl();
      // Semua tujuan diperiksa SEBELUM satu pun berkas diminta.
      for (const file of manifest.files) destinationOf(staging, file.path);
      for (const file of manifest.files) await downloadFile(base, file, staging);
      await mkdir(versionsDir, { recursive: true });
      await rm(versionDir(uiVersion), { recursive: true, force: true });
      await rename(staging, versionDir(uiVersion));
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return { ...failure(error), uiVersion };
    }
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);

    state.ready = uiVersion;
    remember(newEtag);
    prune();
    return { status: 'ready', uiVersion };
  }

  return {
    activeRoot: () => (current ? versionDir(current) : deps.baselineDir),
    checkForUpdate() {
      inflight ??= check().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    applyReady,
    readyVersion: () => state.ready,
    markLoadFailed() {
      if (current === null) return 'none';
      state.failures += 1;
      if (state.failures < FAILURES_BEFORE_ROLLBACK) {
        persist();
        return 'retry';
      }
      const failed = current;
      markBad(failed);
      rmSync(versionDir(failed), { recursive: true, force: true });
      const fallback =
        usable(state.previous) && !state.bad.includes(state.previous) ? state.previous : null;
      state.active = fallback;
      state.previous = null;
      state.failures = 0;
      current = fallback;
      persist();
      return 'rolled-back';
    },
    markLoadOk() {
      if (state.failures === 0) return;
      state.failures = 0;
      persist();
    },
  };
}
