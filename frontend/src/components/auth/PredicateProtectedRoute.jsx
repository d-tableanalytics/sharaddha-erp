import { Outlet } from "react-router-dom";

import { useUserStore } from "../../store/userStore";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { Unauthorized } from "../common/Unauthorized";

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
 * A refusal renders <Unauthorized/>, so the user is told why the screen did not
 * open instead of landing on Home with no explanation.
 */
export function PredicateProtectedRoute({ allow }) {
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

  if (!user || !allow(user)) return <Unauthorized />;

  return <Outlet />;
}

export default PredicateProtectedRoute;
