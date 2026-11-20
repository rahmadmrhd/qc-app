/** Tipe umum dialog berkas: tidak bergantung pada jenis berkas tertentu; sumber data disuntik lewat `FileLibrarySource`. */
export type LibrarySort = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'sizeDesc' | 'usageDesc';

export interface LibraryQuery {
  search: string;
  sort: LibrarySort;
  /** Hanya berkas yang diunggah pengguna ini. */
  mine: boolean;
  /** Hanya berkas yang belum dipakai. */
  unused: boolean;
}

export interface LibraryItem {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  uploadedBy: string;
  createdAt: string;
  usageCount: number;
  canRename: boolean;
  canRemove: boolean;
  thumbUrl: string;
  previewUrl: string;
}

export interface LibraryPage {
  items: LibraryItem[];
  nextCursor: string | null;
}

/** Tahap satu unggahan: pengecilan di klien, pengiriman byte, lalu menunggu server memproses (setelah byte penuh). */
export type UploadPhaseName = 'preparing' | 'uploading' | 'processing';

/** Konteks satu unggahan: pelapor progres dan pembatal. `fraction` null = tahap tanpa persen. */
export interface UploadContext {
  onProgress?(phase: UploadPhaseName, fraction: number | null): void;
  signal?: AbortSignal;
}

/** Sumber unggah: cukup untuk mengunggah satu berkas; pustaka (daftar, ubah nama, hapus) opsional lewat `FileLibrarySource`. */
export interface FileSource {
  /** Awalan kunci cache TanStack Query. */
  key: string;
  /** Format yang didukung sumber. */
  mimeTypes: readonly string[];
  /** Panjang maksimum nama (karakter); dipakai untuk nama awal dan kolom ubah nama. */
  nameMax?: number;
  /** Pembuatan thumbnail dan pengecilan terjadi DI DALAM adaptor. */
  upload(file: File, name: string, ctx?: UploadContext): Promise<LibraryItem>;
  /** Membuang hasil unggahan yang sudah naik tetapi tak jadi dipakai (upaya terbaik). */
  onDiscard?(items: readonly LibraryItem[]): void | Promise<void>;
}

export interface FileLibrarySource extends FileSource {
  list(query: LibraryQuery, cursor: string | null): Promise<LibraryPage>;
  rename(id: string, name: string): Promise<LibraryItem>;
  remove(id: string): Promise<void>;
}

export function isLibrarySource(source: FileSource): source is FileLibrarySource {
  const candidate = source as Partial<FileLibrarySource>;
  return (
    typeof candidate.list === 'function' &&
    typeof candidate.rename === 'function' &&
    typeof candidate.remove === 'function'
  );
}

/** Berkas yang ditolak saat masuk (nama + alasan siap tampil). */
export interface RejectedFile {
  name: string;
  reason: string;
}

/** Berkas yang lolos pemeriksaan dan menunggu diunggah. */
export interface QueuedFile {
  key: string;
  file: File;
  name: string;
}
