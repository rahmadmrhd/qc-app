import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { nowIso_ } from '@gas/modules/access/service';
import type { FileOwnerType } from '@shared/files';
import { base64ByteLength, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import type { GasFileContentDto, GasUploadFileInput } from '@shared/gas-legacy';
import type { FileDto, GetFileInput } from '@shared/rpc';
import type { FileRecord, NewFileRecord } from './repo';
import { insertFile_, listFiles_, updateFile_ } from './repo';

const DRIVE_FOLDER_PROPERTY = 'DRIVE_FOLDER_ID';
export const DRIVE_FOLDER_NAME = 'QC App Files';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Dipakai `setup`; idempoten. Membuat folder **hanya bila `DRIVE_FOLDER_ID` kosong**. Bila terisi tetapi
 * foldernya tak dapat diakses (dihapus, tempat sampah, atau akun pemilik tak punya akses), melempar galat dan
 * TIDAK menimpa properti: menimpa akan memutus semua gambar yang sudah tercatat (FS13).
 */
export function ensureNamedFolder_(property: string, name: string): string {
  return platform_().withLock(() => {
    const platform = platform_();
    const existing = platform.getProperty(property)?.trim();
    if (existing) {
      if (platform.driveFolderExists(existing)) return existing;
      throw appError_(
        'INTERNAL',
        `Folder Drive ${existing} tidak dapat diakses (dihapus, ada di tempat sampah, atau akun pemilik script belum punya akses Editor).`,
      );
    }
    const id = platform.driveCreateFolder(name);
    platform.setProperty(property, id);
    return id;
  });
}

/** Folder gambar item; perilaku FS13 (tidak menimpa properti terisi) ada di `ensureNamedFolder_`. */
export function ensureDriveFolder_(): string {
  return ensureNamedFolder_(DRIVE_FOLDER_PROPERTY, DRIVE_FOLDER_NAME);
}

function toFileDto_(file: NewFileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

export function uploadFile_(input: GasUploadFileInput, actor: UserContext): FileDto {
  const platform = platform_();
  // Batas berkas yatim per user: yang belum ditautkan ke entitas tidak boleh menumpuk tanpa batas.
  const pending = listFiles_().filter(
    (file) => file.createdBy === actor.email && file.ownerType === '',
  ).length;
  if (pending >= MAX_UNATTACHED_UPLOADS) {
    throw appError_(
      'CONFLICT',
      'Terlalu banyak gambar yang belum dipakai. Simpan item yang sedang diedit terlebih dulu.',
    );
  }
  const folderId = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim() || ensureDriveFolder_();
  const id = platform.uuid();
  const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
  // I/O Drive (unggah ~1 MB) di luar lock agar tidak menahan penulisan lain; hanya sheet di dalam lock.
  const driveId = platform.driveCreateFile(folderId, name, input.mime, input.base64);
  try {
    return platform.withLock(() => {
      const record: NewFileRecord = {
        id,
        driveId,
        mime: input.mime,
        size: base64ByteLength(input.base64),
        width: input.width,
        height: input.height,
        ownerType: '',
        ownerId: '',
        createdAt: nowIso_(),
        createdBy: actor.email,
      };
      insertFile_(record);
      return toFileDto_(record);
    });
  } catch (error) {
    // Pencatatan gagal: jangan tinggalkan berkas yatim di Drive.
    platform.driveTrashFile(driveId);
    throw error;
  }
}

const FILE_CACHE_TTL_SECONDS = 10800;
/** CacheService membatasi 100 KB per nilai; isi berkas dipotong per 90 ribu karakter base64. */
const FILE_CACHE_CHUNK = 90_000;
const FILE_CACHE_MAX_CHUNKS = 6;

/**
 * Isi berkas dari cache (pengganti pembacaan Drive yang makan 0,5-1,5 dtk). Hanya dipanggil SETELAH rekaman berkas
 * lolos pemeriksaan di sheet `files` (izin/pemilik), jadi cache tidak melewati aturan akses. Berkas tidak pernah
 * diubah isinya (unggahan baru = id baru).
 */
function readCachedFile_(folderId: string, driveId: string): string | null {
  if (folderId === '') return null;
  const platform = platform_();
  const count = Number(platform.cacheGet(`fcont:${folderId}:${driveId}:n`) ?? '0');
  if (!Number.isInteger(count) || count < 1 || count > FILE_CACHE_MAX_CHUNKS) return null;
  let text = '';
  for (let index = 0; index < count; index++) {
    const part = platform.cacheGet(`fcont:${folderId}:${driveId}:${index}`);
    if (part === null) return null;
    text += part;
  }
  return text;
}

function cacheFileContent_(folderId: string, driveId: string, base64: string): void {
  const chunks = Math.ceil(base64.length / FILE_CACHE_CHUNK);
  if (chunks < 1 || chunks > FILE_CACHE_MAX_CHUNKS) return;
  const platform = platform_();
  for (let index = 0; index < chunks; index++) {
    platform.cachePut(
      `fcont:${folderId}:${driveId}:${index}`,
      base64.slice(index * FILE_CACHE_CHUNK, (index + 1) * FILE_CACHE_CHUNK),
      FILE_CACHE_TTL_SECONDS,
    );
  }
  // Penanda terakhir: pembaca hanya percaya cache bila semua potongan sudah ada.
  platform.cachePut(`fcont:${folderId}:${driveId}:n`, String(chunks), FILE_CACHE_TTL_SECONDS);
}

/** Hanya berkas yang tercatat di sheet `files` yang dapat dibaca; Drive id tidak pernah datang dari klien. */
/**
 * Membaca berkas. `onlyLogosFor` (email pemanggil) dipakai untuk pengguna yang TIDAK punya izin `item` (mis. hanya
 * `qrcode`): mereka hanya boleh membaca logo bersama (`qrlogo`) dan unggahan miliknya yang belum terpasang
 * (pratinjau logo sebelum disimpan), bukan foto item.
 */
export function readFile_(input: GetFileInput, onlyLogosFor?: string): GasFileContentDto {
  const record = listFiles_().find((file) => file.id === input.id);
  if (!record) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  if (onlyLogosFor !== undefined) {
    const isLogo = record.ownerType === 'qrlogo';
    const isOwnPending = record.ownerType === '' && record.createdBy === onlyLogosFor;
    if (!isLogo && !isOwnPending) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  // Hanya berkas di dalam folder aplikasi yang boleh dibaca (pertahanan berlapis bila sheet files diedit manual).
  // Cache terikat folder aktif: mengganti DRIVE_FOLDER_ID membuat isi lama tidak terpakai lagi.
  const folderId = platform_().getProperty(DRIVE_FOLDER_PROPERTY)?.trim() ?? '';
  const cached = readCachedFile_(folderId, record.driveId);
  if (cached !== null) return { id: record.id, mime: record.mime, base64: cached };
  const content = folderId ? platform_().driveReadFile(record.driveId, folderId) : null;
  if (!content) throw appError_('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  cacheFileContent_(folderId, record.driveId, content.base64);
  return { id: record.id, mime: record.mime, base64: content.base64 };
}

/**
 * Menetapkan pemilik berkas (dipakai simpan item pada Fase B). Pemanggil wajib memegang lock.
 * Berkas yang sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang. Atomik: seluruh batch divalidasi dulu.
 */
export function attachFiles_(
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
): void {
  if (ids.length === 0) return;
  const files = listFiles_();
  // Tahap 1: validasi seluruh batch sebelum menulis apa pun (tanpa setengah jalan bila ada yang gagal).
  const toClaim: FileRecord[] = [];
  for (const id of new Set(ids)) {
    const file = files.find((item) => item.id === id);
    if (!file) throw appError_('VALIDATION', 'Ada berkas yang tidak dikenal');
    if (file.ownerType === '') toClaim.push(file);
    else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError_('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
  // Tahap 2: tetapkan pemilik.
  for (const file of toClaim) updateFile_({ ...file, ownerType, ownerId });
}
