import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isInactiveTarget, markLabel, typeTargetLabel } from '../lib/sticker-instructions';

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
  /**
   * Baris Tambah pada daftar saran hanya muncul bila disediakan (user berizin menambah stiker). Satu-satunya pintu:
   * membuka dialog tambah stiker katalog, tempat jenis baru juga dapat dibuat.
   */
  onCreateSticker?: () => void;
  /** Baris ini penanda yang sedang dipilih (disorot). */
  selected?: boolean;
  /** Fokus masuk ke baris: pilih penandanya (sinkron dengan kanvas). */
  onSelect?: () => void;
  /** Pesan galat baris (mis. dari skema form atau server). */
  error?: string | undefined;
  disabled?: boolean;
}

const STICKER_PREFIX = 's:';
const TYPE_PREFIX = 't:';

/** Satu daftar sasaran: Jenis (hanya yang beraturan) dulu, lalu Stiker (katalog eksplisit). */
function targetOptions(
  stickers: readonly StickerDto[],
  types: readonly StickerTypeDto[],
  term: string,
) {
  const key = normalizeKey(term);
  const typeMatches = types.filter(
    (type) =>
      type.status === 'active' &&
      type.rule !== 'none' &&
      (key === '' || normalizeKey(type.name).includes(key)),
  );
  // Stiker jenis sistem (Manual Book, Postel) tidak dipilih manual: diterjemahkan otomatis lewat jenisnya.
  const systemTypeIds = new Set(types.filter((type) => type.systemKind !== '').map((t) => t.id));
  const stickerMatches = stickers.filter(
    (sticker) =>
      sticker.status === 'active' &&
      !systemTypeIds.has(sticker.typeId) &&
      (key === '' ||
        normalizeKey(`${sticker.name} ${sticker.alias} ${sticker.typeName}`).includes(key)),
  );
  const all: LinkOption[] = [
    ...typeMatches.map((type) => ({
      id: `${TYPE_PREFIX}${type.id}`,
      label: typeTargetLabel(type),
    })),
    ...stickerMatches.map((sticker) => {
      const description = [sticker.alias, sticker.typeName]
        .filter((part) => part !== '')
        .join(' · ');
      return {
        id: `${STICKER_PREFIX}${sticker.id}`,
        label: sticker.name,
        ...(description !== '' ? { description } : {}),
      };
    }),
  ];
  return { options: all.slice(0, OPTION_LIMIT), hasMore: all.length > OPTION_LIMIT };
}

function targetValue(target: ItemStickerMarkDto['target']): string | null {
  if (target.kind === 'sticker') {
    return target.stickerId === '' ? null : `${STICKER_PREFIX}${target.stickerId}`;
  }
  return target.typeId === '' ? null : `${TYPE_PREFIX}${target.typeId}`;
}

function parseTargetValue(value: string | null): ItemStickerMarkDto['target'] {
  if (value?.startsWith(TYPE_PREFIX)) return { kind: 'type', typeId: value.slice(2) };
  if (value?.startsWith(STICKER_PREFIX)) return { kind: 'sticker', stickerId: value.slice(2) };
  return { kind: 'sticker', stickerId: '' };
}

/**
 * Baris penanda di bawah foto: jalur utama (papan ketik, layar kecil) untuk memilih sasaran lewat SATU LinkField
 * (Jenis dulu, lanjut Stiker), mengisi catatan, dan menghapus penanda. Pilihan baru hanya stiker/jenis aktif (jenis
 * tanpa aturan tidak ditawarkan); sasaran tersimpan yang kemudian nonaktif atau berjenis tanpa aturan tetap tampil
 * (nonaktif dengan tanda "— nonaktif").
 */
export function MarkRow({
  index,
  mark,
  stickerOptions,
  typeOptions,
  onChange,
  onRemove,
  onCreateSticker,
  selected,
  onSelect,
  error,
  disabled,
}: MarkRowProps) {
  const id = useId();
  const number = index + 1;
  const [term, setTerm] = useState('');
  const { target } = mark;

  const inactiveTarget = isInactiveTarget(target, stickerOptions, typeOptions);
  const choices = targetOptions(stickerOptions, typeOptions, term);

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
        <Button
          type="button"
          variant="ghost"
          color="primary"
          size="icon"
          className="ml-auto size-7 shrink-0"
          aria-label={`Hapus penanda ${number}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <LinkField
        id={`${id}-target`}
        label="Jenis atau stiker"
        placeholder="Cari jenis atau stiker"
        value={targetValue(target)}
        labelOf={(value) => markLabel(parseTargetValue(value), stickerOptions, typeOptions)}
        options={choices.options}
        hasMore={choices.hasMore}
        searchDebounceMs={0}
        onSearchChange={setTerm}
        {...(onCreateSticker ? { onCreate: onCreateSticker, createLabel: 'Stiker' } : {})}
        disabled={disabled}
        onChange={(value) => onChange({ ...mark, target: parseTargetValue(value) })}
      />
      <Input
        aria-label={`Catatan penanda ${number}`}
        aria-invalid={error && /catatan/i.test(error) ? true : undefined}
        placeholder="Catatan penanda (opsional)"
        value={mark.note}
        disabled={disabled}
        onChange={(event) => onChange({ ...mark, note: event.target.value })}
      />
      {inactiveTarget ? (
        <p role="status" className="text-sm text-warning-text">
          {target.kind === 'sticker' ? 'Stiker' : 'Jenis'} nonaktif: simpan akan ditolak bila
          penanda ini baru bagi item. Pilih sasaran lain.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
