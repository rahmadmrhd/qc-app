import type { QcBridge } from '@countrylock/bridge-contract';
import type { CatalogItemDto, DesktopCatalogDto } from '@shared/desktop-catalog';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StickerInstructionsView } from '@/modules/item/components/sticker-instructions-view';
import { catalogImageUrl, type UseCatalog, useCatalog } from '../use-catalog';

const IMAGE_SOURCE = { guide: catalogImageUrl, sticker: catalogImageUrl } as const;

const itemLabel = (item: CatalogItemDto): string => `${item.brand} ${item.model}`;

/** Item yang cocok dengan pencarian (merk, model, atau nama lain; tak peka huruf besar/kecil). */
export function filterCatalogItems(
  items: readonly CatalogItemDto[],
  query: string,
): CatalogItemDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...items];
  return items.filter((item) =>
    [itemLabel(item), ...item.aliases].some((text) => text.toLowerCase().includes(needle)),
  );
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'belum pernah';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'belum pernah'
    : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusLine({ status }: { status: NonNullable<UseCatalog['status']> }) {
  if (status.state === 'syncing') return <span>Menyinkronkan katalog...</span>;
  return (
    <span>
      {status.itemCount} item · terakhir disinkronkan {formatSyncedAt(status.syncedAt)}
    </span>
  );
}

function StickerList({ catalog, item }: { catalog: DesktopCatalogDto; item: CatalogItemDto }) {
  const stickers = item.stickerIds.flatMap((id) => {
    const sticker = catalog.stickers.find((entry) => entry.id === id);
    return sticker ? [sticker] : [];
  });
  if (stickers.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada stiker yang berlaku.</p>;
  }
  return (
    <ul aria-label="Stiker yang berlaku" className="flex flex-wrap gap-2">
      {stickers.map((sticker) => (
        <li key={sticker.id} className="flex items-center gap-2 rounded-lg border p-2">
          {sticker.fileId ? (
            <img
              src={catalogImageUrl(sticker.fileId)}
              alt={`Contoh ${sticker.name}`}
              className="size-10 rounded-md border object-cover"
            />
          ) : null}
          <span className="text-sm">{sticker.alias !== '' ? sticker.alias : sticker.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Katalog Tipe offline (Data Item `isCountryLock` + instruksi penempelan stiker) yang disinkronkan proses utama dan
 * dibaca dari cache lokal: jalan tanpa login dan tanpa jaringan. Tidak tampil di peramban, di jembatan lama, atau pada
 * build desktop tanpa token katalog (Tipe tetap dipilih manual seperti biasa). Halaman Country Lock memakai
 * `CatalogPanelView` dengan katalog yang sama dengan dropdown Tipe di form; komponen ini untuk pemakaian mandiri.
 */
export function CatalogPanel({ bridge }: { bridge: QcBridge }) {
  const catalog = useCatalog(bridge);
  return <CatalogPanelView catalog={catalog} />;
}

export function CatalogPanelView({
  catalog,
  focusId = null,
}: {
  catalog: UseCatalog;
  /** Tipe yang dipilih di form inject: instruksinya ditampilkan otomatis (pengguna tetap bisa menjelajah yang lain). */
  focusId?: string | null;
}) {
  const { supported, snapshot, status, refreshing, refresh } = catalog;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = snapshot?.catalog.items;
  const filtered = useMemo(() => filterCatalogItems(items ?? [], query), [items, query]);

  useEffect(() => {
    if (focusId !== null) setSelectedId(focusId);
  }, [focusId]);

  if (!supported || status === null || status.state === 'disabled') return null;
  const selected = items?.find((item) => item.id === selectedId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Katalog Tipe (offline)</CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusLine status={status} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Sinkronkan katalog"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            Sinkronkan
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.state === 'error' ? (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            {status.error === 'REJECTED'
              ? 'Server menolak sinkron katalog (token tidak cocok atau katalog dinonaktifkan di server).'
              : 'Tidak dapat terhubung ke server. Katalog tersimpan terakhir tetap dipakai.'}
          </p>
        ) : null}
        {snapshot === null ? (
          <p className="text-sm text-muted-foreground">
            Katalog belum pernah tersinkron. Hubungkan ke server sekali untuk mengunduhnya.
          </p>
        ) : (
          <>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari merk, tipe, atau nama lain"
              aria-label="Cari Tipe"
            />
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada Tipe yang cocok.</p>
            ) : (
              <ul aria-label="Daftar Tipe" className="max-h-56 space-y-1 overflow-y-auto">
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.id === selectedId}
                      className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted aria-pressed:border-ring aria-pressed:bg-muted"
                      onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                    >
                      <span>{itemLabel(item)}</span>
                      <span className="flex shrink-0 gap-1">
                        {item.businessUnits.map((unit) => (
                          <Badge key={unit.id} variant="outline">
                            {unit.code}
                          </Badge>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && snapshot ? (
              <section
                className="space-y-3 border-t pt-3"
                aria-label={`Instruksi ${itemLabel(selected)}`}
              >
                <h3 className="font-medium">{itemLabel(selected)}</h3>
                <StickerList catalog={snapshot.catalog} item={selected} />
                <StickerInstructionsView
                  photos={selected.stickerPhotos}
                  canEdit={false}
                  editHref=""
                  multiBu={selected.businessUnits.length > 1}
                  imageSource={IMAGE_SOURCE}
                />
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
