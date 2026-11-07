import type {
  BridgeClient,
  BridgeExternalFileInfo,
  BridgeFile,
  BridgeFileInfo,
  DriveDownload,
  DriveFolderEntry,
  DriveFolderPage,
  DriveStorageQuota,
  DriveUploadResult,
} from '@server/core/bridge-client';
import { base64ToBytes, bytesToBase64 } from '@server/core/bytes';
import { appError } from '@server/core/errors';
import { denied, errorReason, failResponse, type GoogleHttp } from './request';
import { type GoogleSettings, isDriveId } from './settings';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Sampai ukuran ini berkas dikirim dalam SATU permintaan multipart; di atasnya lewat sesi resumable. */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
/** Ukuran potongan resumable: HARUS kelipatan 256 KiB (aturan Drive). */
export const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;
const CHUNK_TIMEOUT_MS = 120_000;

const NAME_MAX = 255;
const MIME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const RESOURCE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const META_FIELDS = 'id,name,mimeType,size,parents,trashed,ownedByMe,md5Checksum';

interface Meta {
  id: string;
  name?: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  ownedByMe?: boolean;
  md5Checksum?: string;
}

const encoder = new TextEncoder();

/** `Blob.slice` ada di runtime Bun tetapi tidak di tipe `Blob` yang dipakai proyek. */
interface BlobSliceable {
  slice(start: number, end: number): Blob;
}

function validation(message: string): never {
  throw appError('VALIDATION', message);
}

function checkName(name: string): void {
  if (name.trim() === '' || name.length > NAME_MAX) validation('Nama berkas tidak valid');
}

function checkMime(mime: string): void {
  if (!MIME_PATTERN.test(mime)) validation('Jenis berkas (MIME) tidak valid');
}

