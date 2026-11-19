// Pembangunan, penandatanganan, dan penerbitan rilis aplikasi desktop (spek desktop 5.2-5.6, rencana bagian 4).
// Dipakai CLI `scripts/publish-desktop-release.ts` (job `publish-desktop` di `release.yml`). Fungsi menerima klien Google
// lewat parameter sehingga dapat diuji dengan `createFakeBridge()`.
//
// Tata letak folder Drive DATAR (keputusan pemilik 2026-11-18, mengubah spek 5.2): `QC-App-Setup-<v>-<arch>.exe`,
// `release-<v>.json`, `release-<v>.sig`. Berkas `.sig` adalah penanda "rilis terlihat" dan SELALU diunggah terakhir:
// server hanya menyajikan versi yang punya tanda tangan, jadi unggahan yang gagal di tengah tak pernah terlihat pengguna.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizePublicKeyInput,
  publicKeyFingerprint,
  publicKeyPemOf,
  signUiManifest,
} from '../countrylock/src/ui-manifest';
import type { BridgeClient, DriveFolderEntry } from '../server/src/core/bridge-client';
import {
  compareVersions,
  type DesktopReleaseManifest,
  installerName,
  isReleaseFileName,
  manifestFileName,
  parseReleaseManifest,
  RELEASE_ARCHS,
  RELEASE_SCHEMA,
  type ReleaseFile,
  signatureFileName,
} from '../shared/desktop-release';

/** Jumlah versi terbaru yang dipertahankan di Drive (spek 5.2; bawaan `pruneInstallers`). */
export const KEEP_VERSIONS = 10;

const INSTALLER_MIME = 'application/octet-stream';
const MANIFEST_MIME = 'application/json';
const SIGNATURE_MIME = 'text/plain';
const LIST_PAGE_SIZE = 200;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface FileDigest {
  size: number;
  sha512: string;
  md5: string;
}

/** Ukuran dan hash isi berkas, dibaca bertahap (installer ratusan MB tak boleh dimuat sekaligus ke memori). */
function digestOf(path: string): Promise<FileDigest> {
  return new Promise((resolve, reject) => {
    const sha512 = createHash('sha512');
    const md5 = createHash('md5');
    let size = 0;
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      sha512.update(bytes);
      md5.update(bytes);
    });
    stream.on('error', reject);
    stream.on('end', () =>
      resolve({ size, sha512: sha512.digest('base64'), md5: md5.digest('hex') }),
    );
  });
}

export interface BuildManifestInput {
  version: string;
  /** Folder berisi `QC-App-Setup-<versi>-<arch>.exe` untuk SEMUA arsitektur. */
  dir: string;
  /** Bagian versi ini dari `desktop/CHANGELOG.md`. */
  changelog: string;
  /** ISO 8601 UTC. */
  publishedAt: string;
}

/** Membangun `release-<versi>.json` kanonik dari installer di `dir`. Melempar bila ada installer hilang atau hasilnya tak sah. */
export async function buildReleaseManifest(input: BuildManifestInput): Promise<string> {
  if (!VERSION_PATTERN.test(input.version)) {
    throw new Error('Versi rilis harus berbentuk X.Y.Z (tanpa awalan nol atau akhiran).');
  }
  const files: ReleaseFile[] = [];
  for (const arch of RELEASE_ARCHS) {
    const name = installerName(input.version, arch);
    const path = join(input.dir, name);
    try {
      if (!statSync(path).isFile()) throw new Error('bukan berkas');
    } catch {
      throw new Error(`Installer tidak ditemukan: ${name}`);
    }
    const digest = await digestOf(path);
    files.push({ name, arch, size: digest.size, sha512: digest.sha512 });
  }
  const manifest: DesktopReleaseManifest = {
    schema: RELEASE_SCHEMA,
    version: input.version,
    publishedAt: input.publishedAt,
    files,
    changelog: input.changelog,
  };
  const json = JSON.stringify(manifest);
  // Kontrak yang sama dengan yang dipakai server dan aplikasi: manifest yang tak lolos tak boleh ditandatangani.
  if (parseReleaseManifest(json) === null) {
    throw new Error('Manifest rilis tidak sah (periksa ukuran installer dan panjang changelog).');
  }
  return json;
}

