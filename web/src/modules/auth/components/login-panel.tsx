import type { AuthErrorCode } from '@shared/rpc';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { newLoginNonce, withNonce, writeLoginNonce } from '../nonce';

export interface LoginPanelProps {
  loginUrl: string | null;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
  children?: ReactNode;
}

export function LoginPanel({ loginUrl, authError, authErrorEmail, children }: LoginPanelProps) {
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
        {loginUrl ? (
          <Button asChild className="w-full">
            <a
              href={loginUrl}
              target="_top"
              rel="noopener"
              onClick={(event) => {
                const nonce = newLoginNonce();
                writeLoginNonce(nonce);
                event.currentTarget.href = withNonce(loginUrl, nonce);
              }}
            >
              Masuk dengan Google
            </a>
          </Button>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
