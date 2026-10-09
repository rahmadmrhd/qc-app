import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';

/** Pesan galat unggah gambar yang ramah pengguna (galat server, galat kompresi, atau tak terduga). */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof RpcError) return describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah gambar';
}