function checkBase64(base64: string): void {
  if (!BASE64_PATTERN.test(base64) || base64.length % 4 === 1) {
    validation('Isi berkas bukan base64 yang valid');
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mimeOfHeader(response: Response, fallback = 'application/octet-stream'): string {
  const value = response.headers.get('content-type')?.split(';')[0]?.trim();
  return value ? value : fallback;
}

/** Operasi Drive di atas `GoogleHttp`. Setiap id yang masuk ke jalur URL divalidasi `DRIVE_ID_PATTERN` dulu. */
export function createDriveApi(
  http: GoogleHttp,
  settings: GoogleSettings,
): Pick<
  BridgeClient,
  | 'createFolder'
  | 'createFile'
  | 'readFile'
  | 'fileInfo'
  | 'folderExists'
  | 'trashFile'
  | 'externalFileInfo'
  | 'readExternalFile'
  | 'copyFile'
  | 'renameFile'
  | 'shareAnyoneWithLink'
  | 'revokeSharing'
  | 'replaceFileContent'
  | 'uploadFile'
  | 'listFolder'
  | 'downloadFile'
  | 'deleteFile'
  | 'storageQuota'
> {
  const explicit = new Set(
    [
      settings.ATTACHMENTS_FOLDER_ID,
      settings.QR_FOLDER_ID,
      settings.QR_DOC_FOLDER_ID,
      settings.BACKUP_FOLDER_ID,
      ...settings.ALLOWED_FOLDER_IDS,
    ].filter(isDriveId),
  );
  /** Subfolder langsung dari induk yang sudah diverifikasi lewat API (induk tak berubah selama proses hidup). */
  const verifiedChildren = new Set<string>();
  const root = settings.GOOGLE_ROOT_FOLDER_ID;

  const path = (id: string) => encodeURIComponent(id);

  function resourceHeaders(
    fileId: string,
    resourceKey: string | undefined,
  ): Record<string, string> {
    return resourceKey === undefined
      ? {}
      : { 'x-goog-drive-resource-keys': `${fileId}/${resourceKey}` };
  }

  /** `null` bila 404 (atau, bila `forbiddenAsNull`, 403 non-rate-limit); galat lain dilempar. */
  async function getMeta(
    op: string,
    fileId: string,
    headers: Record<string, string> = {},
    forbiddenAsNull = false,
  ): Promise<Meta | null> {
    const response = await http.request({
      op,
      method: 'GET',
      url: `${DRIVE}/files/${path(fileId)}?fields=${META_FIELDS}`,
      headers,
      idempotent: true,
    });
    if (response.status === 404) return null;
    if (response.status === 403 && forbiddenAsNull) {
      const reason = await errorReason(response);
      if (reason !== 'rateLimitExceeded' && reason !== 'userRateLimitExceeded') return null;
    }
    if (!response.ok) return failResponse(op, response);
    return (await response.json()) as Meta;
  }

  /**
   * Folder yang boleh disentuh: yang tercantum di konfigurasi (`ATTACHMENTS_FOLDER_ID`, `QR_*`, `BACKUP_FOLDER_ID`,
   * `ALLOWED_FOLDER_IDS`) atau subfolder langsung dari folder induk (diverifikasi lewat API, lalu di-cache).
   */
  async function isAllowedFolder(folderId: string): Promise<boolean> {
    if (!isDriveId(folderId)) return false;
    if (explicit.has(folderId) || verifiedChildren.has(folderId)) return true;
    if (!isDriveId(root) || folderId === root) return false;
    const meta = await getMeta('folder', folderId);
    if (
      meta &&
      meta.mimeType === FOLDER_MIME &&
      meta.trashed !== true &&
      meta.parents?.includes(root)
    ) {
      verifiedChildren.add(folderId);
      return true;
    }
    return false;
  }

  async function assertAllowedFolder(folderId: string): Promise<void> {
    if (!(await isAllowedFolder(folderId))) {
      console.error('Klien Google menolak operasi: folder di luar daftar yang diizinkan');
      throw denied();
    }
  }

  /** Berkas yang diubah/dibuang harus berinduk salah satu folder yang diizinkan. */
  async function assertManaged(meta: Meta): Promise<void> {
    for (const parent of (meta.parents ?? []).slice(0, 5)) {
      if (await isAllowedFolder(parent)) return;
    }
    console.error('Klien Google menolak operasi: berkas di luar folder yang diizinkan');
    throw denied();
  }

  /** Meta berkas yang harus anak `folderId` (folder terdaftar). `null` bila berkas tak ada. */
  async function metaInFolder(op: string, fileId: string, folderId: string): Promise<Meta | null> {
    await assertAllowedFolder(folderId);
    const meta = await getMeta(op, fileId);
    if (meta === null) return null;
    if (!meta.parents?.includes(folderId)) {
      console.error('Klien Google menolak operasi: berkas bukan anak folder yang diminta');
      throw denied();
    }
    return meta;
  }

  async function createdId(op: string, response: Response): Promise<string> {
    if (!response.ok) return failResponse(op, response);
    return ((await response.json()) as { id: string }).id;
  }

  // --- Unggah: multipart (kecil) atau resumable (besar) ---

  interface UploadSpec {
    op: string;
    /** `null` = berkas baru; id = ganti isi berkas yang ada. */
    fileId: string | null;
    metadata: Record<string, unknown>;
    mime: string;
    content: Uint8Array | Blob;
    fields: string;
    idempotent: boolean;
  }

  function uploadUrl(spec: UploadSpec, uploadType: 'multipart' | 'resumable'): string {
    const id = spec.fileId === null ? '' : `/${path(spec.fileId)}`;
    return `${UPLOAD}/files${id}?uploadType=${uploadType}&fields=${encodeURIComponent(spec.fields)}`;
  }

  async function failUpload(spec: UploadSpec, response: Response): Promise<never> {
    // 404 saat membuat = folder tujuan hilang; saat mengganti = berkas hilang.
    if (response.status === 404 && spec.fileId === null) {
      console.error(`Google ${spec.op} gagal: HTTP 404 (folder tujuan tidak ditemukan)`);
      throw appError(
        'UNAVAILABLE',
        'Folder tujuan di Google Drive tidak ditemukan atau tidak dapat diakses. Hubungi admin.',
      );
    }
    return failResponse(spec.op, response);
  }

  async function uploadMultipart(spec: UploadSpec): Promise<Meta> {
    const bytes =
      spec.content instanceof Uint8Array
        ? spec.content
        : new Uint8Array(await spec.content.arrayBuffer());
    const boundary = `qc-${crypto.randomUUID()}`;
    const body = concat([
      encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(spec.metadata)}\r\n--${boundary}\r\nContent-Type: ${spec.mime}\r\n\r\n`,
      ),
      bytes,
      encoder.encode(`\r\n--${boundary}--`),
    ]);
    const response = await http.request({
      op: spec.op,
      method: spec.fileId === null ? 'POST' : 'PATCH',
      url: uploadUrl(spec, 'multipart'),
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
      idempotent: spec.idempotent,
      timeoutMs: CHUNK_TIMEOUT_MS,
    });
    if (!response.ok) return failUpload(spec, response);
    return (await response.json()) as Meta;
  }

  async function uploadResumable(spec: UploadSpec): Promise<Meta> {
    const size = spec.content instanceof Uint8Array ? spec.content.length : spec.content.size;
    const init = await http.request({
      op: spec.op,
      method: spec.fileId === null ? 'POST' : 'PATCH',
      url: uploadUrl(spec, 'resumable'),
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': spec.mime,
        'x-upload-content-length': String(size),
      },
      body: JSON.stringify(spec.metadata),
      idempotent: spec.idempotent,
    });
    if (!init.ok) return failUpload(spec, init);
    const location = init.headers.get('location') ?? '';
    let session: URL;
    try {
      session = new URL(location);
    } catch {
      console.error(`Google ${spec.op} gagal: sesi unggah tanpa Location yang valid`);
      throw appError('UNAVAILABLE', 'Layanan Google mengalami gangguan. Coba lagi sebentar lagi.');
    }
    if (
      session.protocol !== 'https:' ||
      !(session.hostname === 'googleapis.com' || session.hostname.endsWith('.googleapis.com'))
    ) {
      console.error(`Google ${spec.op} gagal: alamat sesi unggah di luar googleapis.com ditolak`);
      throw appError('UNAVAILABLE', 'Layanan Google mengalami gangguan. Coba lagi sebentar lagi.');
    }
    for (let start = 0; start < size; start += RESUMABLE_CHUNK_BYTES) {
      const end = Math.min(start + RESUMABLE_CHUNK_BYTES, size);
      const chunk =
        spec.content instanceof Uint8Array
          ? spec.content.subarray(start, end)
          : new Uint8Array(
              await (spec.content as unknown as BlobSliceable).slice(start, end).arrayBuffer(),
            );
      const last = end === size;
      // Potongan tidak diulang otomatis: kegagalan = unggahan gagal (pemanggil mengulang dari awal bila perlu).
      const response = await http.request({
        op: spec.op,
        method: 'PUT',
        url: session.href,
        headers: { 'content-range': `bytes ${start}-${end - 1}/${size}` },
        body: chunk,
        idempotent: false,
        timeoutMs: CHUNK_TIMEOUT_MS,
      });
      if (last) {
        if (!response.ok) return failUpload(spec, response);
        return (await response.json()) as Meta;
      }
      if (response.status !== 308) {
        if (!response.ok) return failUpload(spec, response);
        console.error(
          `Google ${spec.op} gagal: sesi unggah selesai sebelum waktunya (HTTP ${response.status})`,
        );
        throw appError(
          'UNAVAILABLE',
          'Layanan Google mengalami gangguan. Coba lagi sebentar lagi.',
        );
      }
    }
    // Tak tercapai: size 0 ditangani multipart.
    throw appError('UNAVAILABLE', 'Layanan Google mengalami gangguan. Coba lagi sebentar lagi.');
  }

  function upload(spec: UploadSpec): Promise<Meta> {
    const size = spec.content instanceof Uint8Array ? spec.content.length : spec.content.size;
    return size <= MULTIPART_MAX_BYTES ? uploadMultipart(spec) : uploadResumable(spec);
  }

  function entryOf(file: Record<string, unknown>): DriveFolderEntry {
    return {
      id: String(file.id),
      name: String(file.name ?? ''),
      mime: String(file.mimeType ?? ''),
      size: file.size === undefined ? 0 : Number(file.size),
      ...(typeof file.md5Checksum === 'string' ? { md5Checksum: file.md5Checksum } : {}),
      ...(typeof file.createdTime === 'string' ? { createdTime: file.createdTime } : {}),
      ...(typeof file.modifiedTime === 'string' ? { modifiedTime: file.modifiedTime } : {}),
      appProperties: (file.appProperties as Record<string, string> | undefined) ?? {},
    };
  }

  return {
    async createFolder(name) {
      checkName(name);
      if (!isDriveId(root)) {
        throw appError(
          'UNAVAILABLE',
          'Google belum dikonfigurasi: GOOGLE_ROOT_FOLDER_ID kosong. Hubungi admin.',
        );
      }
      const response = await http.request({
        op: 'createFolder',
        method: 'POST',
        url: `${DRIVE}/files?fields=id`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        // Folder SELALU di bawah induk: tak pernah menaruh folder di Drive service account di luar penjaga.
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [root] }),
        idempotent: false,
      });
      const id = await createdId('createFolder', response);
      verifiedChildren.add(id);
      return id;
    },

    async createFile(folderId, name, mime, base64) {
      checkName(name);
      checkMime(mime);
      checkBase64(base64);
      await assertAllowedFolder(folderId);
      const meta = await upload({
        op: 'createFile',
        fileId: null,
        metadata: { name, parents: [folderId], mimeType: mime },
        mime,
        content: base64ToBytes(base64),
        fields: 'id',
        idempotent: false,
      });
      return meta.id;
    },

    async uploadFile(folderId, name, mime, source, options = {}): Promise<DriveUploadResult> {
      checkName(name);
      checkMime(mime);
      await assertAllowedFolder(folderId);
      const meta = await upload({
        op: 'uploadFile',
        fileId: null,
        metadata: {
          name,
          parents: [folderId],
          mimeType: mime,
          ...(options.appProperties ? { appProperties: options.appProperties } : {}),
        },
        mime,
        content: source,
        fields: 'id,size,md5Checksum',
        idempotent: false,
      });
      return { id: meta.id, size: Number(meta.size ?? 0), md5Checksum: meta.md5Checksum ?? '' };
    },

    async readFile(fileId, folderId): Promise<BridgeFile | null> {
      if (!isDriveId(fileId)) return null;
      const meta = await metaInFolder('readFile', fileId, folderId);
      if (meta === null) return null;
      const response = await http.request({
        op: 'readFile',
        method: 'GET',
        url: `${DRIVE}/files/${path(fileId)}?alt=media`,
        idempotent: true,
      });
      if (response.status === 404) return null;
      if (!response.ok) return failResponse('readFile', response);
      return {
        mime: meta.mimeType,
        base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
      };
    },

    async fileInfo(fileId, folderId): Promise<BridgeFileInfo | null> {
      if (!isDriveId(fileId)) return null;
      const meta = await metaInFolder('fileInfo', fileId, folderId);
      if (meta === null || meta.trashed === true) return null;
      return { mime: meta.mimeType, size: Number(meta.size ?? 0) };
    },

    async folderExists(folderId) {
      if (!isDriveId(folderId)) return false;
      const meta = await getMeta('folderExists', folderId);
      if (meta === null || meta.trashed === true || meta.mimeType !== FOLDER_MIME) return false;
      if (!explicit.has(folderId) && !verifiedChildren.has(folderId)) {
        if (!meta.parents?.includes(root)) {
          console.error('Klien Google menolak operasi: folder di luar daftar yang diizinkan');
          throw denied();
        }
        verifiedChildren.add(folderId);
      }
      return true;
    },

    async trashFile(fileId) {
      if (!isDriveId(fileId)) return;
      const meta = await getMeta('trashFile', fileId);
      if (meta === null) return;
      await assertManaged(meta);
      const response = await http.request({
        op: 'trashFile',
        method: 'PATCH',
        url: `${DRIVE}/files/${path(fileId)}?fields=id`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true }),
        idempotent: true,
      });
      if (response.status === 404) return;
      if (!response.ok) await failResponse('trashFile', response);
    },

    async externalFileInfo(fileId, resourceKey): Promise<BridgeExternalFileInfo | null> {
      if (!isDriveId(fileId)) return null;
      if (resourceKey !== undefined && !RESOURCE_KEY_PATTERN.test(resourceKey)) return null;
      const meta = await getMeta(
        'externalFileInfo',
        fileId,
        resourceHeaders(fileId, resourceKey),
        true,
      );
      if (meta === null || meta.trashed === true) return null;
      return { name: meta.name ?? '', mime: meta.mimeType, size: Number(meta.size ?? 0) };
    },

    async readExternalFile(fileId, resourceKey): Promise<BridgeFile | null> {
      if (!isDriveId(fileId)) return null;
      if (resourceKey !== undefined && !RESOURCE_KEY_PATTERN.test(resourceKey)) return null;
      const response = await http.request({
        op: 'readExternalFile',
        method: 'GET',
        url: `${DRIVE}/files/${path(fileId)}?alt=media`,
        headers: resourceHeaders(fileId, resourceKey),
        idempotent: true,
      });
      if (response.status === 404) return null;
      if (response.status === 403) {
        const reason = await errorReason(response);
        if (reason !== 'rateLimitExceeded' && reason !== 'userRateLimitExceeded') return null;
      }
      if (!response.ok) return failResponse('readExternalFile', response);
      return {
        mime: mimeOfHeader(response),
        base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
      };
    },

    async copyFile(fileId, folderId, name, resourceKey) {
      if (
        !isDriveId(fileId) ||
        (resourceKey !== undefined && !RESOURCE_KEY_PATTERN.test(resourceKey))
      ) {
        throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
      }
      checkName(name);
      await assertAllowedFolder(folderId);
      const response = await http.request({
        op: 'copyFile',
        method: 'POST',
        url: `${DRIVE}/files/${path(fileId)}/copy?fields=id`,
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          ...resourceHeaders(fileId, resourceKey),
        },
        body: JSON.stringify({ name, parents: [folderId] }),
        idempotent: false,
      });
      return createdId('copyFile', response);
    },

    async renameFile(fileId, name) {
      checkName(name);
      const meta = isDriveId(fileId) ? await getMeta('renameFile', fileId) : null;
      if (meta === null) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
      await assertManaged(meta);
      const response = await http.request({
        op: 'renameFile',
        method: 'PATCH',
        url: `${DRIVE}/files/${path(fileId)}?fields=id`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name }),
        idempotent: true,
      });
      if (!response.ok) await failResponse('renameFile', response);
    },

    async shareAnyoneWithLink(fileId) {
      const meta = isDriveId(fileId) ? await getMeta('shareAnyoneWithLink', fileId) : null;
      if (meta === null) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
      await assertManaged(meta);
      const response = await http.request({
        op: 'shareAnyoneWithLink',
        method: 'POST',
        url: `${DRIVE}/files/${path(fileId)}/permissions?fields=id`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
        idempotent: true,
      });
      if (!response.ok) await failResponse('shareAnyoneWithLink', response);
    },

    async revokeSharing(fileId) {
      if (!isDriveId(fileId)) return;
      const meta = await getMeta('revokeSharing', fileId);
      if (meta === null) return;
      await assertManaged(meta);
      const list = await http.request({
        op: 'revokeSharing',
        method: 'GET',
        url: `${DRIVE}/files/${path(fileId)}/permissions?fields=${encodeURIComponent('permissions(id,type)')}`,
        idempotent: true,
      });
      if (list.status === 404) return;
      if (!list.ok) return failResponse('revokeSharing', list);
      const { permissions = [] } = (await list.json()) as {
        permissions?: Array<{ id: string; type: string }>;
      };
      for (const permission of permissions.filter((p) => p.type === 'anyone')) {
        const response = await http.request({
          op: 'revokeSharing',
          method: 'DELETE',
          url: `${DRIVE}/files/${path(fileId)}/permissions/${path(permission.id)}`,
          idempotent: true,
        });
        if (response.status !== 404 && !response.ok) await failResponse('revokeSharing', response);
      }
    },

    async replaceFileContent(fileId, mime, base64) {
      checkMime(mime);
      checkBase64(base64);
      const meta = isDriveId(fileId) ? await getMeta('replaceFileContent', fileId) : null;
      if (meta === null) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
      await assertManaged(meta);
      await upload({
        op: 'replaceFileContent',
        fileId,
        metadata: { mimeType: mime },
        mime,
        content: base64ToBytes(base64),
        fields: 'id',
        idempotent: true,
      });
    },

    async listFolder(folderId, options = {}): Promise<DriveFolderPage> {
      await assertAllowedFolder(folderId);
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          'nextPageToken,files(id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,appProperties)',
        pageSize: String(Math.min(Math.max(options.pageSize ?? 100, 1), 1000)),
        orderBy: 'name',
      });
      if (options.pageToken) params.set('pageToken', options.pageToken);
      const response = await http.request({
        op: 'listFolder',
        method: 'GET',
        url: `${DRIVE}/files?${params.toString()}`,
        idempotent: true,
      });
      if (!response.ok) return failResponse('listFolder', response);
      const body = (await response.json()) as {
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      };
      return {
        files: (body.files ?? []).map(entryOf),
        ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
      };
    },

    async downloadFile(fileId, folderId): Promise<DriveDownload | null> {
      if (!isDriveId(fileId)) return null;
      const meta = await metaInFolder('downloadFile', fileId, folderId);
      if (meta === null) return null;
      const response = await http.request({
        op: 'downloadFile',
        method: 'GET',
        url: `${DRIVE}/files/${path(fileId)}?alt=media`,
        idempotent: true,
        timeoutMs: CHUNK_TIMEOUT_MS,
      });
      if (response.status === 404) return null;
      if (!response.ok) return failResponse('downloadFile', response);
      return {
        mime: meta.mimeType,
        size: Number(meta.size ?? response.headers.get('content-length') ?? 0),
        body: (response.body ??
          new ReadableStream({
            start: (controller) => controller.close(),
          })) as ReadableStream<Uint8Array>,
      };
    },

    async deleteFile(fileId) {
      if (!isDriveId(fileId)) return;
      const meta = await getMeta('deleteFile', fileId);
      if (meta === null) return;
      // Hanya berkas BUATAN SENDIRI (dimiliki service account) di folder yang diizinkan yang boleh dihapus permanen.
      if (meta.ownedByMe !== true) {
        console.error('Klien Google menolak deleteFile: berkas bukan milik service account');
        throw denied();
      }
      await assertManaged(meta);
      const response = await http.request({
        op: 'deleteFile',
        method: 'DELETE',
        url: `${DRIVE}/files/${path(fileId)}`,
        idempotent: true,
      });
      if (response.status !== 404 && !response.ok) await failResponse('deleteFile', response);
    },

    async storageQuota(): Promise<DriveStorageQuota> {
      const response = await http.request({
        op: 'storageQuota',
        method: 'GET',
        url: `${DRIVE}/about?fields=storageQuota`,
        idempotent: true,
      });
      if (!response.ok) return failResponse('storageQuota', response);
      const { storageQuota } = (await response.json()) as {
        storageQuota?: { limit?: string; usage?: string };
      };
      return {
        limit: storageQuota?.limit === undefined ? null : Number(storageQuota.limit),
        usage: Number(storageQuota?.usage ?? 0),
      };
    },
  };
}
