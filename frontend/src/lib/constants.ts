import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Inbox,
  Mail,
  Brain,
  Shield,
  Clock,
  FileText,
  Settings,
  ShieldCheck,
} from 'lucide-react';

/**
 * Event type display configuration: labels and Tailwind color classes.
 */
export const EVENT_TYPES: Record<string, { label: string; color: string }> = {
  arrived: { label: 'Arrived', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  deleted: { label: 'Deleted', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  moved: { label: 'Moved', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
  read: { label: 'Read', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  flagged: { label: 'Flagged', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' },
  categorized: { label: 'Categorized', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300' },
};

/**
 * Application route paths.
 */
export const ROUTE_PATHS = {
  dashboard: '/',
  inbox: '/inbox',
  activity: '/activity',
  patterns: '/patterns',
  rules: '/rules',
  staging: '/staging',
  audit: '/audit',
  settings: '/settings',
  admin: '/admin',
  login: '/login',
} as const;

/**
 * Sidebar navigation items.
 */
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: ROUTE_PATHS.dashboard, icon: LayoutDashboard },
  { label: 'Inbox', path: ROUTE_PATHS.inbox, icon: Inbox },
  { label: 'Email Activity', path: ROUTE_PATHS.activity, icon: Mail },
  { label: 'Patterns', path: ROUTE_PATHS.patterns, icon: Brain },
  { label: 'Rules', path: ROUTE_PATHS.rules, icon: Shield },
  { label: 'Staging', path: ROUTE_PATHS.staging, icon: Clock },
  { label: 'Audit Log', path: ROUTE_PATHS.audit, icon: FileText },
  { label: 'Settings', path: ROUTE_PATHS.settings, icon: Settings },
  { label: 'Admin Panel', path: ROUTE_PATHS.admin, icon: ShieldCheck, adminOnly: true },
];
