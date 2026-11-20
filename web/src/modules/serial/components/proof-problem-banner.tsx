import type { SerialProofPhotoDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatDay } from '../lib/labels';
import { EnsureProofReplace, useProofReplace } from '../lib/proof-replace-context';
import { proofThumbUrl } from '../lib/proof-source';
import { earliestProofExpiry } from '../lib/proof-state';
import { usePendingReplaceIds } from '../queries';
import { ProofReplaceDialog, ProofReplaceStatus } from './proof-replace-dialog';

export interface ProofProblemBannerProps {
  /** `SerialSummaryDto.proofProblemCount`: jumlah foto gagal entri ini (sumber angka resmi). */
  count: number;
  /** `GetSerialOutput.problemPhotos`: semua foto gagal entri ini (terlepas dari kejadian yang terpotong). */
  photos: readonly SerialProofPhotoDto[];
}

/**
 * Banner di detail Serial Number bila ada foto bukti QC yang gagal diproses: terlihat oleh semua pembaca entri,
 * meminta unggah ulang sebelum foto dibuang otomatis (batas terdekat). Tombol "Unggah ulang" hanya untuk foto yang
 * `canManage` bagi pengguna ini; satu baris per foto agar jelas foto mana yang diganti.
 */
export function ProofProblemBanner(props: ProofProblemBannerProps) {
  return (
    <EnsureProofReplace>
      <ProofProblemBannerBody {...props} />
    </EnsureProofReplace>
  );
}

function ProofProblemBannerBody({ count, photos }: ProofProblemBannerProps) {
  const failed = photos;
  const total = Math.max(count, failed.length);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const replacingIds = usePendingReplaceIds();
  const proofReplace = useProofReplace();
  if (total <= 0) return null;
  const expiry = earliestProofExpiry(failed);
  const manageable = failed.filter((photo) => photo.canManage);
  const replacing = failed.find((photo) => photo.id === replacingId) ?? null;
  // Unggahan dan penggantian dipegang hook di komponen ini: foto gagal lama tetap tampil sampai `replace` berhasil.
  return (
    <Alert color="destructive" role="region" aria-label="Foto bukti QC bermasalah" className="p-4">
      <div className="space-y-3 text-foreground">
        <p className="text-sm">
          <span>
            <span className="font-medium">{`Foto bukti QC bermasalah (${total} foto).`}</span>{' '}
            {expiry
              ? `Segera unggah ulang sebelum dibuang otomatis pada ${formatDay(wibDateIso(Date.parse(expiry)))}.`
              : 'Segera unggah ulang sebelum dibuang otomatis.'}
          </span>
        </p>
        {manageable.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {manageable.map((photo) => {
              const replaceState = proofReplace.stateOf(photo.id);
              const uploading =
                replaceState.entry !== null && replaceState.entry.phase !== 'failed';
              return (
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
                    disabled={replacingIds.has(photo.id) || uploading}
                    onClick={() => {
                      setReplacingId(photo.id);
                      setOpen(true);
                    }}
                  >
                    Unggah ulang
                  </Button>
                  <ProofReplaceStatus
                    state={replaceState}
                    replacing={replacingIds.has(photo.id)}
                    onCancel={() => proofReplace.cancel(photo.id)}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        <ProofReplaceDialog
          open={open && replacing !== null}
          onOpenChange={setOpen}
          onPicked={(files) => {
            if (replacing) proofReplace.start(replacing.id, files);
          }}
        />
      </div>
    </Alert>
  );
}
