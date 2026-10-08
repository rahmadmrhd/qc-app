function toMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return null;
}

export function FieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
  const messages = [
    ...new Set(errors.map(toMessage).filter((message): message is string => Boolean(message))),
  ];
  if (messages.length === 0) return null;
  return <p className="text-sm text-destructive">{messages.join(', ')}</p>;
}
