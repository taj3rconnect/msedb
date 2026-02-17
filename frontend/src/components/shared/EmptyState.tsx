import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Centered empty state component with icon, title, and description.
 */
export function EmptyState({ title, description, icon: Icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-semibold text-muted-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">{description}</p>
    </div>
  );
}
