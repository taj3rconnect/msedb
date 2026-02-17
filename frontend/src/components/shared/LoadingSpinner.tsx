import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  /** Size class for the spinner icon (default: "h-8 w-8") */
  size?: string;
  /** Additional CSS classes */
  className?: string;
}

export function LoadingSpinner({
  size = 'h-8 w-8',
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div
      className={`flex min-h-screen items-center justify-center ${className}`}
    >
      <Loader2 className={`animate-spin text-muted-foreground ${size}`} />
    </div>
  );
}
