import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  selectedMailboxId: string | null; // null = aggregate view
  inboxFolder: 'inbox' | 'deleted';
  toggleSidebar: () => void;
  setSelectedMailbox: (id: string | null) => void;
  setInboxFolder: (folder: 'inbox' | 'deleted') => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  selectedMailboxId: null,
  inboxFolder: 'inbox',

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSelectedMailbox: (id) =>
    set({ selectedMailboxId: id }),

  setInboxFolder: (folder) =>
    set({ inboxFolder: folder }),
}));
