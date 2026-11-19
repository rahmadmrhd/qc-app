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
  /** Catatan wajib: bintang pada label dan `aria-required` pada editor. */
  required?: boolean;
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
  required,
}: SerialNoteFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`} required={required}>
        {label}
      </Label>
      <WysiwygEditor
        id={id}
        labelledBy={`${id}-label`}
        required={required}
        mode="note"
        value={value}
        onChange={onChange}
        maxLength={SERIAL_LIMITS.noteMax}
        disabled={disabled ?? false}
        editorClassName="min-h-24"
      />
      <FieldError errors={[error]} />
    </div>
  );
}
