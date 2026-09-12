import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useEffect } from "react";

import { router } from "./routes";
import { useUserStore } from "./store/userStore";
import { useThemeStore } from "./store/themeStore";
import { useHrmsStore } from "./store/hrmsStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * The Employee Portal shell.
 *
 * Identical to the Customer Portal's App, minus `initSocket()` — the socket
 * carried inventory alerts, which do not exist here.
 *
 * `loadHrms()` is still resolved once at startup so the sidebar knows what to
 * show. It returns 403 for an account with no HRMS role, which the store
 * treats as the expected "no HRMS access" answer rather than an error, so a
 * sign-in is never blocked by it — HomeRoute then explains the situation.
 */
function App() {
  const fetchUser = useUserStore((state) => state.fetchUser);
  const initTheme = useThemeStore((state) => state.initTheme);
  const loadHrms = useHrmsStore((state) => state.load);

  useEffect(() => {
    initTheme();
    fetchUser();
    loadHrms();
  }, [fetchUser, initTheme, loadHrms]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          className:
            "text-xs font-bold text-slate-800 bg-white border border-slate-200 shadow-enterprise rounded-lg px-4 py-2.5 select-none",
          duration: 3500,
        }}
      />
    </QueryClientProvider>
  );
}

export default App;
