// Pembaca rilis aplikasi desktop dari folder Drive `DESKTOP_RELEASES_FOLDER_ID` (spek desktop 5.2/5.4, rencana bagian 4).
// Server TIDAK memegang kunci tanda tangan dan tidak memverifikasinya: ia hanya meneruskan byte `release-<v>.json`
// apa adanya beserta `release-<v>.sig`, dan aplikasi desktop memverifikasi dengan kunci publik tertanam. Yang dijaga di
// sini: bentuk (manifest kanonik, tanda tangan 86 karakter base64url), kelengkapan (semua installer yang tercantum ada
// dengan ukuran sama), dan visibilitas (versi baru terlihat HANYA bila `.sig` ada; menarik rilis = menghapus `.sig`).
import { createHash } from 'node:crypto';
import type { BridgeClient, DriveFolderEntry } from '@server/core/bridge-client';
import { base64ToBytes } from '@server/core/bytes';
import {
  compareVersions,
  type DesktopReleaseManifest,
  installerName,
  isReleaseFileName,
  parseReleaseManifest,
  type ReleaseArch,
} from '@shared/desktop-release';

export interface ServedRelease {
  version: string;
  /** Byte persis `release-<v>.json` (tanda tangan dihitung atas teks ini). */
  manifestJson: string;
  manifest: DesktopReleaseManifest;
  /** Tanda tangan Ed25519 base64url (86 karakter). */
  signature: string;
  etag: string;
  /** Nama installer yang tercantum di manifest -> id berkas Drive dan ukuran. */
  files: Map<string, { id: string; size: number }>;
}

export interface ReleaseReader {
  /** Versi tertinggi yang terlihat dan memuat installer untuk `arch`; tak ada = `null`. */
  latest(arch: ReleaseArch): Promise<ServedRelease | null>;
  /** Semua versi yang terlihat dan utuh, urut versi menurun; yang tak lolos dilewati satu-satu (galat Drive dilempar). */
  list(): Promise<ServedRelease[]>;
  /** Berkas installer sebuah versi yang terlihat; hanya nama yang tercantum di manifest. */
  file(version: string, name: string): Promise<{ id: string; size: number } | null>;
}

export interface ReleaseReaderDeps {
  client: BridgeClient;
  folderId: string;
  now: () => number;
  /** Umur memo daftar folder dan hasil per versi (bawaan 5 menit). */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** Manifest sah jauh di bawah ini (changelog <= 20.000 karakter); batas melindungi memori dari berkas salah isi. */
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const PAGE_SIZE = 200;
/** Batas halaman mencegah putaran tak berujung pada folder salah isi (retensi menyimpan 10 versi, jauh di bawahnya). */
const MAX_PAGES = 25;
/** Galat listing Drive dimemo sesingkat ini agar Drive yang bermasalah tak digempur tiap permintaan publik. */
const FAILURE_TTL_MS = 30 * 1000;

interface VersionEntries {
  manifest?: DriveFolderEntry;
  signature?: DriveFolderEntry;
}

export function createReleaseReader(deps: ReleaseReaderDeps): ReleaseReader {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  let index: {
    at: number;
    versions: Map<string, VersionEntries>;
    byName: Map<string, DriveFolderEntry>;
  } | null = null;
  const resolved = new Map<string, ServedRelease | null>();
  let failure: { at: number; error: unknown } | null = null;

  async function readIndex() {
    if (index && deps.now() - index.at < ttlMs) return index;
    if (failure && deps.now() - failure.at < FAILURE_TTL_MS) throw failure.error;
    try {
      const versions = new Map<string, VersionEntries>();
      const byName = new Map<string, DriveFolderEntry>();
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const listing = await deps.client.listFolder(deps.folderId, {
          pageSize: PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const entry of listing.files) {
          byName.set(entry.name, entry);
          const kind = isReleaseFileName(entry.name);
          if (kind?.kind !== 'manifest' && kind?.kind !== 'signature') continue;
          const slot = versions.get(kind.version) ?? {};
          if (kind.kind === 'manifest') slot.manifest = entry;
          else slot.signature = entry;
          versions.set(kind.version, slot);
        }
        pageToken = listing.nextPageToken;
        if (!pageToken) break;
      }
      index = { at: deps.now(), versions, byName };
      failure = null;
      resolved.clear();
      return index;
    } catch (error) {
      failure = { at: deps.now(), error };
      throw error;
    }
  }

  /** Galat Drive (jaringan, kuota) DILEMPAR agar tak dimemo sebagai "rilis rusak"; isi yang tak layak = `null`. */
  async function readText(entry: DriveFolderEntry, maxBytes: number): Promise<string | null> {
    if (entry.size > maxBytes) return null;
    const file = await deps.client.readFile(entry.id, deps.folderId);
    if (!file) return null;
    const bytes = base64ToBytes(file.base64);
    if (bytes.length > maxBytes) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  /** Versi terlihat dan utuh, atau `null` (tak lengkap/rusak: dicatat generik, tanpa nama berkas). */
  async function resolve(version: string): Promise<ServedRelease | null> {
    const idx = await readIndex();
    if (resolved.has(version)) return resolved.get(version) ?? null;
    const result = await build(version, idx.versions.get(version), idx.byName);
    resolved.set(version, result);
    return result;
  }

  async function build(
    version: string,
    entries: VersionEntries | undefined,
    byName: Map<string, DriveFolderEntry>,
  ): Promise<ServedRelease | null> {
    if (!entries?.manifest || !entries.signature) return null;
    const manifestJson = await readText(entries.manifest, MAX_MANIFEST_BYTES);
    let signature = await readText(entries.signature, MAX_SIGNATURE_BYTES);
    if (manifestJson === null || signature === null) return null;
    signature = signature.trim();
    if (!SIGNATURE_PATTERN.test(signature)) return null;
    const manifest = parseReleaseManifest(manifestJson);
    if (manifest?.version !== version) return null;
    const files = new Map<string, { id: string; size: number }>();
    for (const file of manifest.files) {
      const entry = byName.get(file.name);
      if (!entry || entry.size !== file.size) return null;
      files.set(file.name, { id: entry.id, size: entry.size });
    }
    const etag = createHash('sha256').update(`${manifestJson}\n${signature}`).digest('hex');
    return { version, manifestJson, manifest, signature, etag, files };
  }

  return {
    async latest(arch) {
      const idx = await readIndex();
      const candidates = [...idx.versions.keys()].sort((a, b) => compareVersions(b, a));
      for (const version of candidates) {
        const release = await resolve(version);
        if (release?.files.has(installerName(version, arch))) return release;
      }
      return null;
    },
    async list() {
      const idx = await readIndex();
      const versions = [...idx.versions.keys()].sort((a, b) => compareVersions(b, a));
      const releases: ServedRelease[] = [];
      for (const version of versions) {
        const release = await resolve(version);
        if (release) releases.push(release);
      }
      return releases;
    },
    async file(version, name) {
      const kind = isReleaseFileName(name);
      if (kind?.kind !== 'installer' || kind.version !== version) return null;
      const idx = await readIndex();
      if (!idx.versions.has(version)) return null;
      const release = await resolve(version);
      return release?.files.get(name) ?? null;
    },
  };
}
