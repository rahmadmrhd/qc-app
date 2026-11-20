import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { DesktopDownloadsPage } from '@/modules/desktop-download/components/desktop-downloads-page';
import {
  type DetectedPlatform,
  detectPlatform,
} from '@/modules/desktop-download/lib/detect-platform';
import { desktopReleasesQueryOptions } from '@/modules/desktop-download/queries';

// Tanpa izin modul: cukup sesi aktif (daftar unduhan bukan data sensitif; tautan berkas mengarah ke rute publik).
export const Route = createFileRoute('/_app/desktop')({
  loader: ({ context }) => context.queryClient.ensureQueryData(desktopReleasesQueryOptions()),
  component: DesktopPage,
});

function DesktopPage() {
  // Deteksi baru selesai sesudah render pertama; sebelum itu dianggap OS lain (tanpa tombol utama).
  const [platform, setPlatform] = useState<DetectedPlatform>({ os: 'other' });
  useEffect(() => {
    let active = true;
    void detectPlatform(navigator).then((detected) => {
      if (active) setPlatform(detected);
    });
    return () => {
      active = false;
    };
  }, []);
  return <DesktopDownloadsPage platform={platform} />;
}
