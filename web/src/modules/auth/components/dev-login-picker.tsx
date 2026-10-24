import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MOCK_USERS, mockLogin } from '@/lib/rpc/mock-backend';
import { markAuthenticated, setDevToken } from '@/modules/auth/session';

export default function DevLoginPicker() {
  const navigate = useNavigate();
  const [rejected, setRejected] = useState<string | null>(null);

  function loginAs(email: string) {
    const result = mockLogin(email);
    if ('token' in result) {
      setDevToken(result.token);
      markAuthenticated(email);
      void navigate({ to: '/' });
    } else {
      setRejected(result.email);
    }
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-xs font-medium text-muted-foreground">Mode dev — masuk sebagai:</p>
      {MOCK_USERS.map((mockUser) => (
        <Button
          key={mockUser.email}
          variant="outline"
          className="h-auto w-full justify-start py-2 text-left"
          onClick={() => loginAs(mockUser.email)}
        >
          <span className="flex flex-col">
            <span className="text-sm">{mockUser.label}</span>
            <span className="text-xs text-muted-foreground">{mockUser.email}</span>
          </span>
        </Button>
      ))}
      {rejected ? (
        <p className="text-sm text-destructive">Email {rejected} belum terdaftar.</p>
      ) : null}
    </div>
  );
}
