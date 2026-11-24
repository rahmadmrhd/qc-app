import { fileRef, MARKDOWN_MAX_LENGTH, MAX_IMAGE_BYTES } from '@shared/files';
import { extractFileRefs } from '@shared/items';
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
import {
  AttachmentView,
  FileDialog,
  type RejectedFile,
  RejectedList,
} from '@/components/file-dialog';
import { intakeFiles } from '@/components/file-dialog/intake';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { cn } from '@/lib/utils';
import { itemFileSource } from '@/modules/files/file-source';
import { altTextFromStem } from './image-alt';
import { loadMarkdown } from './load-markdown';
import { normalizeMarkdown } from './normalize-markdown';
import { SafeTableCell, SafeTableHeader } from './table-extensions';
import { FileImageExtension } from './wysiwyg-image';
import { WysiwygToolbar } from './wysiwyg-toolbar';

const SAFE_LINK = /^(https?:|mailto:)/i;

export interface WysiwygEditorProps {
  id: string;
  /** Markdown (sumber kebenaran yang disimpan). */
  value: string;
  onChange: (markdown: string) => void;
  maxLength?: number;
  disabled?: boolean;
  /** Field wajib: `aria-required` pada kotak editor (bintang ada di label form induk). */
  required?: boolean;
  /** Id elemen label dari form induk; bila ada dipakai sebagai nama field (menggantikan aria-label bawaan). */
  labelledBy?: string;
  /**
   * `item`: toolbar lengkap + gambar; `note`: tanpa gambar, centang dikunci (catatan Serah Terima); `message`: toolbar
   * ringkas + gambar, centang dapat diubah (pesan kejadian Serial Number; gambar memakai pemilik berkas `serial`).
   */
  mode?: 'item' | 'note' | 'message';
  /** Maks. gambar pada isi (mis. pesan Serial Number); sisipan melebihi batas ditolak dengan pesan. Bawaan: tanpa batas. */
  maxImages?: number;
  /** Dipanggil saat ada unggahan gambar berjalan (true) dan saat semuanya selesai/dibuang (false); form induk menahan Simpan. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
  extraExtensions?: Extensions;
  /** Kelas tambahan untuk permukaan penyunting (mis. `min-h-24` agar form ringkas); digabung setelah bawaan. */
  editorClassName?: string;
  onReady?: (editor: Editor) => void;
}

const LENGTH_KEY = new PluginKey('qcMarkdownLength');

