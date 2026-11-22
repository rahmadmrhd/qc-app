import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import {
  Bold,
  Code,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

interface Tool {
  label: string;
  icon: LucideIcon;
  /** Hanya mode `item` (Detail Item); mode `note` memakai toolbar yang lebih ringkas. */
  itemOnly?: boolean;
  active: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

function toggleLink(editor: Editor): void {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const href = window.prompt('Alamat tautan (https://… atau mailto:…)', 'https://')?.trim();
  if (!href || !SAFE_LINK.test(href)) return;
  editor.chain().focus().setLink({ href }).run();
}

const TOOLS: Tool[] = [
  {
    label: 'Judul',
    icon: Heading2,
    itemOnly: true,
    active: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: 'Tebal',
    icon: Bold,
    active: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'Miring',
    icon: Italic,
    active: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Daftar',
    icon: List,
    active: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Daftar bernomor',
    icon: ListOrdered,
    active: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Checklist',
    icon: ListChecks,
    active: (e) => e.isActive('taskList'),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: 'Kutipan',
    icon: Quote,
    active: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Kode',
    icon: Code,
    itemOnly: true,
    active: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: 'Tautan',
    icon: Link2,
    itemOnly: true,
    active: (e) => e.isActive('link'),
    run: toggleLink,
  },
];

export interface WysiwygToolbarProps {
  editor: Editor | null;
  mode: 'item' | 'note' | 'message';
  disabled: boolean;
  onPickImage: () => void;
}

export function WysiwygToolbar({ editor, mode, disabled, onPickImage }: WysiwygToolbarProps) {
  // Status aktif tiap tombol dihitung ulang setiap transaksi editor.
  const activeLabels = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current ? TOOLS.filter((tool) => tool.active(current)).map((tool) => tool.label) : [],
  });
  const active = new Set(activeLabels ?? []);
  return (
    <div role="toolbar" aria-label="Pemformatan" className="flex flex-wrap items-center gap-1">
      {TOOLS.filter((tool) => mode === 'item' || !tool.itemOnly).map(
        ({ label, icon: Icon, run }) => (
          <Button
            key={label}
            type="button"
            size="sm"
            variant={active.has(label) ? 'soft' : 'ghost'}
            color={active.has(label) ? 'secondary' : 'primary'}
            aria-label={label}
            aria-pressed={active.has(label)}
            title={label}
            disabled={disabled || !editor}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor && run(editor)}
          >
            <Icon aria-hidden="true" />
          </Button>
        ),
      )}
      {mode === 'item' || mode === 'message' ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          color="primary"
          aria-label="Gambar"
          title="Sisipkan gambar"
          disabled={disabled}
          onClick={onPickImage}
        >
          <ImagePlus aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
