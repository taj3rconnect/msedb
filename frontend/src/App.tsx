import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';

// --- Protected Layout ---

function ProtectedLayout() {
  const { isLoading, isAuthenticated } = useAuthStore();

  // Connect Socket.IO only when authenticated
  useSocket();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Wrap child routes in AppShell (sidebar + topbar)
  return <AppShell />;
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
            element: <ComingSoonPage title="Email Activity" />,
          },
          {
            path: '/patterns',
            element: <ComingSoonPage title="Patterns" />,
          },
          {
            path: '/rules',
            element: <ComingSoonPage title="Rules" />,
          },
          {
            path: '/staging',
            element: <ComingSoonPage title="Staging" />,
          },
          {
            path: '/audit',
            element: <ComingSoonPage title="Audit Log" />,
          },
          {
            path: '/settings',
            element: <ComingSoonPage title="Settings" />,
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
