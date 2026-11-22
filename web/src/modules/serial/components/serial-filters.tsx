import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { MultiSelect } from '@/components/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
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
  searchLists,
} from '../lib/list-filter';
import { toLocationOptions } from '../lib/locations';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import { useSerialLocations } from '../lib/use-serial-locations';
import { serialItemOptionsQueryOptions, serialItemsByIdQueryOptions } from '../queries';
import { CameraScanButton } from './camera-scan-button';

export interface SerialFiltersProps {
  search: SerialSearch;
  onChange: (patch: Partial<SerialSearch>) => void;
  /** Pemegang `serial: manage`: pilihan "Terhapus" tampil pada chip Status. */
  canSeeDeleted?: boolean;
}

/** Bentuk teks pencarian yang dikirim ke URL (gema URL yang sama tidak menimpa teks mentah yang sedang diedit). */
const normalizeSearchTextValue = (value: string) => normalizeSearchText(value).text;

/** Nilai khusus pada chip Status: tampilan Terhapus (param `deleted`), eksklusif terhadap status alur. */
const DELETED_VIEW = 'deleted';

/**
 * "Terhapus" eksklusif terhadap status alur: dipilih belakangan = hanya Terhapus; status alur dipilih belakangan =
 * tanpa Terhapus. Berlaku pada draf chip, jadi pilihan yang tampil selalu sama dengan yang akan diterapkan.
 */
function exclusiveDeleted(next: string[], previous: readonly string[]): string[] {
  if (!next.includes(DELETED_VIEW)) return next;
  if (!previous.includes(DELETED_VIEW)) return [DELETED_VIEW];
  return next.filter((value) => value !== DELETED_VIEW);
}

const CUSTODY_FILTER_OPTIONS = (Object.keys(CUSTODY_LABEL) as (keyof typeof CUSTODY_LABEL)[]).map(
  (value) => ({ value, label: CUSTODY_LABEL[value] }),
);

