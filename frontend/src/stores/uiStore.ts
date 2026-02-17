import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  selectedMailboxId: string | null; // null = aggregate view
  toggleSidebar: () => void;
  setSelectedMailbox: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  selectedMailboxId: null,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSelectedMailbox: (id) =>
    set({ selectedMailboxId: id }),
}));
