import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function StatusMessage({
  code,
  title,
  description,
}: {
  code: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-5xl font-bold text-muted-foreground">{code}</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <Button asChild variant="outline" color="primary">
        <Link to="/">Kembali ke beranda</Link>
      </Button>
    </div>
  );
}