/**
 * Tanda tangan Ed25519 (base64url) atas byte persis `manifestJson`. Kunci privat dibaca dari berkas dan DIPERIKSA terhadap
 * kunci publik tertanam di aplikasi (`expectedPublicKey`): pasangan yang salah menghasilkan rilis yang ditolak semua
 * klien terpasang, jadi lebih baik gagal di CI. Pesan galat tak pernah memuat isi kunci (hanya sidik publik).
 */
export function signRelease(
  manifestJson: string,
  privateKeyFile: string,
  expectedPublicKey: string,
): string {
  let privatePem: string;
  try {
    privatePem = readFileSync(privateKeyFile, 'utf8');
  } catch {
    throw new Error(`Berkas kunci privat tidak terbaca: ${privateKeyFile}`);
  }
  const expectedPem = normalizePublicKeyInput(expectedPublicKey);
  if (expectedPem === null) throw new Error('Kunci publik rilis tertanam tidak dapat dibaca.');
  const expected = publicKeyFingerprint(expectedPem);
  let actual: string;
  try {
    actual = publicKeyFingerprint(publicKeyPemOf(privatePem));
  } catch {
    throw new Error('Kunci privat rilis tidak sah (harus Ed25519 PKCS8 PEM).');
  }
  if (actual !== expected) {
    throw new Error(
      `Kunci privat rilis tidak cocok dengan kunci publik yang tertanam di aplikasi (sidik tertanam: ${expected}).`,
    );
  }
  return signUiManifest(manifestJson, privatePem);
}

export interface PreparedRelease {
  version: string;
  /** Folder berisi installer kedua arsitektur. */
  dir: string;
  /** `release-<versi>.json` kanonik (hasil `buildReleaseManifest`). */
  manifestJson: string;
  /** Hasil `signRelease` (base64url). */
  signature: string;
}

