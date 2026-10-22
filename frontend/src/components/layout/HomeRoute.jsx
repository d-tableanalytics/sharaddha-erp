import { lazy } from "react";
import { Loader2, ShieldAlert, LogOut } from "lucide-react";
import toast from "react-hot-toast";

import { useHrmsStore } from "../../store/hrmsStore";
import { useUserStore } from "../../store/userStore";
import { canOpenUserManagement, canManageRoles } from "../../utils/permissions";
import { useHomeContext } from "../../pages/Home/useHomeSources";
import { hasAnyHomeContent } from "../../pages/Home/homeAccess";

// Lazy, like every other page: MainLayout's Suspense covers it.
const HomeDashboard = lazy(() => import("../../pages/Home/HomeDashboard").then((m) => ({ default: m.HomeDashboard })));

/**
 * The front door: the common home dashboard, for every account.
 *
 * ---------------------------------------------------------------------------
 * What changed, and why
 * ---------------------------------------------------------------------------
 * "/" used to redirect HRMS users to /hrms/dashboard and tell everybody else
 * they had "No Employee Portal access". That was wrong for a whole class of
 * accounts: Billing and Accounts hold no HRMS role at all, yet work FMS orders
 * and the Work Queue every day — and they were greeted with a refusal on every
 * sign-in, one click away from screens they could open.
 *
 * Now "/" renders the home dashboard, which asks each module the same
 * permission question its own route asks and shows only what answers yes. The
 * HR Dashboard stays where it was, as the deep HR view the home page links to.
 *
 * ---------------------------------------------------------------------------
 * Why it still waits for the HRMS actor
 * ---------------------------------------------------------------------------
 * The page's HRMS cards are decided by the actor `/hrms/me` resolves. Rendering
 * before it lands would request the Work Queue sources, then re-render and
 * request the HRMS ones a moment later — and, for an account that turns out to
 * have nothing, flash a dashboard before the refusal.
 *
 * ---------------------------------------------------------------------------
 * The refusal is kept, for accounts with genuinely nothing
 * ---------------------------------------------------------------------------
 * No module, no quick action. Saying so is right: a blank dashboard would look
 * like a broken sign-in. A portal administrator is still offered Roles &
 * Permissions, since they may be here precisely to grant access.
 */
export const HomeRoute = () => {
  const loaded = useHrmsStore((s) => s.loaded);
  const loading = useHrmsStore((s) => s.loading);
  const userLoading = useUserStore((s) => s.loading);
  const { user, ctx } = useHomeContext();
  const logout = useUserStore((s) => s.logout);

  if (!loaded || loading || userLoading) {
    return (
      <div className="w-full flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="animate-spin text-primary-600" size={28} />
        <span className="text-sm font-semibold text-slate-500 select-none">
          Loading your dashboard…
        </span>
      </div>
    );
  }

  if (hasAnyHomeContent(user, ctx)) return <HomeDashboard />;

  const canAdminister = canOpenUserManagement(user) || canManageRoles(user);

  return (
    <div className="w-full flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl shadow-enterprise p-8 text-center select-none">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={22} />
        </div>
        <h1 className="text-lg font-black text-slate-900">No Employee Portal access</h1>
        <p className="text-sm text-slate-500 font-medium mt-2 leading-relaxed">
          You are signed in as <span className="font-bold text-slate-700">{user?.email}</span>, but
          this account has not been granted any Employee Portal module yet. Ask an administrator
          to grant access from Roles &amp; Permissions.
        </p>

        <div className="flex items-center justify-center gap-2 mt-6">
          {canAdminister && (
            <a
              href="/admin/permissions"
              className="px-4 py-2 rounded-lg text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              Roles &amp; Permissions
            </a>
          )}
          <button
            onClick={() => {
              logout();
              toast.success("Successfully logged out.");
            }}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors inline-flex items-center gap-2"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
export default HomeRoute;
