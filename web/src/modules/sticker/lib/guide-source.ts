import type { StickerGuideDto } from '@shared/contract';
import { IMAGE_MIME_TYPES } from '@shared/files';
import { GUIDE_LIMITS } from '@shared/stickers';
import type {
  FileLibrarySource,
  LibraryItem,
  LibraryPage,
  LibraryQuery,
} from '@/components/file-dialog/types';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/api/client';
import { prepareImage } from '@/modules/files/image';
import { prepareThumbnail } from '@/modules/files/thumbnail';
import { stickerKeys } from '../keys';

/**
 * Thumbnail dan gambar penuh dimuat langsung lewat `<img src>`: sesi lewat cookie same-origin dan respons
 * `immutable` di-cache peramban.
 */
export const guideThumbUrl = (id: string): string =>
  `${API_BASE}/sticker-guides/${encodeURIComponent(id)}/thumbnail`;
export const guidePreviewUrl = (id: string): string =>
  `${API_BASE}/files/${encodeURIComponent(id)}`;

function toLibraryItem(dto: StickerGuideDto): LibraryItem {
  return {
    id: dto.id,
    name: dto.name,
    size: dto.size,
    width: dto.width,
    height: dto.height,
    uploadedBy: dto.uploadedBy,
    createdAt: dto.createdAt,
    usageCount: dto.usageCount,
    canRename: dto.canRename,
    canRemove: dto.canRemove,
    thumbUrl: guideThumbUrl(dto.id),
    previewUrl: guidePreviewUrl(dto.id),
  };
}

/** Sumber `FileDialog` untuk pustaka gambar contoh stiker (rute REST `stickerGuides.*`). */
export const stickerGuideSource: FileLibrarySource = {
  key: stickerKeys.guides[0],
  mimeTypes: IMAGE_MIME_TYPES,
  nameMax: GUIDE_LIMITS.nameMax,
  async list(query: LibraryQuery, cursor: string | null): Promise<LibraryPage> {
    const page = await api('stickerGuides.list', {
      sort: query.sort,
      ...(query.search !== '' ? { search: query.search } : {}),
      ...(query.mine ? { mine: true } : {}),
      ...(query.unused ? { unused: true } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return { items: page.items.map(toLibraryItem), nextCursor: page.nextCursor };
  },
  async upload(file, name) {
    // Berurutan (bukan paralel): dua decode gambar besar sekaligus memboroskan memori ponsel.
    const image = await prepareImage(file);
    const thumbnail = await prepareThumbnail(file);
    const dto = await api('stickerGuides.upload', {
      name,
      mime: image.mime,
      thumbMime: thumbnail.mime,
      width: image.width,
      height: image.height,
      image: image.bytes,
      thumbnail: thumbnail.bytes,
    });
    return toLibraryItem(dto);
  },
  async rename(id, name) {
    return toLibraryItem(await api('stickerGuides.rename', { id, name }));
  },
  async remove(id) {
    await api('stickerGuides.remove', { id });
  },
};
