import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LinkField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { Select } from '@/components/select';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { buIdsWithLevelOf } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL, STATUS_OPTIONS } from '../lib/labels';
import {
  commitSearchLine,
  mergeScanned,
  normalizeSearchText,
  SERIAL_SEARCH_MAX,
  type SerialSearch,
} from '../lib/list-filter';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import { useSerialLocations } from '../lib/use-serial-locations';
import { serialItemOptionsQueryOptions } from '../queries';
import { CameraScanButton } from './camera-scan-button';
import { SerialLocationField } from './serial-location-field';

export interface SerialFiltersProps {
  search: SerialSearch;
  onChange: (patch: Partial<SerialSearch>) => void;
  /** Pemegang `serial: manage`: chip "Tampilan" (Hidup/Terhapus) tampil. */
  canSeeDeleted?: boolean;
}

/** Bentuk teks pencarian yang dikirim ke URL (gema URL yang sama tidak menimpa teks mentah yang sedang diedit). */
const normalizeSearchTextValue = (value: string) => normalizeSearchText(value).text;

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'Semua status' }, ...STATUS_OPTIONS];

const CUSTODY_FILTER_OPTIONS = [
  { value: '', label: 'Semua posisi' },
  ...(Object.keys(CUSTODY_LABEL) as (keyof typeof CUSTODY_LABEL)[]).map((value) => ({
    value,
    label: CUSTODY_LABEL[value],
  })),
];

/**
 * Filter daftar serial: pencarian banyak serial (tempel atau pindai; kolom sendiri karena `FilterBar.search` satu baris)
 * dan chip untuk BU, item, lokasi, status, posisi, tanggal uji, "Dicatat oleh saya", dan (bagi pemegang `serial: manage`)
 * tampilan Hidup/Terhapus.
 */
