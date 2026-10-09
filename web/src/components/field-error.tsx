function toMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return null;
}

interface FieldErrorProps {
  errors: ReadonlyArray<unknown>;
  /** Satu pesan per baris (untuk pesan bernomor); bawaannya digabung dengan koma. */
  stacked?: boolean;
}

export function FieldError({ errors, stacked = false }: FieldErrorProps) {
  const messages = [
    ...new Set(errors.map(toMessage).filter((message): message is string => Boolean(message))),
  ];
  if (messages.length === 0) return null;
  if (stacked) {
    return (
      <div className="space-y-0.5">
        {messages.map((message) => (
          <p key={message} className="text-sm text-destructive">
            {message}
          </p>
        ))}
      </div>
    );
  }
  return <p className="text-sm text-destructive">{messages.join(', ')}</p>;
}
