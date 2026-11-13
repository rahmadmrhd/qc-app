import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isInactiveTarget, markLabel } from '../lib/sticker-instructions';

/** Jumlah saran maksimum pada daftar pilihan; sisanya dicari dengan mengetik. */
const OPTION_LIMIT = 50;

export interface MarkRowProps {
  /** Urutan penanda pada foto (mulai 0); nomor tampil = `index + 1`, sama dengan nomor pada kanvas. */
  index: number;
  mark: ItemStickerMarkDto;
  /** Katalog stiker dan jenis: sumber saran (hanya yang aktif) dan label sasaran tersimpan (termasuk nonaktif). */
  stickerOptions: readonly StickerDto[];
  typeOptions: readonly StickerTypeDto[];
  onChange: (mark: ItemStickerMarkDto) => void;
  onRemove: () => void;
  /** Baris Tambah pada daftar saran hanya muncul bila disediakan (user berizin menambah stiker/jenis). */
  onCreateSticker?: () => void;
  onCreateType?: () => void;
  /** Baris ini penanda yang sedang dipilih (disorot). */
  selected?: boolean;
  /** Fokus masuk ke baris: pilih penandanya (sinkron dengan kanvas). */
  onSelect?: () => void;
  /** Pesan galat baris (mis. dari skema form atau server). */
  error?: string | undefined;
  disabled?: boolean;
}

function stickerLabelOptions(
  stickers: readonly StickerDto[],
  types: readonly StickerTypeDto[],
  term: string,
) {
  const key = normalizeKey(term);
  // Stiker jenis sistem (Manual Book, Postel) tidak dipilih manual: diterjemahkan otomatis lewat jenisnya.
  const systemTypeIds = new Set(types.filter((type) => type.systemKind !== '').map((t) => t.id));
  const matches = stickers.filter(
    (sticker) =>
      sticker.status === 'active' &&
      !systemTypeIds.has(sticker.typeId) &&
      (key === '' ||
        normalizeKey(`${sticker.name} ${sticker.alias} ${sticker.typeName}`).includes(key)),
  );
  const options: LinkOption[] = matches.slice(0, OPTION_LIMIT).map((sticker) => {
    const description = [sticker.alias, sticker.typeName].filter((part) => part !== '').join(' · ');
    return {
      id: sticker.id,
      label: sticker.name,
      ...(description !== '' ? { description } : {}),
    };
  });
  return { options, hasMore: matches.length > OPTION_LIMIT };
}

function typeLabelOptions(types: readonly StickerTypeDto[], term: string) {
  const key = normalizeKey(term);
  const matches = types.filter(
    (type) => type.status === 'active' && (key === '' || normalizeKey(type.name).includes(key)),
  );
  const options: LinkOption[] = matches
    .slice(0, OPTION_LIMIT)
    .map((type) => ({ id: type.id, label: type.name }));
  return { options, hasMore: matches.length > OPTION_LIMIT };
}

/**
 * Baris penanda di bawah foto: jalur utama (papan ketik, layar kecil) untuk memilih sasaran (stiker tertentu atau jenis
 * stiker, keduanya LinkField), mengisi catatan, dan menghapus penanda. Pilihan baru hanya stiker/jenis aktif; sasaran
 * tersimpan yang kemudian nonaktif tetap tampil dengan tanda "— nonaktif".
 */
export function MarkRow({
  index,
  mark,
  stickerOptions,
  typeOptions,
  onChange,
  onRemove,
  onCreateSticker,
  onCreateType,
  selected,
  onSelect,
  error,
  disabled,
}: MarkRowProps) {
  const id = useId();
  const number = index + 1;
  const [stickerTerm, setStickerTerm] = useState('');
  const [typeTerm, setTypeTerm] = useState('');
  const { target } = mark;

  function setMode(kind: 'sticker' | 'type') {
    if (target.kind === kind) return;
    onChange({
      ...mark,
      target: kind === 'sticker' ? { kind, stickerId: '' } : { kind, typeId: '' },
    });
  }

  const inactiveTarget = isInactiveTarget(target, stickerOptions, typeOptions);
  const sticker = stickerLabelOptions(stickerOptions, typeOptions, stickerTerm);
  const type = typeLabelOptions(typeOptions, typeTerm);

  return (
    <fieldset
      aria-label={`Baris penanda ${number}`}
      data-selected={selected ? 'true' : undefined}
      data-inactive-target={inactiveTarget ? 'true' : undefined}
      className="space-y-2 rounded-lg border p-2 data-[selected=true]:border-ring data-[selected=true]:ring-2 data-[selected=true]:ring-ring/50"
      onFocus={() => onSelect?.()}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {number}
        </span>
        <div
          role="radiogroup"
          aria-label={`Sasaran penanda ${number}`}
          className="flex flex-wrap gap-x-3 gap-y-1 text-sm"
        >
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={target.kind === 'sticker'}
              disabled={disabled}
              onChange={() => setMode('sticker')}
            />
            Stiker tertentu
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={target.kind === 'type'}
              disabled={disabled}
              onChange={() => setMode('type')}
            />
            Jenis
          </label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-7 shrink-0"
          aria-label={`Hapus penanda ${number}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      {target.kind === 'sticker' ? (
        <LinkField
          id={`${id}-sticker`}
          label="Stiker"
          placeholder="Cari stiker"
          value={target.stickerId === '' ? null : target.stickerId}
          labelOf={(stickerId) =>
            markLabel({ kind: 'sticker', stickerId }, stickerOptions, typeOptions)
          }
          options={sticker.options}
          hasMore={sticker.hasMore}
          searchDebounceMs={0}
          onSearchChange={setStickerTerm}
          {...(onCreateSticker ? { onCreate: onCreateSticker } : {})}
          disabled={disabled}
          onChange={(stickerId) =>
            onChange({ ...mark, target: { kind: 'sticker', stickerId: stickerId ?? '' } })
          }
        />
      ) : (
        <LinkField
          id={`${id}-type`}
          label="Jenis"
          placeholder="Cari jenis stiker"
          value={target.typeId === '' ? null : target.typeId}
          labelOf={(typeId) => markLabel({ kind: 'type', typeId }, stickerOptions, typeOptions)}
          options={type.options}
          hasMore={type.hasMore}
          searchDebounceMs={0}
          onSearchChange={setTypeTerm}
          {...(onCreateType ? { onCreate: onCreateType } : {})}
          disabled={disabled}
          onChange={(typeId) =>
            onChange({ ...mark, target: { kind: 'type', typeId: typeId ?? '' } })
          }
        />
      )}
      <Input
        aria-label={`Catatan penanda ${number}`}
        aria-invalid={error && /catatan/i.test(error) ? true : undefined}
        placeholder="Catatan penanda (opsional)"
        value={mark.note}
        disabled={disabled}
        onChange={(event) => onChange({ ...mark, note: event.target.value })}
      />
      {inactiveTarget ? (
        <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
          {target.kind === 'sticker' ? 'Stiker' : 'Jenis'} nonaktif: simpan akan ditolak bila
          penanda ini baru bagi item. Pilih sasaran lain.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
