import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { RulePopupModal } from '@/components/shared/RulePopupModal';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const EmailActivityPage = lazy(() => import('@/pages/EmailActivityPage').then((m) => ({ default: m.EmailActivityPage })));
const PatternsPage = lazy(() => import('@/pages/PatternsPage').then((m) => ({ default: m.PatternsPage })));
const RulesPage = lazy(() => import('@/pages/RulesPage').then((m) => ({ default: m.RulesPage })));
const StagingPage = lazy(() => import('@/pages/StagingPage').then((m) => ({ default: m.StagingPage })));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AdminPage = lazy(() => import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const InboxPage = lazy(() => import('@/pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const ContactsPage = lazy(() => import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const PendingMessagesPage = lazy(() => import('@/pages/PendingMessagesPage').then((m) => ({ default: m.PendingMessagesPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));

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

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AppShell />
    </Suspense>
  );
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

// --- Admin Guard ---

/**
 * AdminGuard redirects non-admin users to the dashboard.
 * Backend requireAdmin middleware provides the real security boundary.
 */
function AdminGuard() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <AdminPage />;
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
            path: '/inbox',
            element: <InboxPage />,
          },
          {
            path: '/inbox/:mailboxId',
            element: <InboxPage />,
          },
          {
            path: '/contacts',
            element: <ContactsPage />,
          },
          {
            path: '/pending',
            element: <PendingMessagesPage />,
          },
          {
            path: '/activity',
            element: <EmailActivityPage />,
          },
          {
            path: '/patterns',
            element: <PatternsPage />,
          },
          {
            path: '/rules',
            element: <RulesPage />,
          },
          {
            path: '/staging',
            element: <StagingPage />,
          },
          {
            path: '/audit',
            element: <AuditLogPage />,
          },
          {
            path: '/reports',
            element: <ReportsPage />,
          },
          {
            path: '/settings',
            element: <SettingsPage />,
          },
          {
            path: '/admin',
            element: <AdminGuard />,
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
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster />
      <RulePopupModal />
    </QueryClientProvider>
  );
}
