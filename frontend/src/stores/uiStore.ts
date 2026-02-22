import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  selectedMailboxId: string | null; // null = aggregate view
  inboxFolder: 'inbox' | 'deleted';
  shortcutsHelpOpen: boolean;
  toggleSidebar: () => void;
  setSelectedMailbox: (id: string | null) => void;
  setInboxFolder: (folder: 'inbox' | 'deleted') => void;
  toggleShortcutsHelp: () => void;
  setShortcutsHelpOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  selectedMailboxId: null,
  inboxFolder: 'inbox',
  shortcutsHelpOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSelectedMailbox: (id) =>
    set({ selectedMailboxId: id }),

  setInboxFolder: (folder) =>
    set({ inboxFolder: folder }),

  toggleShortcutsHelp: () =>
    set((state) => ({ shortcutsHelpOpen: !state.shortcutsHelpOpen })),

  setShortcutsHelpOpen: (open) =>
    set({ shortcutsHelpOpen: open }),
}));
