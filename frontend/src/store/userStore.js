import { create } from "zustand";
import { usersApi } from "../services/users";
import { useHrmsStore } from "./hrmsStore";

/**
 * The signed-in portal session.
 *
 * Same shape, same endpoints and same localStorage key as the Customer
 * Portal's store — the two authenticate the same accounts against the same
 * `users` collection with the same JWT secret. What is gone is the Customer
 * Portal's realtime and notification wiring:
 *
 *   • `refreshSocketAuth()` — the socket carries inventory alerts, which are a
 *     Customer Portal concern. HRMS's notification centre polls (see the inbox
 *     bell), so this app opens no socket at all.
 *   • `useNotificationStore().clear()` — that store holds inventory alerts too.
 *
 * Removing them here rather than importing the store and ignoring it is what
 * keeps `socket.io-client` out of this bundle entirely.
 */
export const useUserStore = create((set) => ({
  user: null,
  loading: !!localStorage.getItem('token'),
  error: null,

  login: async (credentials) => {
    set({ loading: true, error: null });
    try {
      const { token } = await usersApi.login(credentials);
      localStorage.setItem('token', token);

      const user = await usersApi.getCurrentUser();
      set({ user, loading: false });

      /**
       * Re-resolve the HRMS actor, which is stale by definition at this point.
       *
       * App.jsx resolves it once at startup. On a sign-in page there is no
       * token yet, so that first call took the "no token" branch and recorded
       * `loaded: true` with a null actor — the correct answer for a signed-out
       * browser, and one that then never gets revisited, because `load()`
       * short-circuits on `loaded` and nothing else here touches the store.
       *
       * `force` is required: the point is to override that recorded answer.
       *
       * Deliberately NOT awaited. The store's own contract is that the shell
       * never waits on an HRMS request, `load()` catches its own errors and
       * never rejects, and the sidebar re-renders when the actor lands.
       */
      useHrmsStore.getState().load({ force: true });

      return true;
    } catch (err) {
      set({ error: err.response?.data?.message || "Login failed", loading: false });
      return false;
    }
  },

  fetchUser: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ user: null, loading: false });
      return;
    }

    set({ loading: true, error: null });
    try {
      const user = await usersApi.getCurrentUser();
      set({ user, loading: false });
    } catch (err) {
      // Only a 401 means the token is actually bad. Discarding it on any error
      // (a 429, or the API being down) logs the user out over a transient blip.
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        set({ error: "Session expired", user: null, loading: false });
      } else {
        set({ error: "Could not load your session", loading: false });
      }
    }
  },

  updateProfile: async (updates) => {
    try {
      const user = await usersApi.updateProfile(updates);
      set({ user });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || 'Failed to update profile' };
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    try {
      await usersApi.changePassword(currentPassword, newPassword);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || 'Failed to change password' };
    }
  },

  logout: async () => {
    // Revoke server-side first so the refresh cookie cannot be exchanged again;
    // usersApi.logout never rejects, so the local clear below always runs.
    await usersApi.logout();
    localStorage.removeItem('token');
    set({ user: null });
    // Drop the HRMS actor too, or the next person to sign in on this browser
    // briefly sees the previous user's HRMS menu.
    useHrmsStore.getState().clear();
  },
}));
