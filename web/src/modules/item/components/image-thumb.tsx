import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileUrl } from '@/modules/files/queries';

export interface ImageThumbProps {
  id: string;
  alt: string;
  className?: string;
}

/** Gambar dari berkas aplikasi (diambil lewat RPC, privat) dengan status memuat dan gagal. */
export function ImageThumb({ id, alt, className }: ImageThumbProps) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <div
        role="img"
        aria-label="Memuat gambar"
        className={cn('animate-pulse rounded-md bg-muted', className)}
      />
    );
  }
  if (isError || !url) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak tersedia"
        className={cn(
          'flex items-center justify-center rounded-md border bg-muted text-muted-foreground',
          className,
        )}
      >
        <ImageOff aria-hidden="true" className="size-5" />
      </div>
    );
  }
  return <img src={url} alt={alt} className={cn('rounded-md border object-cover', className)} />;
}
