import type { PostelDto, PostelSummaryDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';

/** Ringkasan daftar dari DTO lengkap (kondisi dan sisa hari milik nomor Aktif). */
export function toPostelSummary(postel: PostelDto): PostelSummaryDto {
  const active = postel.numbers.find((entry) => entry.role === 'active') ?? postel.numbers.at(-1);
  return {
    id: postel.id,
    name: postel.name,
    itemCount: postel.itemCount,
    activeNumber: active?.number ?? '',
    activeExpiresOn: active?.expiresOn ?? '',
    condition: active?.condition ?? 'expired',
    daysLeft: active?.daysLeft ?? 0,
    oldNumberCount: postel.numbers.filter((entry) => entry.role === 'old').length,
    numbers: postel.numbers.map((entry) => entry.number),
    models: distinctModels(postel),
    updatedAt: postel.updatedAt,
  };
}

/** Model berbeda (tanpa merk) dari item yang terlihat di DTO lengkap; daftar server dimuat ulang (cache ditandai basi). */
function distinctModels(postel: PostelDto): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of postel.items) {
    const key = normalizeKey(item.model);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    models.push(item.model);
  }
  return models;
}
