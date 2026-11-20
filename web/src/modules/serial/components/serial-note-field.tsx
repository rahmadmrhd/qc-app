import { SERIAL_LIMITS } from '@shared/serials';
import { FieldError } from '@/components/field-error';
import { Label } from '@/components/ui/label';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';

export interface SerialNoteFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  error?: string | undefined;
  /** Diteruskan ke editor (mode `note` tanpa gambar sehingga tidak pernah sibuk; ada agar kontraknya seragam). */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

/**
 * Catatan serial: editor Markdown/Tiptap tanpa gambar (mode `note`), maksimal `SERIAL_LIMITS.noteMax` karakter. Nilai
 * yang disimpan tetap string (Markdown); tabel dan kartu draft menampilkan ringkasan teks polosnya (`noteSummary`).
 */
export function SerialNoteField({
  id,
  label,
  value,
  onChange,
  disabled,
  error,
  onBusyChange,
}: SerialNoteFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      <WysiwygEditor
        id={id}
        labelledBy={`${id}-label`}
        mode="note"
        value={value}
        onChange={onChange}
        maxLength={SERIAL_LIMITS.noteMax}
        disabled={disabled ?? false}
        editorClassName="min-h-24"
        onBusyChange={onBusyChange}
      />
      <FieldError errors={[error]} />
    </div>
  );
}
