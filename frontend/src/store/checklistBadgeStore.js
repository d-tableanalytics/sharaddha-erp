import { create } from "zustand";

import { checklistApi } from "../services/checklist";

/**
 * How many Checklist tasks are new for the signed-in person — the sidebar badge.
 *
 * Shared so the Checklist page can clear the badge the moment it marks the list
 * seen, instead of the sidebar showing a stale count until its next poll.
 */
export const useChecklistBadgeStore = create((set) => ({
  newCount: 0,
  refresh: async () => {
    try {
      const data = await checklistApi.getNewCount();
      set({ newCount: data?.count ?? 0 });
    } catch {
      // A badge is a convenience; the next poll restores the truth.
    }
  },
  clear: () => set({ newCount: 0 }),
}));

export default useChecklistBadgeStore;
