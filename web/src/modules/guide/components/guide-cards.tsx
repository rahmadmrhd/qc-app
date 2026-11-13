import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBlockingOnboardingActive } from '@/modules/push/components/push-onboarding';
import { useOfferedGuides } from '../lib/use-offered-guides';
import { useTour } from './tour/tour-provider';

/** Kartu "Panduan untuk kamu" di beranda: panduan yang ditawarkan (spek 4.2/4.4). Tak merender apa pun bila kosong. */
export function GuideCards() {
  const { ready, offers } = useOfferedGuides();
  const tour = useTour();
  // Ditunda selama dialog/banner onboarding push tampil (spek 4.3), supaya kartu push tak menumpuk dengannya.
  const blocked = useBlockingOnboardingActive();
  if (!ready || blocked || offers.length === 0) return null;
  return (
    <section aria-labelledby="guide-cards-title" className="space-y-3">
      <h2 id="guide-cards-title" className="text-lg font-semibold">
        Panduan untuk kamu
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map(({ entry, stepCount, updated }) => (
          <Card key={entry.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {entry.title}
                {updated ? <Badge variant="secondary">Diperbarui</Badge> : null}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{stepCount} langkah</p>
            </CardHeader>
            <CardContent>
              <Button type="button" size="sm" onClick={() => tour.start(entry)}>
                Mulai
                <span className="sr-only"> panduan {entry.title}</span>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
