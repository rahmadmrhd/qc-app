import { parseFileRef } from '@shared/files';
import Image from '@tiptap/extension-image';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useFileUrl } from '@/modules/files/queries';

function FileImage({ id, alt }: { id: string; alt: string }) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <span
        role="img"
        aria-label="Memuat gambar"
        className="inline-block h-24 w-40 animate-pulse rounded-md bg-muted"
      />
    );
  }
  if (isError || !url) {
    return <span className="text-xs text-muted-foreground">[gambar tidak tersedia]</span>;
  }
  return <img src={url} alt={alt} className="my-2 max-h-96 max-w-full rounded-md border" />;
}

function ImageNodeView({ node, selected }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  const id = parseFileRef(src);
  return (
    <NodeViewWrapper as="span" className={selected ? 'rounded-md ring-2 ring-ring' : undefined}>
      {id ? (
        <FileImage id={id} alt={String(node.attrs.alt ?? '')} />
      ) : (
        <span className="text-xs text-muted-foreground">[gambar tidak tersedia]</span>
      )}
    </NodeViewWrapper>
  );
}

/** Gambar Detail Item: disimpan sebagai `![alt](qcfile:ID)` dan ditampilkan lewat modul `files`. */
export const FileImageExtension = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
}).configure({ inline: true, allowBase64: false });
