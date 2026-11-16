import type { SerialEventDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatDay } from '../lib/labels';
import { proofThumbUrl } from '../lib/proof-source';
import { earliestProofExpiry, failedProofPhotos } from '../lib/proof-state';
import { ProofReplaceDialog } from './proof-replace-dialog';

export interface ProofProblemBannerProps {
  /** `SerialSummaryDto.proofProblemCount`: jumlah foto gagal entri ini (sumber angka resmi). */
  count: number;
  /** Kejadian yang dimuat di detail: sumber foto gagal (batas buang dan tombol), tanpa permintaan tambahan. */
  events: readonly SerialEventDto[];
}

/**
 * Banner di detail Serial Number bila ada foto bukti QC yang gagal diproses: terlihat oleh semua pembaca entri,
 * meminta unggah ulang sebelum foto dibuang otomatis (batas terdekat). Tombol "Unggah ulang" hanya untuk foto yang
 * `canManage` bagi pengguna ini; satu baris per foto agar jelas foto mana yang diganti.
 */
export function ProofProblemBanner({ count, events }: ProofProblemBannerProps) {
  const failed = failedProofPhotos(events);
  const total = Math.max(count, failed.length);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (total <= 0) return null;
  const expiry = earliestProofExpiry(failed);
  const manageable = failed.filter((photo) => photo.canManage);
  const replacing = failed.find((photo) => photo.id === replacingId) ?? null;
  // Dialog tetap terpasang selama `replacing` ada; setelah penggantian fotonya hilang dari `failed` dan dialog ikut lepas.
  return (
    <section
      aria-label="Foto bukti QC bermasalah"
      className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
    >
      <p className="flex items-start gap-2 text-sm">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          <span className="font-medium">{`Foto bukti QC bermasalah (${total} foto).`}</span>{' '}
          {expiry
            ? `Segera unggah ulang sebelum dibuang otomatis pada ${formatDay(wibDateIso(Date.parse(expiry)))}.`
            : 'Segera unggah ulang sebelum dibuang otomatis.'}
        </span>
      </p>
      {manageable.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {manageable.map((photo) => (
            <li key={photo.id} className="flex items-center gap-2">
              <img
                src={proofThumbUrl(photo.id)}
                alt="Foto bermasalah"
                loading="lazy"
                className="size-10 rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setReplacingId(photo.id);
                  setOpen(true);
                }}
              >
                Unggah ulang
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {replacing ? (
        <ProofReplaceDialog photo={replacing} open={open} onOpenChange={setOpen} />
      ) : null}
    </section>
  );
}
