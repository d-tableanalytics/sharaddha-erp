import { create } from "zustand";

// Theme is one of: 'light' | 'dark' | 'system'. 'system' follows the OS setting.
const STORAGE_KEY = "theme";

const getStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || "system";
  } catch {
    return "system";
  }
};

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

// Resolve a theme setting into the concrete mode to render.
const resolveMode = (theme) =>
  theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;

// Apply the resolved mode to the <html> element. A `.dark` class drives the
// CSS override layer; `data-theme` is available for any explicit hooks.
export const applyTheme = (theme) => {
  if (typeof document === "undefined") return;
  const mode = resolveMode(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.setAttribute("data-theme", mode);
};

export const useThemeStore = create((set, get) => ({
  theme: getStored(),

  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
    applyTheme(theme);
    set({ theme });
  },

  // Call once at app start: apply the persisted theme and keep 'system' in sync
  // with live OS changes.
  initTheme: () => {
    applyTheme(get().theme);
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        if (get().theme === "system") applyTheme("system");
      };
      mq.addEventListener?.("change", handler);
    }
  },
}));
