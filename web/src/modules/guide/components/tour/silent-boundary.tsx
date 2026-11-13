import { Component, type ErrorInfo, type ReactNode } from 'react';

interface SilentBoundaryProps {
  children: ReactNode;
  /** Dipanggil sekali saat anak melempar galat (mis. gagal memuat potongan malas); lalu `fallback` dirender. */
  onError?: (error: unknown) => void;
  fallback?: ReactNode;
}

/**
 * Batas galat kecil untuk bagian panduan yang dimuat malas (mesin tur, pemutar demo): gagal memuat potongan JS
 * (offline, deploy di antara muat halaman dan klik) tidak boleh menjatuhkan seluruh cangkang aplikasi lewat
 * `errorComponent` router. Panduan hanya pelengkap: diam saja (`fallback`, bawaan tak ada) dan beri tahu pemanggil.
 */
export class SilentBoundary extends Component<SilentBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  override render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
