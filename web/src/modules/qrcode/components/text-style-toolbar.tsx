import type { QrTextStyle } from '@shared/qrcode';
import type { LucideIcon } from 'lucide-react';
import { Bold, CaseUpper, Italic, Strikethrough, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TOGGLES: ReadonlyArray<{ key: keyof QrTextStyle; label: string; Icon: LucideIcon }> = [
  { key: 'bold', label: 'Tebal', Icon: Bold },
  { key: 'italic', label: 'Miring', Icon: Italic },
  { key: 'underline', label: 'Garis bawah', Icon: Underline },
  { key: 'strike', label: 'Coret', Icon: Strikethrough },
  { key: 'uppercase', label: 'Huruf kapital', Icon: CaseUpper },
];

export interface TextStyleToolbarProps {
  /** Nama bagian (Title, Subtitle, Footer): dipakai pada label agar tombol dapat dibedakan. */
  part: string;
  value: QrTextStyle;
  onChange: (next: QrTextStyle) => void;
}

/** Deretan tombol gaya (tebal, miring, garis bawah, coret, huruf kapital) untuk satu bagian teks. */
export function TextStyleToolbar({ part, value, onChange }: TextStyleToolbarProps) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0">
      <legend className="sr-only">{`Gaya ${part}`}</legend>
      {TOGGLES.map(({ key, label, Icon }) => (
        <Button
          key={key}
          type="button"
          size="icon-sm"
          variant={value[key] ? 'solid' : 'outline'}
          color="primary"
          aria-label={`${label} ${part}`}
          aria-pressed={value[key]}
          title={label}
          onClick={() => onChange({ ...value, [key]: !value[key] })}
        >
          <Icon />
        </Button>
      ))}
    </fieldset>
  );
}
