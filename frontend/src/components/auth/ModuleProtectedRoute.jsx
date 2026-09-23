import { Navigate, Outlet } from "react-router-dom";

import { usePermissions } from "../../hooks/usePermissions";
import { LoadingSpinner } from "../ui/LoadingSpinner";

/**
 * Route guard in matrix terms.
 *
 *   <ModuleProtectedRoute module="work_queue" submodule="trash" action="view" />
 *
 * ---------------------------------------------------------------------------
 * WHY NOT O2dProtectedRoute
 * ---------------------------------------------------------------------------
 *
 * That guard asks for ONE flat permission key, and every Work Queue route was
 * mounted under it with its default — `view_o2d`. So the Trash Bin, the
 * Executive Scoreboard and the Activities audit log were all reachable by
 * anyone who could open FMS, and unreachable by anyone granted the Work Queue
 * without it. A guard that can only ask one question gets used to ask the wrong
 * one.
 *
 * This asks the cell, which is what the sidebar asks and what
 * `authorizeModule` asks on the server. One vocabulary across the three, so a
 * link, a page and an endpoint cannot disagree about who may be here.
 *
 * ---------------------------------------------------------------------------
 * NOT THE ENFORCEMENT POINT
 * ---------------------------------------------------------------------------
 *
 * Every endpoint behind these screens re-checks. This exists so somebody who
 * cannot use a module does not land on a page that will 403 every call it
 * makes, not to keep anyone out.
 */
export function ModuleProtectedRoute({
  module: moduleKey,
  submodule,
  action = "view",
  redirectTo = "/",
}) {
  const { can, loading } = usePermissions();

  /**
   * Wait before judging.
   *
   * Grants arrive with /auth/me. Deciding during that window would bounce a
   * legitimate user to the dashboard before their permissions landed - the same
   * reason O2dProtectedRoute waits, and the reason `can()` failing closed is
   * right for a button and wrong for a redirect.
   */
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (!can(moduleKey, submodule, action)) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}

export default ModuleProtectedRoute;