/**
 * Filter daftar serial: pencarian banyak serial (tempel atau pindai; kolom sendiri karena `FilterBar.search` satu baris)
 * dan chip untuk BU, item, lokasi, status, posisi, tanggal uji, dan "Dicatat oleh saya". BU, item, lokasi, status, dan
 * posisi multi-value (salah satu dari). Chip Status juga memuat "Terhapus" bagi pemegang `serial: manage` (menggantikan
 * chip Tampilan; keputusan pemilik 2026-11-22): memilihnya mengosongkan status alur dan sebaliknya.
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
  const lists = searchLists(search);
  const [itemTerm, setItemTerm] = useState('');
  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(itemTerm.trim()));
  const itemOptions: LinkOption[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  // Label item terpilih: dari opsi yang pernah dimuat (diingat selama halaman terbuka), label tautan lama, atau dimuat
  // menurut id (setelah muat ulang halaman). Tanpa label tersimpan di URL.
  const itemLabels = useRef(new Map<string, string>());
  for (const option of itemOptions) itemLabels.current.set(option.id, option.label);
  if (search.item && search.itemLabel) itemLabels.current.set(search.item, search.itemLabel);
  const unlabeled = lists.itemIds.filter((id) => !itemLabels.current.has(id));
  const byId = useQuery({
    ...serialItemsByIdQueryOptions(unlabeled.slice(0, 50)),
    enabled: unlabeled.length > 0,
  });
  for (const item of byId.data?.items ?? []) itemLabels.current.set(item.id, item.label);
  const itemLabel = (id: string) => itemLabels.current.get(id) ?? 'Item tidak dikenal';
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
  const locationOptions = toLocationOptions(knownLocations);
  const locationName = (id: string) =>
    locationOptions.find((option) => option.id === id)?.label ?? 'Lokasi tidak dikenal';
  const statusOptions = [
    ...STATUS_OPTIONS,
    ...(canSeeDeleted ? [{ value: DELETED_VIEW, label: 'Terhapus' }] : []),
  ];
  const statusValue = search.deleted && canSeeDeleted ? [DELETED_VIEW] : lists.statuses;
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
          display={multiFilterDisplay(lists.buIds.map(buLabel))}
          onClear={() => onChange({ buIds: undefined, bu: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="serial-filter-bu"
            label="Filter BU"
            hideLabel
            placeholder="Semua BU"
            localFilter
            highlight
            value={lists.buIds}
            labelOf={buLabel}
            options={buOptions}
            onChange={(next) =>
              onChange({ buIds: next.length > 0 ? next : undefined, bu: undefined })
            }
          />
          {lists.buIds.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Termasuk serial yang pernah di BU ini.
            </p>
          ) : null}
        </FilterChip>
        <FilterChip
          label="Item"
          display={multiFilterDisplay(lists.itemIds.map(itemLabel))}
          onClear={() => onChange({ itemIds: undefined, item: undefined, itemLabel: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="serial-filter-item"
            label="Filter item"
            hideLabel
            placeholder="Semua item"
            value={lists.itemIds}
            labelOf={itemLabel}
            options={itemOptions}
            loading={isFetching && data === undefined}
            hasMore={data?.nextCursor != null}
            onSearchChange={setItemTerm}
            searchDebounceMs={200}
            onChange={(next) =>
              onChange({
                itemIds: next.length > 0 ? next : undefined,
                item: undefined,
                itemLabel: undefined,
              })
            }
          />
        </FilterChip>
        <FilterChip
          label="Lokasi"
          display={multiFilterDisplay(lists.locationIds.map(locationName))}
          onClear={() => onChange({ locationIds: undefined, loc: undefined })}
        >
          <LinkMultiField
            maxSelected={FILTER_LIST_MAX}
            id="serial-filter-location"
            label="Filter lokasi"
            hideLabel
            placeholder="Semua lokasi"
            localFilter
            highlight
            value={lists.locationIds}
            labelOf={locationName}
            options={locationOptions}
            onChange={(next) =>
              onChange({ locationIds: next.length > 0 ? next : undefined, loc: undefined })
            }
          />
        </FilterChip>
        <FilterChip
          label="Status"
          display={
            search.deleted && canSeeDeleted
              ? 'Terhapus'
              : multiFilterDisplay(lists.statuses.map((status) => STATUS_LABEL[status]))
          }
          onClear={() => onChange({ statuses: undefined, status: undefined, deleted: undefined })}
        >
          <MultiSelect
            maxSelected={FILTER_LIST_MAX}
            id="serial-filter-status"
            label="Filter status"
            hideLabel
            placeholder="Semua status"
            options={statusOptions}
            value={statusValue}
            reconcile={exclusiveDeleted}
            onValueChange={(next) => {
              // "Terhapus" eksklusif: dipilih belakangan = hanya Terhapus; status alur dipilih belakangan = tanpa Terhapus.
              const deletedNow = next.includes(DELETED_VIEW);
              const wasDeleted = search.deleted === true;
              if (deletedNow && !wasDeleted) {
                onChange({ deleted: true, statuses: undefined, status: undefined });
                return;
              }
              const statuses = next.filter((value) => value !== DELETED_VIEW);
              onChange({
                deleted: undefined,
                statuses: statuses.length > 0 ? (statuses as SerialSearch['statuses']) : undefined,
                status: undefined,
              });
            }}
          />
        </FilterChip>
        <FilterChip
          label="Posisi"
          display={multiFilterDisplay(lists.custodies.map((custody) => CUSTODY_LABEL[custody]))}
          onClear={() => onChange({ custodies: undefined, custody: undefined })}
        >
          <MultiSelect
            maxSelected={FILTER_LIST_MAX}
            id="serial-filter-custody"
            label="Filter posisi"
            hideLabel
            placeholder="Semua posisi"
            options={CUSTODY_FILTER_OPTIONS}
            value={lists.custodies}
            onValueChange={(next) =>
              onChange({
                custodies: next.length > 0 ? (next as SerialSearch['custodies']) : undefined,
                custody: undefined,
              })
            }
          />
        </FilterChip>
        <FilterChip
          label="Tanggal uji"
          display={dateDisplay}
          onClear={() => onChange({ from: undefined, to: undefined })}
        >
          <DateRangeFields
            from={search.from}
            to={search.to}
            onCommit={(range) => onChange({ from: range.from, to: range.to })}
          />
        </FilterChip>
        <FilterChip
          label="Pencatat"
          display={search.mine === true ? 'Saya' : null}
          onClear={() => onChange({ mine: undefined })}
        >
          <MineCheckbox mine={search.mine === true} onCommit={(mine) => onChange({ mine })} />
        </FilterChip>
      </FilterBar>
    </div>
  );
}

interface DateRange {
  from: string | undefined;
  to: string | undefined;
}

/** Dua kolom tanggal uji; di dalam chip ditahan sebagai SATU draf dan diterapkan sekali saat chip menutup. */
function DateRangeFields({
  from,
  to,
  onCommit,
}: {
  from: string | undefined;
  to: string | undefined;
  onCommit: (range: DateRange) => void;
}) {
  const [range, setRange] = useChipDraft<DateRange>(
    { from: from || undefined, to: to || undefined },
    onCommit,
  );
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="serial-filter-from" className="text-xs text-muted-foreground">
          Tanggal uji dari
        </Label>
        <Input
          id="serial-filter-from"
          type="date"
          value={range.from ?? ''}
          onChange={(event) => setRange({ ...range, from: event.target.value || undefined })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="serial-filter-to" className="text-xs text-muted-foreground">
          Tanggal uji sampai
        </Label>
        <Input
          id="serial-filter-to"
          type="date"
          value={range.to ?? ''}
          onChange={(event) => setRange({ ...range, to: event.target.value || undefined })}
        />
      </div>
    </div>
  );
}

/** Centang "Dicatat oleh saya"; di dalam chip ditahan sebagai draf dan diterapkan saat chip menutup. */
function MineCheckbox({
  mine,
  onCommit,
}: {
  mine: boolean;
  onCommit: (mine: true | undefined) => void;
}) {
  const [checked, setChecked] = useChipDraft<boolean>(mine, (next) =>
    onCommit(next ? true : undefined),
  );
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="serial-filter-mine"
        checked={checked}
        onCheckedChange={(on) => setChecked(on === true)}
      />
      <Label htmlFor="serial-filter-mine" className="font-normal">
        Dicatat oleh saya
      </Label>
    </div>
  );
}
