import type { BusinessUnitDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface BusinessUnitDetailViewProps {
  /** `undefined` = BU tidak ada (id salah). */
  businessUnit: BusinessUnitDto | undefined;
  onBack: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Halaman baca-saja satu Business Unit: tujuan tautan "buka" dari field BU. */
export function BusinessUnitDetailView({ businessUnit, onBack }: BusinessUnitDetailViewProps) {
  if (!businessUnit) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">BU tidak ditemukan</h1>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar BU
        </Button>
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{businessUnit.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{businessUnit.code}</Badge>
            {businessUnit.status === 'inactive' ? (
              <Badge color="secondary" variant="soft" dot>
                Nonaktif
              </Badge>
            ) : null}
          </div>
        </div>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar BU
        </Button>
      </div>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Informasi BU</h2>
        <dl className="space-y-2">
          <Row label="Jumlah item">{businessUnit.itemCount}</Row>
          <Row label="User yang berhak">{businessUnit.userCount}</Row>
          <Row label="Dibuat">{new Date(businessUnit.createdAt).toLocaleString('id-ID')}</Row>
          <Row label="Terakhir diubah">
            {new Date(businessUnit.updatedAt).toLocaleString('id-ID')} oleh {businessUnit.updatedBy}
          </Row>
        </dl>
      </section>
    </div>
  );
}
