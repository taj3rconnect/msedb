import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// --- Placeholder pages (to be replaced in Plan 02/03) ---

function DashboardPage() {
  return <h1 className="p-8 text-2xl font-bold">Dashboard</h1>;
}

function EmailActivityPage() {
  return <h1 className="p-8 text-2xl font-bold">Email Activity</h1>;
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Coming soon</p>
    </div>
  );
}

// --- Protected Layout ---

function ProtectedLayout() {
  const { isLoading, isAuthenticated } = useAuthStore();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Render child routes (no AppShell yet -- that's Plan 02)
  return <Outlet />;
}

// --- App Root ---

/**
 * AppRoot initializes auth state on mount.
 * The useAuth hook calls /auth/me and populates the auth store.
 */
function AppRoot() {
  useAuth();
  return <Outlet />;
}

// --- Router ---

const router = createBrowserRouter([
  {
    element: <AppRoot />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        element: <ProtectedLayout />,
        children: [
          {
            path: '/',
            element: <DashboardPage />,
          },
          {
            path: '/activity',
            element: <EmailActivityPage />,
          },
          {
            path: '/patterns',
            element: <ComingSoon title="Patterns" />,
          },
          {
            path: '/rules',
            element: <ComingSoon title="Rules" />,
          },
          {
            path: '/staging',
            element: <ComingSoon title="Staging" />,
          },
          {
            path: '/audit',
            element: <ComingSoon title="Audit" />,
          },
          {
            path: '/settings',
            element: <ComingSoon title="Settings" />,
          },
        ],
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);

// --- Query Client ---

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      retry: 1,
    },
  },
});

// --- App ---

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
