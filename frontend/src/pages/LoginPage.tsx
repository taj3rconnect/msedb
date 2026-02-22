import { Navigate, useSearchParams } from 'react-router';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_DATE__: string;

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  // If already authenticated, redirect to dashboard
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSignIn = () => {
    // Full page redirect to backend OAuth login endpoint
    window.location.href = '/auth/login';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">MSEDB</CardTitle>
          <CardDescription>
            Microsoft Email Dashboard
          </CardDescription>
          {__APP_VERSION__ && (
            <p className="text-xs text-muted-foreground mt-1">
              {__APP_VERSION__} | {__APP_BUILD_DATE__}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error === 'auth_url_failed'
                ? 'Failed to start sign-in. Please try again.'
                : error === 'invalid_state'
                  ? 'Sign-in session expired. Please try again.'
                  : error === 'callback_failed'
                    ? 'Sign-in failed. Please try again.'
                    : `Sign-in error: ${error}`}
            </div>
          )}
          <Button
            onClick={handleSignIn}
            className="w-full"
            size="lg"
          >
            Sign in with Microsoft
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Sign in with your Microsoft 365 account to get started.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
