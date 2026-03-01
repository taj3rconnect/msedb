import { create } from 'zustand';

interface RulePopup {
  message: string;
  sender: string;
  subject: string;
}

interface RulePopupStore {
  popup: RulePopup | null;
  showPopup: (popup: RulePopup) => void;
  dismissPopup: () => void;
}

export const useRulePopupStore = create<RulePopupStore>((set) => ({
  popup: null,
  showPopup: (popup) => set({ popup }),
  dismissPopup: () => set({ popup: null }),
}));
