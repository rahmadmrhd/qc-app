/** Tipe umum dialog berkas: tidak bergantung pada jenis berkas tertentu; sumber data disuntik lewat `FileLibrarySource`. */
export type LibrarySort = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'sizeDesc';

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

export interface FileLibrarySource {
  /** Awalan kunci cache TanStack Query. */
  key: string;
  /** Format yang didukung sumber. */
  mimeTypes: readonly string[];
  /** Panjang maksimum nama (karakter); dipakai untuk nama awal dan kolom ubah nama. */
  nameMax?: number;
  list(query: LibraryQuery, cursor: string | null): Promise<LibraryPage>;
  /** Pembuatan thumbnail dan pengecilan terjadi DI DALAM adaptor. */
  upload(file: File, name: string): Promise<LibraryItem>;
  rename(id: string, name: string): Promise<LibraryItem>;
  remove(id: string): Promise<void>;
}
