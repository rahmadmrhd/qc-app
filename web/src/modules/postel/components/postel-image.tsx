import { usePostelFileUrl } from '../queries';

/** Gambar lampiran (thumbnail atau besar) dimuat lewat `postelFiles.get` (privat) sebagai URL objek. */
export function PostelImage({
  id,
  alt,
  variant,
}: {
  id: string;
  alt: string;
  variant: 'thumb' | 'large';
}) {
  const { url, isLoading, isError } = usePostelFileUrl(id);
  if (isLoading) {
    return (
      <div role="img" aria-label="Memuat gambar" className="size-full animate-pulse bg-muted" />
    );
  }
  if (isError || !url) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak tersedia"
        className="flex size-full items-center justify-center bg-muted text-xs text-muted-foreground"
      >
        Tidak tersedia
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={
        variant === 'thumb' ? 'size-full object-cover' : 'max-h-[70dvh] max-w-full object-contain'
      }
    />
  );
}