async function listAll(
  client: BridgeClient,
  folderId: string,
  name?: string,
): Promise<DriveFolderEntry[]> {
  const all: DriveFolderEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.listFolder(folderId, {
      pageSize: LIST_PAGE_SIZE,
      ...(name === undefined ? {} : { name }),
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return all;
}

async function deleteNamed(client: BridgeClient, folderId: string, name: string): Promise<void> {
  for (const entry of await listAll(client, folderId, name)) await client.deleteFile(entry.id);
}

interface UploadSpec {
  name: string;
  mime: string;
  source: Blob | Uint8Array;
  size: number;
  md5: string;
}

/**
 * Unggah idempoten: berkas bernama sama yang MD5 dan ukurannya cocok dipakai ulang; yang tidak cocok (sisa unggahan
 * gagal) dibuang dulu. Setelah unggah, MD5 dan ukuran dari Drive HARUS sama dengan hitungan lokal; beda = berkas Drive
 * dibuang dan penerbitan gagal (jangan pernah meninggalkan installer cacat yang tampak sah).
 */
async function ensureUploaded(
  client: BridgeClient,
  folderId: string,
  spec: UploadSpec,
): Promise<void> {
  const existing = await listAll(client, folderId, spec.name);
  const reusable =
    existing.length === 1 &&
    existing[0]?.md5Checksum === spec.md5 &&
    existing[0]?.size === spec.size;
  if (reusable) return;
  for (const entry of existing) await client.deleteFile(entry.id);
  const result = await client.uploadFile(folderId, spec.name, spec.mime, spec.source);
  if (result.md5Checksum !== spec.md5 || result.size !== spec.size) {
    await client.deleteFile(result.id);
    throw new Error(
      `MD5/ukuran ${spec.name} di Drive tidak sama dengan berkas lokal; unggahan dibatalkan.`,
    );
  }
}

/**
 * Menerbitkan rilis ke folder Drive: (1) hapus tanda tangan lama versi ini sehingga versi TIDAK terlihat selama unggah,
 * (2) installer tiap arsitektur, (3) manifest, (4) tanda tangan TERAKHIR (baru saat itu versi terlihat). Aman diulang.
 */
export async function publishRelease(
  client: BridgeClient,
  folderId: string,
  release: PreparedRelease,
): Promise<void> {
  await deleteNamed(client, folderId, signatureFileName(release.version));
  for (const arch of RELEASE_ARCHS) {
    const name = installerName(release.version, arch);
    const path = join(release.dir, name);
    const digest = await digestOf(path);
    await ensureUploaded(client, folderId, {
      name,
      mime: INSTALLER_MIME,
      source: Bun.file(path),
      size: digest.size,
      md5: digest.md5,
    });
  }
  const textSpec = (name: string, mime: string, text: string): UploadSpec => {
    const bytes = new TextEncoder().encode(text);
    return {
      name,
      mime,
      source: bytes,
      size: bytes.length,
      md5: createHash('md5').update(bytes).digest('hex'),
    };
  };
  await ensureUploaded(
    client,
    folderId,
    textSpec(manifestFileName(release.version), MANIFEST_MIME, release.manifestJson),
  );
  await ensureUploaded(
    client,
    folderId,
    textSpec(signatureFileName(release.version), SIGNATURE_MIME, release.signature),
  );
}

/** Menarik rilis dari pengguna: menghapus HANYA tanda tangannya (installer dan manifest tetap untuk penelusuran). Aman bila tak ada. */
export async function withdrawRelease(
  client: BridgeClient,
  folderId: string,
  version: string,
): Promise<void> {
  if (!VERSION_PATTERN.test(version)) throw new Error('Versi harus berbentuk X.Y.Z.');
  await deleteNamed(client, folderId, signatureFileName(version));
}

/**
 * Menyimpan `keep` versi TERLIHAT terbaru (punya `.sig`, urutan numerik) dan menghapus installer, manifest, dan tanda
 * tangan versi yang lebih lama dari yang ke-`keep`. Versi yang ditarik (tanpa `.sig`) tak dihitung sebagai yang
 * dipertahankan (agar tak menggusur versi yang sedang terlihat) dan hanya dihapus bila di bawah batas itu. `protect`
 * (versi yang baru diterbitkan, mis. pemulihan versi lama) tak pernah dihapus. Berkas yang bukan nama rilis dikenal tak
 * disentuh. `keep` < 1 ditolak agar tak pernah menghapus semuanya.
 */
export async function pruneInstallers(
  client: BridgeClient,
  folderId: string,
  keep: number = KEEP_VERSIONS,
  protect?: string,
): Promise<void> {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Jumlah versi yang disimpan minimal 1.');
  const entries = await listAll(client, folderId);
  const byVersion = new Map<string, DriveFolderEntry[]>();
  for (const entry of entries) {
    const parsed = isReleaseFileName(entry.name);
    if (parsed === null) continue;
    const list = byVersion.get(parsed.version) ?? [];
    list.push(entry);
    byVersion.set(parsed.version, list);
  }
  const visible = [...byVersion.entries()]
    .filter(([, list]) => list.some((entry) => isReleaseFileName(entry.name)?.kind === 'signature'))
    .map(([version]) => version)
    .sort((a, b) => compareVersions(b, a));
  const cutoff = visible[keep - 1];
  if (visible.length <= keep || cutoff === undefined) return;
  for (const [version, list] of byVersion) {
    if (version === protect || compareVersions(version, cutoff) >= 0) continue;
    for (const entry of list) await client.deleteFile(entry.id);
  }
}
