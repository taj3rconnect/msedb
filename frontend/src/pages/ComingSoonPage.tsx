import { Construction } from 'lucide-react';

interface ComingSoonPageProps {
  title: string;
}

/**
 * Placeholder page for unbuilt features.
 *
 * Shows the page title and a centered "Coming Soon" message.
 */
export function ComingSoonPage({ title }: ComingSoonPageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Construction className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        This feature is coming soon.
      </p>
    </div>
  );
}
