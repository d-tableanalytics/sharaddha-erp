import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { useHrmsStore } from "../../store/hrmsStore";
import { useHrmsPermissions } from "../../hooks/useHrmsPermissions";
import { HRMS_NAV_ITEMS } from "./navItems";
import { Unauthorized } from "../common/Unauthorized";

/**
 * Route guard for everything under /hrms.
 *
 * Sits INSIDE the portal's existing ProtectedRoute, so authentication is
 * already settled by the time this runs. What it adds is the AD-4 check: being
 * signed in is not being an HRMS user.
 *
 * ---------------------------------------------------------------------------
 * Hiding the nav is not access control
 * ---------------------------------------------------------------------------
 * A customer typing /hrms/employees into the address bar must be stopped here,
 * and every HRMS endpoint re-checks server-side regardless. This guard exists
 * so the denial is immediate and quiet, not so the API can relax.
 *
 * A refusal renders <Unauthorized/> (2026-11-17). It used to redirect home
 * silently, on the theory that an error page confirms the route exists; but
 * the route list is already public in the bundle, this portal serves only
 * internal staff, and a silent bounce left people who lost access mid-session
 * with no explanation. A module that is permitted but not BUILT yet still
 * redirects to the HR dashboard: that is not an access decision.
 *
 * @param {string} [module]  additionally require this HRMS module
 * @param {Array<{module:string,action:string,scope:string}>} [anyOf]
 *   ANY-OF permission specs that grant entry, for a module whose sidebar gate
 *   is wider than its own key. Reports is the case: `reports:payroll`,
 *   `reports:hiring`, `reports:assets` and `reports:team` all admit a user, so
 *   gating on `reports` alone would show four roles a nav item that bounces
 *   them. `module` is still required and still decides whether the module is
 *   BUILT — `anyOf` replaces only the permission half of that check.
 * @param {string} [navKey]
 *   The key of the sidebar item this route is the destination of. The route
 *   then asks EXACTLY the question the sidebar asked — that item's `requires`
 *   list — instead of the looser "holds any grant on the module". Without it a
 *   self-scope account, which sees no Employees link, could still open
 *   /hrms/employees by URL: `usesModule` is true for any grant at all. One list
 *   decides both, so a link and its page cannot disagree about who may be here.
 */
export function HrmsProtectedRoute({ module, anyOf = null, navKey = null }) {
  const load = useHrmsStore((s) => s.load);
  const loaded = useHrmsStore((s) => s.loaded);
  const loading = useHrmsStore((s) => s.loading);
  const { hasAccess, seesModule, can, implementedModules } = useHrmsPermissions();
  const location = useLocation();

  useEffect(() => {
    load();
  }, [load]);

  // Deciding before the actor is known would bounce an HRMS user on a cold
  // load, so hold until the answer is in.
  if (!loaded || loading) {
    return (
      <div className="w-full flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="animate-spin text-primary-600" size={28} />
        <span className="text-sm font-semibold text-slate-500 select-none">
          Checking HRMS access…
        </span>
      </div>
    );
  }

  if (!hasAccess) return <Unauthorized />;

  // `usesModule`, not `seesModule`: a module the actor is entitled to but that
  // is not built yet must not render a blank page either.
  //
  // With `anyOf`, the two halves are checked separately — built is still
  // `implementedModules`, but permitted is the wider ANY-OF, so this matches
  // whatever `visibleHrmsNavItems` used to decide the nav entry.
  const navItem = navKey ? HRMS_NAV_ITEMS.find((item) => item.key === navKey) : null;
  // A navKey that matches nothing fails closed: a typo must not open a page.
  if (navKey && !navItem) return <Navigate to="/" replace />;

  const gateModule = navItem?.module ?? module;
  const specs = navItem?.requires ?? anyOf;
  // Permitted and built are asked separately so a refusal can say so, while a
  // permitted-but-unbuilt module keeps its redirect to the dashboard.
  const permitted = specs
    ? specs.some((r) => can(r.module, r.action, r.scope))
    : seesModule(module);
  const built = implementedModules.includes(gateModule);

  if (gateModule && !permitted) return <Unauthorized />;

  if (gateModule && !built) {
    // The HR dashboard is the usual landing spot, but it is itself gated — an
    // actor refused HERE would loop on a redirect to it. Fall back to "/".
    const dashboard = HRMS_NAV_ITEMS.find((item) => item.key === "hrms-dashboard");
    const dashboardOpen =
      dashboard.requires.some((r) => can(r.module, r.action, r.scope)) &&
      implementedModules.includes(dashboard.module);
    const onDashboard = location.pathname.startsWith(dashboard.path);
    return <Navigate to={dashboardOpen && !onDashboard ? dashboard.path : "/"} replace />;
  }

  return <Outlet />;
}

export default HrmsProtectedRoute;
