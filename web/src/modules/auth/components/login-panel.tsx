import type { AuthErrorCode, MeDto } from '@shared/contract';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { MeState } from '@/app/boot';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBridge } from '@/lib/platform';
import { DesktopLoginAction } from './desktop-login-action';

export interface LoginPanelProps {
  loginUrl: string;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
  /** Boot gagal karena server tak terjangkau (hanya bermakna di desktop). */
  serverUnreachable?: boolean;
  /** Desktop: memuat ulang `me` setelah login (bawaan `loadMeState`). */
  loadMeState?: () => Promise<MeState>;
  /** Desktop: dipanggil setelah login berhasil dan `me` termuat. */
  onDesktopSignedIn?: (me: MeDto) => void;
  children?: ReactNode;
}

export function LoginPanel({
  loginUrl,
  authError,
  authErrorEmail,
  serverUnreachable = false,
  loadMeState,
  onDesktopSignedIn,
  children,
}: LoginPanelProps) {
  // Di aplikasi desktop login lewat jembatan (browser sistem), bukan tautan `/auth/login`.
  const bridge = getBridge();
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>QC App</CardTitle>
        <CardDescription>Masuk dengan akun Google yang sudah terdaftar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {authError === 'NOT_WHITELISTED' ? (
          <Alert variant="destructive">
            <AlertTitle>Email belum terdaftar</AlertTitle>
            <AlertDescription>
              {authErrorEmail
                ? `Email ${authErrorEmail} belum terdaftar.`
                : 'Email Anda belum terdaftar.'}{' '}
              Hubungi admin untuk mendapatkan akses.
            </AlertDescription>
          </Alert>
        ) : null}
        {authError === 'LOGIN_FAILED' ? (
          <Alert variant="destructive">
            <AlertTitle>Login gagal</AlertTitle>
            <AlertDescription>Silakan coba lagi.</AlertDescription>
          </Alert>
        ) : null}
        {bridge && serverUnreachable ? (
          <Alert variant="destructive">
            <AlertTitle>Tidak dapat terhubung ke server</AlertTitle>
            <AlertDescription>
              Periksa koneksi internet Anda. Country Lock tetap dapat dipakai tanpa server.
            </AlertDescription>
          </Alert>
        ) : null}
        {bridge ? (
          <DesktopLoginAction
            bridge={bridge}
            loadMeState={loadMeState}
            onSignedIn={onDesktopSignedIn}
          />
        ) : (
          <Button asChild className="w-full">
            <a href={loginUrl}>Masuk dengan Google</a>
          </Button>
        )}
        {bridge ? (
          <Button asChild variant="outline" className="w-full">
            <Link to="/country-lock">Buka Country Lock</Link>
          </Button>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
