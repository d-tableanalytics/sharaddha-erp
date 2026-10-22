import { Navigate, Outlet } from "react-router-dom";

import { useUserStore } from "../../store/userStore";
import { LoadingSpinner } from "../ui/LoadingSpinner";

/**
 * Route guard for a screen whose rule is a function of the user.
 *
 *   <PredicateProtectedRoute allow={canManageRoles} />
 *
 * The rule is the SAME helper the sidebar calls to decide whether to draw the
 * link (`canOpenUserManagement`, `canManageRoles`, a single `hasPermission`),
 * so a link and its URL cannot disagree about who may be here.
 *
 * Not the enforcement point — every endpoint behind these screens re-checks.
 * It redirects rather than rendering a refusal, so a typed URL confirms nothing.
 */
export function PredicateProtectedRoute({ allow, redirectTo = "/" }) {
  const user = useUserStore((s) => s.user);
  const loading = useUserStore((s) => s.loading);

  // Grants arrive with /auth/me; judging earlier would bounce a legitimate user.
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user || !allow(user)) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}

export default PredicateProtectedRoute;
