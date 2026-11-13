import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface BrandDetailViewProps {
  /** `undefined` = merk tidak ada (id salah atau sudah dihapus). */
  brand: BrandDto | undefined;
  businessUnits: readonly BusinessUnitOptionDto[];
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

/** Halaman baca-saja satu merk: tujuan tautan "buka" dari field Merk. */
export function BrandDetailView({ brand, businessUnits, onBack }: BrandDetailViewProps) {
  if (!brand) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Merk tidak ditemukan</h1>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar merk
        </Button>
      </div>
    );
  }
  const defaults = brand.businessUnitIds.map(
    (id) => businessUnits.find((bu) => bu.id === id) ?? { id, code: id, name: id },
  );
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{brand.name}</h1>
          {brand.status === 'inactive' ? <Badge variant="secondary">Nonaktif</Badge> : null}
        </div>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar merk
        </Button>
      </div>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Informasi merk</h2>
        <dl className="space-y-2">
          <Row label="Jumlah item">{brand.itemCount}</Row>
          <Row label="BU bawaan">
            {defaults.length === 0 ? (
              <span className="text-muted-foreground">Tidak ada</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {defaults.map((bu) => (
                  <Badge key={bu.id} variant="outline" title={bu.name}>
                    {bu.code}
                  </Badge>
                ))}
              </span>
            )}
          </Row>
          <Row label="Terakhir diubah">{new Date(brand.updatedAt).toLocaleString('id-ID')}</Row>
        </dl>
      </section>
    </div>
  );
}
