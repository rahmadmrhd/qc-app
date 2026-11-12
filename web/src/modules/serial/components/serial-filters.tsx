import { splitSerialInput } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { STATUS_OPTIONS } from '../lib/labels';
import { normalizeSearchText, SERIAL_SEARCH_MAX, type SerialSearch } from '../lib/list-filter';
import { serialItemOptionsQueryOptions } from '../queries';
import { SerialLocationField } from './serial-location-field';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';

export interface SerialFiltersProps {
  search: SerialSearch;
  onChange: (patch: Partial<SerialSearch>) => void;
}

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'Semua status' }, ...STATUS_OPTIONS];

/** Filter daftar serial: pencarian banyak serial (tempel atau pindai), item, lokasi, status, dan rentang tanggal uji. */
export function SerialFilters({ search, onChange }: SerialFiltersProps) {
  const [itemTerm, setItemTerm] = useState('');
  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(itemTerm.trim()));
  const itemOptions: LinkOption[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  const [text, setText] = useUrlSyncedText(search.sn ?? '', (value) =>
    onChange({ sn: normalizeSearchText(value).text || undefined }),
  );
  const normalized = normalizeSearchText(text);

  // Hasil pindai ditambahkan ke daftar pencarian (tanpa duplikat), lalu daftar diperbarui.
  function scan(input: string): ScanFeedback {
    const split = splitSerialInput(input);
    if (split.serials.length === 0) return 'rejected';
    const current = normalizeSearchText(text)
      .text.split('\n')
      .filter((line) => line !== '');
    const known = new Set(current);
    const added = split.serials.filter((serial) => !known.has(serial));
    if (added.length === 0) return 'duplicate';
    setText([...current, ...added].slice(0, SERIAL_SEARCH_MAX).join('\n'));
    return 'added';
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="serial-search">Cari serial (satu per baris)</Label>
          <Textarea
            id="serial-search"
            rows={3}
            className="font-mono"
            spellCheck={false}
            placeholder="Satu serial: cocok awalan. Beberapa serial: cocok persis."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {normalized.count > 0
              ? `${normalized.count} serial dicari${normalized.capped ? ` (dibatasi ${SERIAL_SEARCH_MAX})` : ''}`
              : 'Tempel banyak serial sekaligus atau pindai.'}
          </p>
        </div>
        <SerialScanInput id="serial-search-scan" label="Pindai untuk mencari" onSubmit={scan} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <LinkField
          id="serial-filter-item"
          label="Filter item"
          hideLabel
          placeholder="Semua item"
          value={search.item ?? null}
          labelOf={(id) => (id === search.item ? (search.itemLabel ?? id) : id)}
          options={itemOptions}
          loading={isFetching && data === undefined}
          hasMore={data?.nextCursor != null}
          onSearchChange={setItemTerm}
          searchDebounceMs={200}
          onChange={(id) =>
            onChange({
              item: id ?? undefined,
              itemLabel: id === null ? undefined : itemOptions.find((o) => o.id === id)?.label,
            })
          }
        />
        <SerialLocationField
          id="serial-filter-location"
          label="Filter lokasi"
          hideLabel
          placeholder="Semua lokasi"
          value={search.loc ?? ''}
          onChange={(id) => onChange({ loc: id === '' ? undefined : id })}
        />
        <Select
          id="serial-filter-status"
          label="Filter status"
          hideLabel
          options={STATUS_FILTER_OPTIONS}
          value={search.status ?? ''}
          onValueChange={(next) =>
            onChange({ status: next === '' ? undefined : (next as SerialSearch['status']) })
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor="serial-filter-from" className="text-xs text-muted-foreground">
            Tanggal uji dari
          </Label>
          <Input
            id="serial-filter-from"
            type="date"
            value={search.from ?? ''}
            onChange={(event) => onChange({ from: event.target.value || undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="serial-filter-to" className="text-xs text-muted-foreground">
            Tanggal uji sampai
          </Label>
          <Input
            id="serial-filter-to"
            type="date"
            value={search.to ?? ''}
            onChange={(event) => onChange({ to: event.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
