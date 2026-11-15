import { MonitorDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Tampilan Country Lock di peramban biasa: fitur ini butuh aplikasi desktop (akses jaringan lokal
 * dan SSH). Tautan `qc://country-lock` membuka aplikasi bila sudah terpasang.
 */
export function OpenInDesktop() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <MonitorDown className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Country Lock hanya tersedia di aplikasi desktop</h1>
      <p className="text-sm text-muted-foreground">
        Country Lock perlu terhubung langsung ke perangkat di jaringan lokal Anda, sehingga tidak
        dapat berjalan di peramban.
      </p>
      <Button asChild>
        <a href="qc://country-lock">Buka di aplikasi desktop</a>
      </Button>
      <p className="text-xs text-muted-foreground">Unduhan tersedia setelah rilis.</p>
    </div>
  );
}
