import { canManageRoles, canOpenUserManagement } from "../../utils/permissions";
import { visibleSources } from "./homeSources";

/**
 * Does this account have anything at all for the home page to show?
 *
 * A module source it may read, or — for a pure portal administrator who holds
 * no module — the Administration shortcuts. Kept apart from the page so the
 * route can ask without loading the (lazy) dashboard bundle.
 */
export function hasAnyHomeContent(user, ctx) {
  return visibleSources(ctx).length > 0 || canOpenUserManagement(user) || canManageRoles(user);
}

export default hasAnyHomeContent;
