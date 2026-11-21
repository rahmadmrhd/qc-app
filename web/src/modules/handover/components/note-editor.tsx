import { HANDOVER_LIMITS } from '@shared/handover';
import { useMemo, useState } from 'react';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { whatsappPasteExtension } from '../lib/paste-extension';

export interface NoteEditorProps {
  id: string;
  value: string;
  onChange: (markdown: string) => void;
  labelledBy?: string;
  required?: boolean;
  disabled?: boolean;
  /** Diteruskan ke editor (mode `note` tanpa gambar sehingga tidak pernah sibuk; ada agar kontraknya seragam). */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

/** Editor Catatan Serah Terima: WYSIWYG tanpa gambar, dengan tempel WhatsApp, maksimal 5.000 karakter. */
export function NoteEditor({
  id,
  value,
  onChange,
  labelledBy,
  required,
  disabled,
  onBusyChange,
}: NoteEditorProps) {
  const [tooLong, setTooLong] = useState<number | null>(null);
  const extensions = useMemo(
    () => [
      whatsappPasteExtension({
        maxLength: HANDOVER_LIMITS.note,
        onTooLong: (length) => setTooLong(length),
      }),
    ],
    [],
  );
  return (
    <div className="space-y-2">
      <WysiwygEditor
        id={id}
        mode="note"
        value={value}
        onChange={(next) => {
          setTooLong(null);
          onChange(next);
        }}
        labelledBy={labelledBy}
        required={required}
        disabled={disabled}
        maxLength={HANDOVER_LIMITS.note}
        extraExtensions={extensions}
        onBusyChange={onBusyChange}
      />
      {tooLong !== null ? (
        <p role="alert" className="text-sm text-destructive-text">
          {`Tempelan ${tooLong.toLocaleString('id-ID')} karakter melebihi batas ${HANDOVER_LIMITS.note.toLocaleString('id-ID')} karakter dan tidak dimasukkan. Bagi menjadi beberapa task atau persingkat dulu; catatan Anda tidak berubah.`}
        </p>
      ) : null}
    </div>
  );
}
