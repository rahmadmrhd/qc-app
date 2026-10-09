import { fileRef, MARKDOWN_MAX_LENGTH } from '@shared/files';
import type { LucideIcon } from 'lucide-react';
import {
  Bold,
  Code,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';
import { cn } from '@/lib/utils';
import { isAcceptedImage } from '@/modules/files/image';
import { useUploadImage } from '@/modules/files/use-upload-image';
import type { EditResult, TextSelection } from './edit-ops';
import { insertAtCursor, prefixLines, wrapSelection } from './edit-ops';
import { MarkdownView } from './markdown-view';

interface Tool {
  label: string;
  icon: LucideIcon;
  run: (text: string, selection: TextSelection) => EditResult;
}

const TOOLS: Tool[] = [
  { label: 'Judul', icon: Heading2, run: (t, s) => prefixLines(t, s, () => '## ') },
  { label: 'Tebal', icon: Bold, run: (t, s) => wrapSelection(t, s, '**') },
  { label: 'Miring', icon: Italic, run: (t, s) => wrapSelection(t, s, '_') },
  { label: 'Daftar', icon: List, run: (t, s) => prefixLines(t, s, () => '- ') },
  {
    label: 'Daftar bernomor',
    icon: ListOrdered,
    run: (t, s) => prefixLines(t, s, (index) => `${index + 1}. `),
  },
  { label: 'Kutipan', icon: Quote, run: (t, s) => prefixLines(t, s, () => '> ') },
  { label: 'Kode', icon: Code, run: (t, s) => wrapSelection(t, s, '`') },
  { label: 'Tautan', icon: Link2, run: (t, s) => wrapSelection(t, s, '[', '](https://)', 'teks') },
];

const ACCEPT = 'image/jpeg,image/png,image/webp';

export interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

type Tab = 'write' | 'preview';

function uploadErrorMessage(error: unknown): string {
  if (error instanceof RpcError) return describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah gambar';
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength = MARKDOWN_MAX_LENGTH,
  disabled = false,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<Tab>('write');
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<TextSelection | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const uploadImage = useUploadImage();

  // Pulihkan fokus dan pilihan setelah teks berubah lewat toolbar atau sisip gambar.
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const element = textareaRef.current;
    pendingSelection.current = null;
    if (selection && element) {
      element.focus();
      element.setSelectionRange(selection.start, selection.end);
    }
  });

  function currentSelection(): TextSelection {
    const element = textareaRef.current;
    const end = valueRef.current.length;
    return { start: element?.selectionStart ?? end, end: element?.selectionEnd ?? end };
  }

  function apply(result: EditResult) {
    pendingSelection.current = result.selection;
    onChange(result.text);
  }

  async function insertImages(files: File[]) {
    const images = files.filter(isAcceptedImage);
    if (images.length === 0) {
      setUploadError('Hanya gambar JPEG, PNG, atau WebP yang dapat disisipkan');
      return;
    }
    setUploadError(null);
    for (const file of images) {
      setUploading((count) => count + 1);
      try {
        const fileId = await uploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]()]/g, '') || 'gambar';
        apply(
          insertAtCursor(valueRef.current, currentSelection(), `![${alt}](${fileRef(fileId)})\n`),
        );
      } catch (error) {
        setUploadError(uploadErrorMessage(error));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const tooLong = value.length > maxLength;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <div role="tablist" aria-label="Mode editor" className="mr-2 flex gap-1">
          {(['write', 'preview'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              role="tab"
              size="sm"
              variant={tab === item ? 'secondary' : 'ghost'}
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {item === 'write' ? 'Tulis' : 'Pratinjau'}
            </Button>
          ))}
        </div>
        {tab === 'write' ? (
          <>
            {TOOLS.map(({ label, icon: Icon, run }) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="ghost"
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={() => apply(run(valueRef.current, currentSelection()))}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Gambar"
              title="Sisipkan gambar"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus aria-hidden="true" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              aria-label="Pilih gambar"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length > 0) void insertImages(files);
              }}
            />
          </>
        ) : null}
      </div>

      {tab === 'write' ? (
        <Textarea
          id={id}
          ref={textareaRef}
          aria-label="Isi Markdown"
          aria-invalid={tooLong}
          className="min-h-64 font-mono text-sm"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length === 0) return;
            event.preventDefault();
            void insertImages(files);
          }}
          onDragOver={(event) => {
            if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (files.length === 0) return;
            event.preventDefault();
            void insertImages(files);
          }}
        />
      ) : (
        <div className="min-h-64 rounded-md border p-3">
          {value.trim() === '' ? (
            <p className="text-sm text-muted-foreground">Belum ada isi.</p>
          ) : (
            <MarkdownView source={value} />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span aria-live="polite" className="text-muted-foreground">
          {uploading > 0 ? 'Mengunggah gambar…' : ''}
        </span>
        <span className={cn(tooLong ? 'text-destructive' : 'text-muted-foreground')}>
          {value.length}/{maxLength}
        </span>
      </div>
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}
