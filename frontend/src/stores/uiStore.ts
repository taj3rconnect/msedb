import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  selectedMailboxId: string | null; // null = aggregate view
  inboxFolder: string;
  activeFolderId: string | null; // Graph folder ID for the active folder
  shortcutsHelpOpen: boolean;
  selectedFolderMailboxId: string | null;
  foldersExpanded: boolean;
  folderSyncRequested: number; // increment to trigger a sync in InboxPage
  toggleSidebar: () => void;
  setSelectedMailbox: (id: string | null) => void;
  setInboxFolder: (folder: string, folderId?: string | null) => void;
  toggleShortcutsHelp: () => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setSelectedFolderMailboxId: (id: string | null) => void;
  toggleFolders: () => void;
  requestFolderSync: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  selectedMailboxId: null,
  inboxFolder: 'inbox',
  activeFolderId: null,
  shortcutsHelpOpen: false,
  selectedFolderMailboxId: null,
  foldersExpanded: false,
  folderSyncRequested: 0,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSelectedMailbox: (id) =>
    set({ selectedMailboxId: id }),

  setInboxFolder: (folder, folderId) =>
    set({ inboxFolder: folder, activeFolderId: folderId ?? null }),

  toggleShortcutsHelp: () =>
    set((state) => ({ shortcutsHelpOpen: !state.shortcutsHelpOpen })),

  setShortcutsHelpOpen: (open) =>
    set({ shortcutsHelpOpen: open }),

  setSelectedFolderMailboxId: (id) =>
    set({ selectedFolderMailboxId: id }),

  toggleFolders: () =>
    set((state) => ({ foldersExpanded: !state.foldersExpanded })),

  requestFolderSync: () =>
    set((state) => ({ folderSyncRequested: state.folderSyncRequested + 1 })),
}));