export function SerialFilters({ search, onChange, canSeeDeleted = false }: SerialFiltersProps) {
  const me = useMe();
  // BU yang boleh dibaca akun (serial atau serialservice, level view ke atas), disaring di klien.
  const readableBuIds = new Set([
    ...buIdsWithLevelOf(me, 'serial', 'view'),
    ...buIdsWithLevelOf(me, 'serialservice', 'view'),
  ]);
  const buOptions: LinkOption[] = (me.businessUnits ?? [])
    .filter((bu) => !bu.deleted && readableBuIds.has(bu.id))
    .map((bu) => ({ id: bu.id, label: `${bu.code} · ${bu.name}` }));
  const [itemTerm, setItemTerm] = useState('');
  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(itemTerm.trim()));
  const itemOptions: LinkOption[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  const [text, setText] = useUrlSyncedText(
    search.sn ?? '',
    (value) => onChange({ sn: normalizeSearchText(value).text || undefined }),
    undefined,
    { normalize: normalizeSearchTextValue },
  );
  const normalized = normalizeSearchText(text);

  // Teks terkini yang selalu terbaca sinkron: beberapa bacaan kamera dapat tiba sebelum render ulang.
  const textRef = useRef(text);
  textRef.current = text;
  const { feedback, announce } = useScanFeedback();

  function applyText(next: string) {
    textRef.current = next;
    setText(next);
  }

  // Hasil kamera (satu atau banyak serial, satu per baris) ditambahkan ke daftar pencarian tanpa duplikat.
  function scan(input: string): ScanFeedback {
    const { text: next, feedback: result } = mergeScanned(textRef.current, input);
    if (next !== textRef.current) applyText(next);
    return result;
  }

  // Enter (juga penutup bacaan pemindai fisik) menetapkan baris tempat kursor berada lewat `commitSearchLine`; baris lain
  // tidak disentuh. Umpan balik sama dengan kolom pindai (nada, getar, kilat).
  function commitCurrentLine(field: HTMLTextAreaElement): boolean {
    const value = textRef.current;
    const result = commitSearchLine(value, field.selectionStart ?? value.length);
    if (result === null) return false;
    // Render sinkron lalu kursor diatur langsung: tidak bergantung pada ada-tidaknya perubahan state (teks dan umpan
    // balik bisa sama dengan sebelumnya, mis. Enter berturut-turut pada baris yang sudah normal).
    flushSync(() => {
      announce(result.feedback);
      applyText(result.text);
    });
    field.setSelectionRange(result.caret, result.caret);
    return true;
  }

  const { locations: knownLocations } = useSerialLocations();
  const buLabel = (id: string) =>
    buOptions.find((option) => option.id === id)?.label ?? 'BU tidak dikenal';
  const locationName = (id: string) =>
    knownLocations.find((location) => location.id === id)?.name ?? 'Lokasi tidak dikenal';
  const viewOptions = liveStatusFilterOptions(canSeeDeleted);
  const dateDisplay =
    search.from || search.to
      ? `${search.from ? formatDay(search.from) : '…'} – ${search.to ? formatDay(search.to) : '…'}`
      : null;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="serial-search">Cari serial (satu per baris)</Label>
          <div className="flex items-center gap-2">
            <span
              aria-live="polite"
              className={cn('text-xs', feedback ? FEEDBACK_TEXT_COLOR[feedback] : '')}
            >
              {feedback ? FEEDBACK_TEXT[feedback] : ''}
            </span>
            <CameraScanButton onScan={scan} />
          </div>
        </div>
        <Textarea
          id="serial-search"
          rows={1}
          // Satu baris saat kosong (bar judul tetap pendek); tumbuh mengikuti isi sampai ±4 baris, lalu menggulir.
          className={cn(
            'max-h-28 min-h-9 touch:min-h-11 overflow-y-auto font-mono transition-colors',
            feedback !== null && FEEDBACK_FLASH[feedback],
          )}
          spellCheck={false}
          autoComplete="off"
          placeholder="Satu serial: cocok awalan. Beberapa serial: cocok persis."
          value={text}
          onChange={(event) => applyText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commitCurrentLine(event.currentTarget);
              return;
            }
            // Banyak pemindai menutup bacaan dengan Tab (seperti di SerialScanInput): dianggap terminator HANYA bila
            // baris yang sedang ditulis tidak kosong; Tab pada baris kosong dan Shift+Tab memindahkan fokus seperti biasa.
            if (event.key === 'Tab' && !event.shiftKey && commitCurrentLine(event.currentTarget)) {
              event.preventDefault();
            }
          }}
        />
        {normalized.capped || normalized.count > 0 ? (
          <p
            className={
              normalized.capped ? 'text-xs text-destructive-text' : 'text-xs text-muted-foreground'
            }
            role={normalized.capped ? 'alert' : undefined}
          >
            {normalized.capped
              ? normalized.tooLong
                ? `Daftar terlalu panjang untuk satu pencarian: hanya ${normalized.count} serial pertama yang dicari, ${normalized.dropped} serial lain diabaikan. Bagi pencarian menjadi beberapa kali.`
                : `Terlalu banyak serial: hanya ${SERIAL_SEARCH_MAX} serial pertama yang dicari, ${normalized.dropped} serial lain diabaikan. Bagi pencarian menjadi beberapa kali.`
              : `${normalized.count} serial dicari (maks. ${SERIAL_SEARCH_MAX})`}
          </p>
        ) : null}
      </div>
      <FilterBar>
        <FilterChip
          label="BU"
          display={search.bu ? buLabel(search.bu) : null}
          onClear={() => onChange({ bu: undefined })}
        >
          <LinkField
            id="serial-filter-bu"
            label="Filter BU"
            hideLabel
            placeholder="Semua BU"
            localFilter
            value={search.bu ?? null}
            labelOf={buLabel}
            options={buOptions}
            onChange={(id) => onChange({ bu: id ?? undefined })}
          />
          {search.bu ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Termasuk serial yang pernah di BU ini.
            </p>
          ) : null}
        </FilterChip>
        <FilterChip
          label="Item"
          display={search.item ? (search.itemLabel ?? search.item) : null}
          onClear={() => onChange({ item: undefined, itemLabel: undefined })}
        >
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
        </FilterChip>
        <FilterChip
          label="Lokasi"
          display={search.loc ? locationName(search.loc) : null}
          onClear={() => onChange({ loc: undefined })}
        >
          <SerialLocationField
            id="serial-filter-location"
            label="Filter lokasi"
            hideLabel
            placeholder="Semua lokasi"
            value={search.loc ?? ''}
            onChange={(id) => onChange({ loc: id === '' ? undefined : id })}
          />
        </FilterChip>
        <FilterChip
          label="Status"
          display={search.status ? STATUS_LABEL[search.status] : null}
          onClear={() => onChange({ status: undefined })}
        >
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
        </FilterChip>
        <FilterChip
          label="Posisi"
          display={search.custody ? CUSTODY_LABEL[search.custody] : null}
          onClear={() => onChange({ custody: undefined })}
        >
          <Select
            id="serial-filter-custody"
            label="Filter posisi"
            hideLabel
            options={CUSTODY_FILTER_OPTIONS}
            value={search.custody ?? ''}
            onValueChange={(next) =>
              onChange({ custody: next === '' ? undefined : (next as SerialSearch['custody']) })
            }
          />
        </FilterChip>
        <FilterChip
          label="Tanggal uji"
          display={dateDisplay}
          onClear={() => onChange({ from: undefined, to: undefined })}
        >
          <div className="space-y-3">
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
        </FilterChip>
        <FilterChip
          label="Pencatat"
          display={search.mine === true ? 'Saya' : null}
          onClear={() => onChange({ mine: undefined })}
        >
          <div className="flex items-center gap-2">
            <Checkbox
              id="serial-filter-mine"
              checked={search.mine === true}
              onCheckedChange={(on) => onChange({ mine: on === true ? true : undefined })}
            />
            <Label htmlFor="serial-filter-mine" className="font-normal">
              Dicatat oleh saya
            </Label>
          </div>
        </FilterChip>
        {viewOptions.length > 0 ? (
          <FilterChip
            label="Tampilan"
            display={search.deleted ? 'Terhapus' : null}
            onClear={() => onChange({ deleted: undefined })}
          >
            <Select
              id="serial-filter-view"
              label="Filter tampilan"
              hideLabel
              options={viewOptions}
              value={search.deleted ? 'deleted' : 'live'}
              onValueChange={(next) => onChange({ deleted: next === 'deleted' ? true : undefined })}
            />
          </FilterChip>
        ) : null}
      </FilterBar>
    </div>
  );
}
