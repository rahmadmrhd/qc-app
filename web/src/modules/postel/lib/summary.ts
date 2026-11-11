import type { PostelDto, PostelSummaryDto } from '@shared/contract';

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
    updatedAt: postel.updatedAt,
  };
}

/** Urutan daftar: tanggal habis nomor Aktif menaik, lalu nama. */
export const comparePostels = (a: PostelSummaryDto, b: PostelSummaryDto) =>
  a.activeExpiresOn.localeCompare(b.activeExpiresOn) || a.name.localeCompare(b.name);
