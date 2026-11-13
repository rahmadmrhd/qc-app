import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { STATUS_OPTIONS } from '../lib/labels';
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
import { serialItemOptionsQueryOptions } from '../queries';
import { CameraScanButton } from './camera-scan-button';
import { SerialLocationField } from './serial-location-field';

export interface SerialFiltersProps {
  search: SerialSearch;
  onChange: (patch: Partial<SerialSearch>) => void;
}

/** Bentuk teks pencarian yang dikirim ke URL (gema URL yang sama tidak menimpa teks mentah yang sedang diedit). */
const normalizeSearchTextValue = (value: string) => normalizeSearchText(value).text;

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'Semua status' }, ...STATUS_OPTIONS];

/** Filter daftar serial: pencarian banyak serial (tempel atau pindai), item, lokasi, status, dan rentang tanggal uji. */
export function SerialFilters({ search, onChange }: SerialFiltersProps) {
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  // Kursor ditempatkan setelah teks baru dirender (Enter memindahkannya ke awal baris berikutnya).
  useLayoutEffect(() => {
    if (caretRef.current === null) return;
    fieldRef.current?.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

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
    announce(result.feedback);
    caretRef.current = result.caret;
    applyText(result.text);
    return true;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
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
          ref={fieldRef}
          rows={3}
          className={cn(
            'font-mono transition-colors',
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
        <p
          className={
            normalized.capped ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
          }
          role={normalized.capped ? 'alert' : undefined}
        >
          {normalized.capped
            ? normalized.tooLong
              ? `Daftar terlalu panjang untuk satu pencarian: hanya ${normalized.count} serial pertama yang dicari, ${normalized.dropped} serial lain diabaikan. Bagi pencarian menjadi beberapa kali.`
              : `Terlalu banyak serial: hanya ${SERIAL_SEARCH_MAX} serial pertama yang dicari, ${normalized.dropped} serial lain diabaikan. Bagi pencarian menjadi beberapa kali.`
            : normalized.count > 0
              ? `${normalized.count} serial dicari (maks. ${SERIAL_SEARCH_MAX})`
              : 'Ketik, tempel, scan (Enter), atau pakai kamera.'}
        </p>
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
