import type { WarehouseHandoverCandidateDto } from '@shared/contract';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { useQuery } from '@tanstack/react-query';
import { type JSX, useEffect, useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatStamp } from '@/lib/format-stamp';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { type WarehouseCandidatesFilter, warehouseCandidatesQueryOptions } from '../queries';

export interface HandoverLinkPickerProps {
  customerId?: string;
  customerName?: string;
  orderId?: string;
  itemId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Task asal (`?handover`): tercentang dan tak dapat dilepas. */
  lockedIds?: string[];
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Pemilih task Serah Terima untuk ditautkan ke SO. Tanpa customer: petunjuk "Isi customer dulu" + kolom cari. Dengan
 * customer: task yang sudah tertaut ke SO (`linked`) di atas, lalu paling banyak 5 task berjalan milik customer itu
 * (`mentionsItem` diberi lencana). TANPA centang otomatis: nilai sepenuhnya dikendalikan `value`. Task asal
 * (`lockedIds`) selalu tercentang dan tak dapat dilepas; paling banyak `handoverLinksMax` (20) task.
 */
export function HandoverLinkPicker({
  customerId = '',
  customerName = '',
  orderId,
  itemId,
  value,
  onChange,
  lockedIds = [],
}: HandoverLinkPickerProps): JSX.Element {
  const uid = useId();
  const hasCustomer = customerId !== '' || customerName.trim() !== '';
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [includeFinished, setIncludeFinished] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const filter: WarehouseCandidatesFilter = {
    ...(customerId !== '' ? { customerId } : {}),
    ...(customerId === '' && customerName.trim() !== ''
      ? { customerName: customerName.trim() }
      : {}),
    ...(term !== '' ? { query: term } : {}),
    ...(includeFinished ? { includeFinished: true } : {}),
    ...(orderId ? { orderId } : {}),
    ...(itemId ? { itemId } : {}),
  };
  const candidates = useQuery(warehouseCandidatesQueryOptions(filter, hasCustomer || term !== ''));

  const locked = new Set(lockedIds);
  const selected = new Set([...value, ...lockedIds]);
  const rows: WarehouseHandoverCandidateDto[] = [];
  const seen = new Set<string>();
  for (const row of [...(candidates.data?.linked ?? []), ...(candidates.data?.items ?? [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  // Pilihan yang tak ada di hasil (mis. task asal atau pilihan dari pencarian sebelumnya) tetap tampil agar dapat dilepas.
  const orphans = [...selected].filter((id) => !seen.has(id));
  const atLimit = selected.size >= WAREHOUSE_LIMITS.handoverLinksMax;

  function toggle(id: string, checked: boolean) {
    if (locked.has(id)) return;
    const next = checked
      ? [...new Set([...value, id])]
      : value.filter((existing) => existing !== id);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {hasCustomer ? null : (
        <p className="text-sm text-muted-foreground">
          Isi customer dulu supaya task Serah Terima-nya muncul, atau cari task lain di bawah.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-search`} className="text-xs text-muted-foreground">
          Cari task lain
        </Label>
        <Input
          id={`${uid}-search`}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Nomor task atau isi catatan"
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${uid}-finished`}
          checked={includeFinished}
          onCheckedChange={(next) => setIncludeFinished(next === true)}
        />
        <Label htmlFor={`${uid}-finished`} className="text-sm font-normal">
          Tampilkan yang sudah selesai
        </Label>
      </div>

      {candidates.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          Daftar task tidak dapat dimuat.
        </p>
      ) : candidates.isPending && candidates.fetchStatus !== 'idle' ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : rows.length === 0 && orphans.length === 0 ? (
        hasCustomer || term !== '' ? (
          <p className="text-sm text-muted-foreground">
            Tidak ada task berjalan untuk customer ini
          </p>
        ) : null
      ) : (
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
                <Label
                  htmlFor={`${uid}-${row.id}`}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 font-normal"
                >
                  <span className="flex flex-wrap items-center gap-2">
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
                  </span>
                  {row.preview ? (
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {row.preview}
                    </span>
                  ) : null}
                </Label>
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
      )}
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          Paling banyak {WAREHOUSE_LIMITS.handoverLinksMax} task per SO.
        </p>
      ) : null}
    </div>
  );
}
