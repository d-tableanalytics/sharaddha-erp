import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert, LogOut } from "lucide-react";
import toast from "react-hot-toast";

import { useHrmsPermissions } from "../../hooks/useHrmsPermissions";
import { useHrmsStore } from "../../store/hrmsStore";
import { useUserStore } from "../../store/userStore";
import { canOpenUserManagement, canManageRoles } from "../../utils/permissions";

/**
 * The front door, and the one route that had to be INVENTED for the split.
 *
 * ---------------------------------------------------------------------------
 * Why "/" cannot simply redirect to /hrms/dashboard
 * ---------------------------------------------------------------------------
 * `HrmsProtectedRoute` sends an account with no HRMS access to "/". In the
 * Customer Portal that was a real destination — the booking dashboard — so the
 * redirect landed somewhere useful and the shared shell carried on.
 *
 * Here there is no booking dashboard. A blanket `"/" -> "/hrms/dashboard"`
 * would bounce such an account back into the guard, which would bounce it to
 * "/" again: an infinite redirect for exactly the accounts AD-4 is about.
 *
 * So "/" resolves the actor first, and only then decides. An HRMS user goes
 * where they always went. An account without HRMS access is TOLD so — this is
 * the one place in the app where saying it out loud is right, because unlike
 * the shared shell there is nothing else here for them to be doing, and a
 * silent bounce would look like a broken sign-in.
 *
 * A portal administrator who is not an HRMS user is the case worth handling:
 * they may hold MANAGE_USERS or MANAGE_ROLES and be here precisely to grant
 * somebody HRMS access, so they are offered Administration rather than a dead
 * end.
 */
export const HomeRoute = () => {
  const loaded = useHrmsStore((s) => s.loaded);
  const loading = useHrmsStore((s) => s.loading);
  const { hasAccess } = useHrmsPermissions();
  const { user, logout } = useUserStore();

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

  if (hasAccess) return <Navigate to="/hrms/dashboard" replace />;

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
          this account holds no HRMS role. Ask an administrator to grant one from Roles &amp;
          Permissions.
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
