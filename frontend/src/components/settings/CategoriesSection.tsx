import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchCategories, createCategory, deleteCategory, type OutlookCategory, type MailboxInfo } from '@/api/settings';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

// Graph API category color presets → CSS colors
export const CATEGORY_COLORS: Record<string, { label: string; bg: string; text: string }> = {
  preset0: { label: 'Red', bg: 'bg-red-500', text: 'text-white' },
  preset1: { label: 'Orange', bg: 'bg-orange-500', text: 'text-white' },
  preset2: { label: 'Yellow', bg: 'bg-yellow-400', text: 'text-black' },
  preset3: { label: 'Green', bg: 'bg-green-500', text: 'text-white' },
  preset4: { label: 'Teal', bg: 'bg-teal-500', text: 'text-white' },
  preset5: { label: 'Olive', bg: 'bg-lime-600', text: 'text-white' },
  preset6: { label: 'Blue', bg: 'bg-blue-500', text: 'text-white' },
  preset7: { label: 'Purple', bg: 'bg-purple-500', text: 'text-white' },
  preset8: { label: 'Cranberry', bg: 'bg-rose-600', text: 'text-white' },
  preset9: { label: 'Steel', bg: 'bg-slate-500', text: 'text-white' },
  preset10: { label: 'Dark Blue', bg: 'bg-blue-800', text: 'text-white' },
  preset11: { label: 'Dark Green', bg: 'bg-green-800', text: 'text-white' },
  preset12: { label: 'Dark Teal', bg: 'bg-teal-800', text: 'text-white' },
  preset13: { label: 'Dark Olive', bg: 'bg-lime-800', text: 'text-white' },
  preset14: { label: 'Dark Red', bg: 'bg-red-800', text: 'text-white' },
  preset15: { label: 'Dark Cranberry', bg: 'bg-rose-900', text: 'text-white' },
  preset16: { label: 'Dark Purple', bg: 'bg-purple-900', text: 'text-white' },
  preset17: { label: 'Gold', bg: 'bg-yellow-600', text: 'text-white' },
  preset18: { label: 'Bronze', bg: 'bg-amber-700', text: 'text-white' },
  preset19: { label: 'Brown', bg: 'bg-stone-700', text: 'text-white' },
  preset20: { label: 'Grey', bg: 'bg-gray-400', text: 'text-white' },
  preset21: { label: 'Dark Grey', bg: 'bg-gray-600', text: 'text-white' },
  preset22: { label: 'Black', bg: 'bg-gray-900', text: 'text-white' },
  none: { label: 'None', bg: 'bg-gray-200', text: 'text-gray-700' },
};

export function categoryColorClass(color: string) {
  return CATEGORY_COLORS[color] ?? CATEGORY_COLORS['none'];
}

interface CategoryBadgeProps {
  name: string;
  color: string;
}

export function CategoryBadge({ name, color }: CategoryBadgeProps) {
  const c = categoryColorClass(color);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {name}
    </span>
  );
}

interface MailboxCategoriesProps {
  mailbox: MailboxInfo;
}

function MailboxCategories({ mailbox }: MailboxCategoriesProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('preset6');

  const { data, isLoading } = useQuery({
    queryKey: ['categories', mailbox.id],
    queryFn: () => fetchCategories(mailbox.id),
  });

  const createMutation = useMutation({
    mutationFn: () => createCategory(mailbox.id, newName.trim(), newColor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', mailbox.id] });
      setNewName('');
      toast.success('Category created');
    },
    onError: () => toast.error('Failed to create category'),
  });

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) => deleteCategory(mailbox.id, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', mailbox.id] });
      toast.success('Category deleted');
    },
    onError: () => toast.error('Failed to delete category'),
  });

  if (isLoading) return <LoadingSpinner />;

  const categories: OutlookCategory[] = data?.categories ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{mailbox.email}</CardTitle>
        <CardDescription>
          Outlook categories (color labels) synced from your mailbox. Assign categories to emails in the inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-1 group">
              <CategoryBadge name={cat.displayName} color={cat.color} />
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(cat.id)}
                title="Delete category"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t pt-3 space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Add Category</Label>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Category name"
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMutation.mutate(); }}
            />
            <Select value={newColor} onValueChange={setNewColor}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {Object.entries(CATEGORY_COLORS)
                  .filter(([k]) => k !== 'none')
                  .map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-3 h-3 rounded-sm ${val.bg}`} />
                        {val.label}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8"
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface CategoriesSectionProps {
  settings: { mailboxes: MailboxInfo[] };
}

export function CategoriesSection({ settings }: CategoriesSectionProps) {
  const { mailboxes } = settings;

  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No mailboxes connected.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => (
        <MailboxCategories key={mailbox.id} mailbox={mailbox} />
      ))}
    </div>
  );
}