/** Menolak transaksi yang membuat Markdown melebihi batas (menghapus tetap boleh). */
function lengthLimitExtension(
  getMax: () => number,
  isSyncing: () => boolean,
  onReject: () => void,
) {
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
            if (next <= editor.markdown.serialize(state.doc.toJSON()).length) return true;
            onReject();
            return false;
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
  required = false,
  labelledBy,
  mode = 'item',
  maxImages,
  onBusyChange,
  extraExtensions,
  editorClassName,
  onReady,
}: WysiwygEditorProps) {
  const imagesEnabled = mode === 'item' || mode === 'message';
  // Berkas yang ditolak saat masuk (jenis/ukuran) dan pesan batas jumlah gambar.
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [maxMessage, setMaxMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Transaksi ditolak karena melewati batas: beri tahu pengguna (bukan menolak diam-diam).
  const [limitHit, setLimitHit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
  // Nilai yang sudah dikirim ke induk tetapi gema-nya (prop value) belum kembali; render induk bisa tertinggal.
  const pendingEchoes = useRef<string[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const insertImagesRef = useRef<(files: File[]) => void>(() => undefined);
  const maxImagesRef = useRef(maxImages);
  maxImagesRef.current = maxImages;
  // Unggah latar: progres di baris status; gambar disisipkan di posisi kursor SAAT unggahan selesai (urut sesuai
  // pilihan, satu per waktu). Editor dilepas = unggahan dibatalkan oleh hook dan tidak ada yang disisipkan.
  const uploads = useBackgroundUploads({
    source: itemFileSource,
    concurrency: 1,
    onUploaded: (_owner, item) => {
      const current = editorRef.current;
      // Editor sudah ditutup atau dinonaktifkan selama unggahan: jangan mengubah isi.
      if (!mountedRef.current || disabledRef.current || !current || current.isDestroyed)
        return false;
      const limit = maxImagesRef.current;
      if (limit !== undefined && extractFileRefs(current.getMarkdown()).length >= limit) {
        setMaxMessage(`Maksimal ${limit} gambar`);
        return false;
      }
      const chain = userIsHere() ? current.chain().focus() : current.chain();
      chain
        .insertContent({
          type: 'image',
          attrs: { src: fileRef(item.id), alt: altTextFromStem(item.name) },
        })
        .run();
      return true;
    },
  });
  const own = uploads.forOwner('editor');
  const ownRef = useRef(own);
  ownRef.current = own;
  const busy = own.blocking;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);
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
      TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
      SafeTableCell,
      SafeTableHeader,
      ...(imagesEnabled ? [FileImageExtension] : []),
      Markdown,
      lengthLimitExtension(
        () => maxRef.current,
        () => syncingRef.current,
        () => setLimitHit(true),
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
        ...(required ? { 'aria-required': 'true' } : {}),
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
          mode === 'note' &&
            '[&_input[type=checkbox]]:pointer-events-none [&_ul[data-type=taskList]_label]:pointer-events-none',
          '[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2',
          '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
          '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
          '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1',
          '[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
          '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
          editorClassName,
        ),
      },
      // Catatan: klik pada kotak ATAU labelnya tidak boleh mengubah centang (CSS saja tidak cukup: label meneruskan aktivasi).
      handleDOMEvents: {
        click: (_view, event) => {
          if (mode !== 'note') return false;
          const target = event.target as HTMLElement | null;
          if (target?.closest('ul[data-type=taskList] label, input[type=checkbox]')) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      // Catatan: centang dimiliki QC, jadi kotak di editor tidak dapat diubah (juga lewat keyboard).
      handleKeyDown: (_view, event) => {
        if (mode !== 'note') return false;
        const target = event.target as HTMLElement | null;
        if (target instanceof HTMLInputElement && target.type === 'checkbox') {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        if (!imagesEnabled) return false;
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return false;
        // Menyalin sel Excel/Word menaruh gambar sekaligus teks biasa: biarkan teks menempel normal.
        if ((event.clipboardData?.types ?? []).includes('text/plain')) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        if (!imagesEnabled) return false;
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (files.length === 0) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      setLimitHit(false);
      const markdown = normalizeMarkdown(current.getMarkdown());
      if (markdown === lastEmitted.current) return;
      lastEmitted.current = markdown;
      pendingEchoes.current.push(markdown);
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
    if (!first) {
      const echo = pendingEchoes.current.indexOf(value);
      if (echo >= 0) {
        pendingEchoes.current.splice(0, echo + 1);
        return;
      }
      if (value === lastEmitted.current) return;
    }
    pendingEchoes.current = [];
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

  /** Sisa tempat gambar: batas `maxImages` dikurangi gambar di isi dan unggahan yang menunggu/berjalan. */
  function imageRoom(): number {
    const limit = maxImagesRef.current;
    if (limit === undefined) return Number.MAX_SAFE_INTEGER;
    const current = editorRef.current;
    const inDoc =
      current && !current.isDestroyed ? extractFileRefs(current.getMarkdown()).length : 0;
    const reserved = ownRef.current.entries.filter((entry) => entry.phase !== 'failed').length;
    return Math.max(0, limit - inDoc - reserved);
  }

  /** Drop/tempel: langsung diunggah (tanpa dialog); jenis dan ukuran diperiksa seragam dengan dialog lampiran. */
  function insertImages(files: File[]) {
    setMaxMessage(null);
    const result = intakeFiles(files, {
      accept: itemFileSource.mimeTypes,
      maxBytes: MAX_IMAGE_BYTES,
      room: Number.MAX_SAFE_INTEGER,
    });
    setRejected(result.rejected);
    const room = imageRoom();
    if (result.queued.length > room) setMaxMessage(`Maksimal ${maxImagesRef.current} gambar`);
    const allowed = result.queued.slice(0, room);
    if (allowed.length > 0) ownRef.current.add(allowed);
  }
  insertImagesRef.current = insertImages;

  function pickImages() {
    setMaxMessage(null);
    if (imageRoom() <= 0) {
      setMaxMessage(`Maksimal ${maxImagesRef.current} gambar`);
      return;
    }
    setDialogOpen(true);
  }

  return (
    <div ref={rootRef} className="space-y-2">
      <WysiwygToolbar editor={editor} mode={mode} disabled={disabled} onPickImage={pickImages} />
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span aria-live="polite" className="text-muted-foreground">
          {busy ? 'Mengunggah gambar…' : ''}
        </span>
        <span
          id={`${id}-count`}
          className={cn(tooLong ? 'text-destructive-text' : 'text-muted-foreground')}
        >
          {value.length}/{maxLength}
        </span>
      </div>
      {limitHit ? (
        <p role="status" className="text-sm text-destructive-text">
          Batas {maxLength} karakter tercapai; teks yang melebihi batas tidak dimasukkan.
        </p>
      ) : null}
      {maxMessage ? (
        <p role="alert" className="text-sm text-destructive-text">
          {maxMessage}
        </p>
      ) : null}
      <RejectedList items={rejected} onClear={() => setRejected([])} />
      <AttachmentView
        items={[]}
        pending={own.entries}
        layout="list"
        label="gambar editor"
        onRetry={own.retry}
        onCancel={own.remove}
      />
      {imagesEnabled && dialogOpen ? (
        <FileDialog
          open
          onOpenChange={setDialogOpen}
          source={itemFileSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={Math.max(1, imageRoom())}
          showLibrary={false}
          hideNames
          title="Sisipkan gambar"
          confirmLabel="Sisipkan"
          onConfirm={(result) => {
            setRejected([]);
            ownRef.current.add(result.files);
          }}
        />
      ) : null}
    </div>
  );
}
