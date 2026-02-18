import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/authStore';
import {
  useAdminUsers,
  useInviteUser,
  useChangeRole,
  useDeactivateUser,
} from '@/hooks/useAdmin';
import { formatRelativeTime } from '@/lib/formatters';

/**
 * User management section with invite form and user table.
 * Supports invite, role change, and deactivation with self-protection.
 */
export function UserManagement() {
  const currentUser = useAuthStore((s) => s.user);
  const { data: users, isLoading } = useAdminUsers();
  const inviteMutation = useInviteUser();
  const changeRoleMutation = useChangeRole();
  const deactivateMutation = useDeactivateUser();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    email: string;
  } | null>(null);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inviteEmail.trim();
    if (!trimmed || !trimmed.includes('@')) return;
    inviteMutation.mutate(
      { email: trimmed, role: inviteRole },
      {
        onSuccess: () => {
          setInviteEmail('');
          setInviteRole('user');
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="invite-email" className="text-sm font-medium mb-1 block">
            Email
          </label>
          <Input
            id="invite-email"
            type="email"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
        </div>
        <div className="w-32">
          <label htmlFor="invite-role" className="text-sm font-medium mb-1 block">
            Role
          </label>
          <Select value={inviteRole} onValueChange={setInviteRole}>
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={inviteMutation.isPending}>
          {inviteMutation.isPending ? 'Inviting...' : 'Invite'}
        </Button>
      </form>

      {/* User table */}
      {isLoading ? (
        <Skeleton className="h-[300px] rounded-xl" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[60px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users && users.length > 0 ? (
                users.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      <TableCell>{user.displayName ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.isActive ? 'default' : 'destructive'}
                          className={
                            user.isActive
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 hover:bg-green-100'
                              : ''
                          }
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.lastLoginAt
                          ? formatRelativeTime(user.lastLoginAt)
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        {/* Self-protection: no actions for current user */}
                        {!isSelf && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  changeRoleMutation.mutate({
                                    userId: user.id,
                                    role: user.role === 'admin' ? 'user' : 'admin',
                                  })
                                }
                              >
                                {user.role === 'admin'
                                  ? 'Change to User'
                                  : 'Change to Admin'}
                              </DropdownMenuItem>
                              {user.isActive && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() =>
                                    setDeactivateTarget({
                                      id: user.id,
                                      email: user.email,
                                    })
                                  }
                                >
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Deactivate confirmation dialog */}
      <AlertDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate{' '}
              <span className="font-semibold">{deactivateTarget?.email}</span>?
              This will prevent them from accessing the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deactivateTarget) {
                  deactivateMutation.mutate(deactivateTarget.id);
                  setDeactivateTarget(null);
                }
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
