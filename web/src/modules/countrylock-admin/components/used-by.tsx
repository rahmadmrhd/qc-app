import type { ClFileDto } from '@shared/contract';

/**
 * Keterangan "dipakai oleh" untuk berkas router: kode firmware yang skripnya merujuk `/temp/<nama berkas>`. Hanya untuk
 * berkas role `router` (server tidak mengisi `usedBy` untuk berkas lain); kosong berarti belum dirujuk skrip mana pun.
 */
export function UsedBy({ file }: { file: Pick<ClFileDto, 'role' | 'usedBy'> }) {
  if (file.role !== 'router' || file.usedBy === undefined) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {file.usedBy.length === 0
        ? 'Belum dirujuk skrip mana pun'
        : `Dipakai oleh: ${file.usedBy.join(', ')}`}
    </span>
  );
}
