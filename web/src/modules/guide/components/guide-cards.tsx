import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOfferedGuides } from '../lib/use-offered-guides';
import { useTour } from './tour/tour-provider';

/** Kartu "Panduan untuk kamu" di beranda: panduan yang ditawarkan (spek 4.2/4.4). Tak merender apa pun bila kosong. */
export function GuideCards() {
  const { ready, offers } = useOfferedGuides();
  const tour = useTour();
  if (!ready || offers.length === 0) return null;
  return (
    <section aria-labelledby="guide-cards-title" className="space-y-3">
      <h2 id="guide-cards-title" className="text-lg font-semibold">
        Panduan untuk kamu
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map(({ entry, stepCount }) => (
          <Card key={entry.id}>
            <CardHeader>
              <CardTitle className="text-base">{entry.title}</CardTitle>
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
