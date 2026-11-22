import { SERIAL_LIMITS } from '@shared/serials';
import { FieldError } from '@/components/field-error';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';

/** Satu baris stiker pada cek ulang: yang dicentang menambah SATU pada jumlah tempel serial itu. */
export interface RecheckStickerRow {
  stickerId: string;
  name: string;
  /** Jumlah yang sudah ditempel; 0 = belum pernah. */
  qty: number;
  /** Stiker `inactive` tidak dapat dicentang (`deprecated` boleh, spek §3 butir 24). */
  inactive: boolean;
  /**
   * Keterangan di bawah nama; bawaan mengikuti `qty`/`inactive`. Teks kosong menyembunyikannya (Tempel stiker massal:
   * daftar mewakili banyak serial, jadi jumlah tempel satu serial tidak berlaku).
   */
  hint?: string;
}

export interface RecheckStickerListProps {
  rows: readonly RecheckStickerRow[];
  /** Id yang dicentang; awalnya kosong. */
  checked: ReadonlySet<string>;
  onToggle: (stickerId: string, on: boolean) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** Judul daftar; bawaan teks cek ulang. Tempel stiker memakai teks yang tak menyebut "ulang". */
  legend?: string;
  /** Penjelasan di bawah judul; bawaan teks cek ulang. */
  description?: string;
  /** Awalan id checkbox; wajib berbeda bila beberapa daftar tampil bersamaan (Tempel stiker massal per kelompok). */
  idPrefix?: string;
}

const DEFAULT_LEGEND = 'Stiker yang ditempel ulang';
const DEFAULT_DESCRIPTION =
  'Centang stiker yang baru ditempel. Tiap centang menambah satu stiker dan memotong stok satu di lokasi unit ini.';

function stickerHint(row: RecheckStickerRow): string {
  if (row.inactive) return 'Stiker nonaktif: tidak bisa ditempel lagi';
  return row.qty > 0 ? `Sudah ditempel ${row.qty}×` : 'Belum pernah ditempel';
}

/**
 * Daftar centang stiker pada cek ulang (rancangan laporan rusak §4.2): tiap stiker yang dicentang menambah 1 pada
 * jumlah tempel dan memotong stok 1 di lokasi unit, termasuk stiker yang belum pernah ditempel. Dipakai juga oleh aksi
 * Tempel stiker (`legend`/`description` menyesuaikan teks).
 */
export function RecheckStickerList({
  rows,
  checked,
  onToggle,
  error,
  disabled,
  legend = DEFAULT_LEGEND,
  description = DEFAULT_DESCRIPTION,
  idPrefix = 'act-sticker',
}: RecheckStickerListProps) {
  if (rows.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{description}</p>
      <ul className="space-y-2">
        {rows.map((row) => {
          const id = `${idPrefix}-${row.stickerId}`;
          return (
            <li key={row.stickerId} className="flex items-center gap-3">
              <Checkbox
                id={id}
                aria-label={row.name}
                checked={checked.has(row.stickerId)}
                disabled={disabled || row.inactive}
                onCheckedChange={(on) => onToggle(row.stickerId, on === true)}
              />
              <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{row.name}</span>
                {(row.hint ?? stickerHint(row)) === '' ? null : (
                  <span className="block text-xs text-muted-foreground">
                    {row.hint ?? stickerHint(row)}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <FieldError errors={[error]} />
    </fieldset>
  );
}

export interface MessageFieldProps {
  id: string;
  /** Label tampak; "(opsional)" ditambahkan bila `required` salah. */
  label?: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** Ada gambar catatan yang masih diunggah (true) atau tidak (false); form induk menahan tombol kirim. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

/** Catatan Markdown dengan gambar (maks. `messageImagesMax`), dipakai dialog update dan halaman Lapor Rusak. */
export function MessageField({
  id,
  label = 'Catatan',
  required,
  value,
  onChange,
  error,
  disabled,
  onBusyChange,
}: MessageFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`} required={required}>
        {required ? label : `${label} (opsional)`}
      </Label>
      <WysiwygEditor
        id={id}
        labelledBy={`${id}-label`}
        required={required}
        mode="message"
        value={value}
        onChange={onChange}
        maxLength={SERIAL_LIMITS.messageMax}
        maxImages={SERIAL_LIMITS.messageImagesMax}
        disabled={disabled ?? false}
        onBusyChange={onBusyChange}
      />
      <FieldError errors={[error]} />
    </div>
  );
}
