import type { WarehouseHandoverCandidateDto } from '@shared/contract';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type JSX, type MutableRefObject, useEffect, useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatStamp } from '@/lib/format-stamp';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { type WarehouseCandidatesFilter, warehouseCandidatesQueryOptions } from '../queries';
import { CandidateNote, MarkLegend } from './candidate-note';

export interface HandoverLinkPickerProps {
  /**
   * Lokasi task. `undefined` = tanpa batas lokasi (semua lokasi terbaca; dipakai dialog "Tautkan task" pada detail SO);
   * string = daftar dibatasi lokasi itu dan TERKUNCI selama kosong (`''`).
   */
  locationId?: string;
  /** Hanya menyaring; tidak pernah dibutuhkan agar daftar muncul. */
  customerId?: string;
  customerName?: string;
  orderId?: string;
  itemId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Task asal (`?handover`): tercentang dan tak dapat dilepas. */
  lockedIds?: string[];
  /** Diisi dengan semua task yang pernah dimuat (id -> DTO), untuk konfirmasi kecocokan sebelum simpan. */
  registry?: MutableRefObject<Map<string, WarehouseHandoverCandidateDto>>;
  /** Dipanggil setelah `registry` bertambah isi. */
  onRegistryChange?: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = WAREHOUSE_LIMITS.candidatesMax;

/**
 * Pemilih task Serah Terima. Dengan `locationId` string: terkunci sampai lokasi terisi, lalu SEMUA task di lokasi itu
 * (Dibatalkan dan terhapus tidak) tampil berurutan menurut server (status lalu terbaru); customer hanya menyaring.
 * Tiap task menampilkan catatan ter-render hanya-baca dengan centang; baris yang menyebut Item terpilih ditandai hijau
 * dan yang menyebut Item lain kuning. TANPA centang otomatis: nilai sepenuhnya dikendalikan `value`. Task asal
 * (`lockedIds`) selalu tercentang dan tak dapat dilepas; paling banyak `handoverLinksMax` (20) task.
 */
export function HandoverLinkPicker({
  locationId,
  customerId = '',
  customerName = '',
  orderId,
  itemId,
  value,
  onChange,
  lockedIds = [],
  registry,
  onRegistryChange,
}: HandoverLinkPickerProps): JSX.Element {
  const uid = useId();
  const lockedByLocation = locationId !== undefined && locationId === '';
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const filter: WarehouseCandidatesFilter = {
    ...(locationId ? { locationId } : {}),
    ...(customerId !== '' ? { customerId } : {}),
    ...(customerId === '' && customerName.trim() !== ''
      ? { customerName: customerName.trim() }
      : {}),
    ...(term !== '' ? { query: term } : {}),
    ...(orderId ? { orderId } : {}),
    ...(itemId ? { itemId } : {}),
    limit: PAGE_SIZE,
  };
  const candidates = useInfiniteQuery(warehouseCandidatesQueryOptions(filter, !lockedByLocation));

  const locked = new Set(lockedIds);
  const selected = new Set([...value, ...lockedIds]);
  const rows: WarehouseHandoverCandidateDto[] = [];
  const seen = new Set<string>();
  // Urutan dari server dipertahankan: task tertaut di depan (halaman pertama), lalu daftar per halaman.
  const pages = candidates.data?.pages ?? [];
  for (const row of [
    ...pages.flatMap((page) => page.linked),
    ...pages.flatMap((page) => page.items),
  ]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` dibangun ulang tiap render; data dasarnya `candidates.data`
  useEffect(() => {
    if (!registry) return;
    let added = false;
    for (const row of rows) {
      if (!registry.current.has(row.id)) added = true;
      registry.current.set(row.id, row);
    }
    if (added) onRegistryChange?.();
  }, [candidates.data, registry, onRegistryChange]);
  // Pilihan yang tak ada di hasil (mis. task asal atau pilihan dari pencarian sebelumnya) tetap tampil agar dapat dilepas.
  const orphans = [...selected].filter((id) => !seen.has(id));
  const atLimit = selected.size >= WAREHOUSE_LIMITS.handoverLinksMax;
  const showLegend = itemId !== undefined && rows.length > 0;

  function toggle(id: string, checked: boolean) {
    if (locked.has(id)) return;
    const next = checked
      ? [...new Set([...value, id])]
      : value.filter((existing) => existing !== id);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {lockedByLocation ? (
        <p className="text-sm text-muted-foreground">
          Pilih Lokasi dulu supaya task Serah Terima di lokasi itu muncul.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-search`} className="text-xs text-muted-foreground">
          Cari task
        </Label>
        <Input
          id={`${uid}-search`}
          type="search"
          value={text}
          disabled={lockedByLocation}
          onChange={(event) => setText(event.target.value)}
          placeholder="Nomor task, customer, atau isi catatan"
        />
      </div>

      {lockedByLocation ? null : candidates.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          Daftar task tidak dapat dimuat.
        </p>
      ) : candidates.isPending && candidates.fetchStatus !== 'idle' ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : rows.length === 0 && orphans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {customerId !== '' || customerName.trim() !== ''
            ? 'Tidak ada task untuk customer ini di lokasi ini'
            : 'Tidak ada task di lokasi ini'}
        </p>
      ) : (
        <>
          {showLegend ? <MarkLegend /> : null}
          <ul className="divide-y rounded-md border" aria-label="Task Serah Terima">
            {rows.map((row) => {
              const checked = selected.has(row.id);
              const disabled = locked.has(row.id) || (!checked && atLimit);
              return (
                <li key={row.id} className="flex items-start gap-3 p-3">
                  <Checkbox
                    id={`${uid}-${row.id}`}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggle(row.id, next === true)}
                    aria-label={`Tautkan task ${row.number}`}
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label
                      htmlFor={`${uid}-${row.id}`}
                      className="flex flex-wrap items-center gap-2 font-normal"
                    >
                      <span className="font-medium">{row.number}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatStamp(row.createdAt)}
                      </span>
                      <HandoverStatusBadge status={row.status} />
                      {row.linked ? (
                        <Badge variant="soft" color="info">
                          Sudah tertaut
                        </Badge>
                      ) : null}
                      {row.mentionsItem ? (
                        <Badge variant="soft" color="success">
                          Menyebut Item ini
                        </Badge>
                      ) : null}
                      {locked.has(row.id) ? (
                        <Badge variant="outline" color="primary">
                          Task asal
                        </Badge>
                      ) : null}
                    </Label>
                    {row.note.trim() !== '' ? <CandidateNote candidate={row} /> : null}
                  </div>
                </li>
              );
            })}
            {orphans.map((id) => (
              <li key={id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={`${uid}-${id}`}
                  checked
                  disabled={locked.has(id)}
                  onCheckedChange={(next) => toggle(id, next === true)}
                  aria-label="Lepas task terpilih"
                />
                <Label htmlFor={`${uid}-${id}`} className="font-normal">
                  {locked.has(id) ? 'Task asal (terkunci)' : 'Task terpilih'}
                </Label>
              </li>
            ))}
          </ul>
          {candidates.hasNextPage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              color="primary"
              disabled={candidates.isFetchingNextPage}
              onClick={() => void candidates.fetchNextPage()}
            >
              {candidates.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
            </Button>
          ) : null}
        </>
      )}
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          Paling banyak {WAREHOUSE_LIMITS.handoverLinksMax} task per tautan.
        </p>
      ) : null}
    </div>
  );
}
