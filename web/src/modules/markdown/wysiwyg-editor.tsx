import { fileRef, MARKDOWN_MAX_LENGTH } from '@shared/files';
import type { Editor, Extensions } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { TableKit } from '@tiptap/extension-table';
import { Text } from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { isAcceptedImage } from '@/modules/files/image';
import { uploadErrorMessage } from '@/modules/files/upload-error';
import { useUploadImage } from '@/modules/files/use-upload-image';
import { altTextFromFileName } from './image-alt';
import { loadMarkdown } from './load-markdown';
import { normalizeMarkdown } from './normalize-markdown';
import { FileImageExtension } from './wysiwyg-image';
import { WysiwygToolbar } from './wysiwyg-toolbar';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const SAFE_LINK = /^(https?:|mailto:)/i;

export interface WysiwygEditorProps {
  id: string;
  /** Markdown (sumber kebenaran yang disimpan). */
  value: string;
  onChange: (markdown: string) => void;
  maxLength?: number;
  disabled?: boolean;
  /** Id elemen label dari form induk; bila ada dipakai sebagai nama field (menggantikan aria-label bawaan). */
  labelledBy?: string;
  /** `item`: toolbar lengkap + gambar; `note`: tanpa gambar (catatan Serah Terima). */
  mode?: 'item' | 'note';
  extraExtensions?: Extensions;
  onReady?: (editor: Editor) => void;
}

const LENGTH_KEY = new PluginKey('qcMarkdownLength');

/** Menolak transaksi yang membuat Markdown melebihi batas (menghapus tetap boleh). */
function lengthLimitExtension(getMax: () => number, isSyncing: () => boolean) {
  return Extension.create({
    name: 'qcMarkdownLength',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: LENGTH_KEY,
          filterTransaction(tr, state) {
            if (!tr.docChanged || isSyncing() || !editor.markdown) return true;
            const max = getMax();
            const next = editor.markdown.serialize(tr.doc.toJSON()).length;
            if (next <= max) return true;
            return next <= editor.markdown.serialize(state.doc.toJSON()).length;
          },
        }),
      ];
    },
  });
}

export function WysiwygEditor({
  id,
  value,
  onChange,
  maxLength = MARKDOWN_MAX_LENGTH,
  disabled = false,
  labelledBy,
  mode = 'item',
  extraExtensions,
  onReady,
}: WysiwygEditorProps) {
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const maxRef = useRef(maxLength);
  maxRef.current = maxLength;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const syncingRef = useRef(false);
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const insertImagesRef = useRef<(files: File[]) => void>(() => undefined);
  const uploadImage = useUploadImage();
  const tooLong = value.length > maxLength;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Ekstensi dibuat sekali; nilai yang berubah dibaca lewat ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ekstensi sengaja dibuat sekali
  const extensions = useMemo(
    () => [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Strike,
      Code,
      CodeBlock,
      Blockquote,
      HardBreak,
      HorizontalRule,
      Heading.configure({ levels: [1, 2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url: string) => SAFE_LINK.test(url),
      }),
      UndoRedo,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      ...(mode === 'item' ? [FileImageExtension] : []),
      Markdown,
      lengthLimitExtension(
        () => maxRef.current,
        () => syncingRef.current,
      ),
      ...(extraExtensions ?? []),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    editable: !disabled,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': 'Isi catatan' }),
        'aria-describedby': `${id}-count`,
        'aria-invalid': String(tooLong),
        'aria-disabled': String(disabled),
        class: cn(
          'min-h-64 w-full rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'aria-invalid:border-destructive',
          disabled && 'cursor-not-allowed opacity-50',
          '[&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1',
          '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
          '[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2',
          '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
          '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
          '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1',
          '[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
          '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        ),
      },
      handlePaste: (_view, event) => {
        if (mode !== 'item') return false;
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return false;
        // Menyalin sel Excel/Word menaruh gambar sekaligus teks biasa: biarkan teks menempel normal.
        if ((event.clipboardData?.types ?? []).includes('text/plain')) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        if (mode !== 'item') return false;
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (files.length === 0) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = normalizeMarkdown(current.getMarkdown());
      if (markdown === lastEmitted.current) return;
      lastEmitted.current = markdown;
      onChangeRef.current(markdown);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  // Muat awal dan nilai dari luar (mis. reset formulir): dimuat tanpa memicu onChange.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const first = !loadedRef.current;
    if (!first && value === lastEmitted.current) return;
    loadedRef.current = true;
    lastEmitted.current = value;
    syncingRef.current = true;
    try {
      loadMarkdown(editor, value);
    } finally {
      syncingRef.current = false;
    }
    if (first) onReadyRef.current?.(editor);
  }, [editor, value]);

  /** Fokus hanya dikembalikan bila pengguna masih berada di dalam editor (atau tidak sedang di field mana pun). */
  function userIsHere(): boolean {
    const active = document.activeElement;
    return (
      active === null || active === document.body || Boolean(rootRef.current?.contains(active))
    );
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
        const current = editorRef.current;
        // Editor sudah ditutup atau dinonaktifkan selama unggahan: jangan mengubah isi.
        if (!mountedRef.current || disabledRef.current || !current || current.isDestroyed) return;
        const chain = userIsHere() ? current.chain().focus() : current.chain();
        chain
          .insertContent({
            type: 'image',
            attrs: { src: fileRef(fileId), alt: altTextFromFileName(file.name) },
          })
          .run();
      } catch (error) {
        setUploadError(uploadErrorMessage(error));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }
  insertImagesRef.current = (files) => void insertImages(files);

  return (
    <div ref={rootRef} className="space-y-2">
      <WysiwygToolbar
        editor={editor}
        mode={mode}
        disabled={disabled}
        onPickImage={() => fileInputRef.current?.click()}
      />
      {mode === 'item' ? (
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
      ) : null}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span aria-live="polite" className="text-muted-foreground">
          {uploading > 0 ? 'Mengunggah gambar…' : ''}
        </span>
        <span
          id={`${id}-count`}
          className={cn(tooLong ? 'text-destructive' : 'text-muted-foreground')}
        >
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
