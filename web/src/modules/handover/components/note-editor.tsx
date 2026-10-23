import { HANDOVER_LIMITS } from '@shared/handover';
import { useMemo } from 'react';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { whatsappPasteExtension } from '../lib/paste-extension';

export interface NoteEditorProps {
  id: string;
  value: string;
  onChange: (markdown: string) => void;
  labelledBy?: string;
  disabled?: boolean;
}

/** Editor Catatan Serah Terima: WYSIWYG tanpa gambar, dengan tempel WhatsApp, maksimal 5.000 karakter. */
export function NoteEditor({ id, value, onChange, labelledBy, disabled }: NoteEditorProps) {
  const extensions = useMemo(() => [whatsappPasteExtension()], []);
  return (
    <WysiwygEditor
      id={id}
      mode="note"
      value={value}
      onChange={onChange}
      labelledBy={labelledBy}
      disabled={disabled}
      maxLength={HANDOVER_LIMITS.note}
      extraExtensions={extensions}
    />
  );
}
