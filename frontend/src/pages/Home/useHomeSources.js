import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "../../store/userStore";
import { useHrmsPermissions } from "../../hooks/useHrmsPermissions";
import { canAction, hasPermission } from "../../utils/permissions";

/**
 * The permission context every home-dashboard source is asked about.
 *
 * Built in one place so the route that decides whether there is a home page at
 * all and the page that renders it ask the identical questions: the portal
 * grants `/auth/me` resolved, and the HRMS actor `/hrms/me` resolved.
 */
export function useHomeContext() {
  const user = useUserStore((s) => s.user);
  const hrms = useHrmsPermissions();

  const ctx = useMemo(
    () => ({
      userId: user?._id ?? user?.id ?? null,
      can: (m, s, a) => canAction(user, m, s, a),
      has: (key) => hasPermission(user, key),
      hrms: {
        can: hrms.can,
        uses: hrms.usesModule,
        employeeId: hrms.actor?.employeeId ?? null,
      },
    }),
    [user, hrms],
  );

  return { user, ctx };
}

/**
 * Load every home-dashboard source the viewer may see, each on its own.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH SOURCE SETTLES INDEPENDENTLY
 * ---------------------------------------------------------------------------
 * The home page reads from up to a dozen existing endpoints across three
 * systems (HRMS, FMS, the Work Queue). One of them being slow or failing must
 * not blank the others — a 500 from payroll is no reason to hide somebody's
 * overdue tasks. So each source has its own `{ status, data, error }`, and a
 * card renders its own loading and error states.
 *
 * ---------------------------------------------------------------------------
 * ONLY WHAT WAS PERMITTED IS EVER REQUESTED
 * ---------------------------------------------------------------------------
 * The caller passes the sources already filtered by `visible(ctx)`, so an
 * endpoint the viewer cannot use is never called — the page does not fire a
 * request just to receive a 403 and hide the card afterwards.
 *
 * `generation` guards against a slow response from an earlier load landing
 * after a refresh (or after the visible set changed) and overwriting newer data.
 */
export function useHomeSources(sources, ctx) {
  const [state, setState] = useState({});
  const generation = useRef(0);

  // Re-load when the SET of sources changes, not when the array is re-created.
  const signature = sources.map((s) => s.key).join("|");
  const sourcesRef = useRef(sources);
  const ctxRef = useRef(ctx);
  // Declared before the load effect, so it runs first and `load` sees the
  // sources and context of the render that scheduled it.
  useEffect(() => {
    sourcesRef.current = sources;
    ctxRef.current = ctx;
  });

  const load = useCallback(async () => {
    const run = ++generation.current;
    const current = sourcesRef.current;

    setState((prev) =>
      Object.fromEntries(
        current.map((s) => [
          s.key,
          // Keep what is on screen during a refresh; only a first load shows skeletons.
          prev[s.key]?.status === "ready"
            ? { ...prev[s.key], refreshing: true }
            : { status: "loading" },
        ]),
      ),
    );

    await Promise.all(
      current.map(async (source) => {
        let next;
        try {
          next = { status: "ready", data: await source.load(ctxRef.current) };
        } catch (error) {
          next = { status: "error", error };
        }
        if (run !== generation.current) return;
        setState((prev) => ({ ...prev, [source.key]: next }));
      }),
    );
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  /** One card's Retry: re-request that source alone. */
  const retry = useCallback(async (key) => {
    const source = sourcesRef.current.find((s) => s.key === key);
    if (!source) return;
    const run = generation.current;
    setState((prev) => ({ ...prev, [key]: { status: "loading" } }));
    let next;
    try {
      next = { status: "ready", data: await source.load(ctxRef.current) };
    } catch (error) {
      next = { status: "error", error };
    }
    if (run !== generation.current) return;
    setState((prev) => ({ ...prev, [key]: next }));
  }, []);

  const refreshing = Object.values(state).some((s) => s.status === "loading" || s.refreshing);

  return { state, reload: load, retry, refreshing };
}

export default useHomeSources;
