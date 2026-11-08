import type { HandoverDto } from '@shared/contract';

/**
 * Tampilan sementara satu centang (update optimistis): HANYA butir `index` yang berubah (status turunan dan kolom
 * kartu tetap sampai server menjawab, agar kartu tidak melompat di tengah rentetan klik). Server tetap sumber
 * kebenaran (hasilnya menimpa setelah antrean kosong).
 */
export function applyOptimisticCheck(
  handover: HandoverDto,
  index: number,
  checked: boolean,
  by: string,
  at: string,
): HandoverDto {
  if (!handover.checklist.some((item) => item.index === index)) return handover;
  const checklist = handover.checklist.map((item) =>
    item.index === index
      ? { ...item, checked, by: checked ? by : '', at: checked ? at : '' }
      : item,
  );
  return { ...handover, checklist };
}
