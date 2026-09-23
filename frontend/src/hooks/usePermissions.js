import { useMemo } from "react";

import { useUserStore } from "../store/userStore";
import { canAction, hasPermission, permissionsFor } from "../utils/permissions";

/**
 * Portal authorization for the UI, in the shape the permission matrix uses.
 *
 * ---------------------------------------------------------------------------
 * WHY A HOOK RATHER THAN MORE canXxx() HELPERS
 * ---------------------------------------------------------------------------
 *
 * utils/permissions.js had grown to 570 lines of bespoke questions -
 * `canEditBoxNo`, `canViewLineItemBoxNo`, `canAdjustStock` - each one a hand
 * written sentence about one screen. That works while the questions are few and
 * stops working at the point this change reaches: every module, every
 * sub-module, five actions each. Written out as helpers that is several hundred
 * functions, and no reviewer can tell from the name whether
 * `canUseInventoryMaster` is a view check or an edit check.
 *
 * So screens ask the CELL instead, in the same words the Super Admin ticked:
 *
 *   const { can } = usePermissions();
 *   if (can('work_queue', 'tasks', 'create')) { ... }
 *
 * The answer comes from the `grants` the server resolved and sent with
 * /auth/me - the same computation `can()` runs in the middleware when the
 * request arrives - so the button and the endpoint agree by construction rather
 * than by two files being kept in step by hand.
 *
 * The existing helpers are NOT deprecated by this. They answer questions that
 * are genuinely about a rule rather than a cell (`canManageAccount` is about
 * the TARGET account's role), and those keep their home.
 *
 * ---------------------------------------------------------------------------
 * NEVER THE ENFORCEMENT POINT
 * ---------------------------------------------------------------------------
 *
 * Every endpoint re-checks. Hiding a button is how the UI stays honest about
 * what it offers; it is not how access is controlled, and a screen that relies
 * on this alone is a screen with a permission bug.
 *
 * `loading` is exposed because "not allowed" and "we do not know yet" look the
 * same to `can()` and must not look the same to a page deciding whether to
 * redirect. Checks FAIL CLOSED while the profile is in flight, which is right
 * for a button and wrong for a redirect - so a guard waits on `loading` and a
 * button does not.
 */
export function usePermissions() {
  const user = useUserStore((s) => s.user);
  const loading = useUserStore((s) => s.loading);

  return useMemo(
    () => ({
      user,
      loading,

      /** May this user take `action` on this sub-module? */
      can: (moduleKey, submoduleKey, action) =>
        canAction(user, moduleKey, submoduleKey, action),

      /**
       * ANY of these actions - for a toolbar that should appear when the user
       * can do at least one of the things in it.
       */
      canAny: (moduleKey, submoduleKey, actions = []) =>
        actions.some((action) => canAction(user, moduleKey, submoduleKey, action)),

      /**
       * A flat permission key, for the capabilities that have no cell of their
       * own - and for the handful of checks that predate the matrix.
       */
      has: (permissionKey) => hasPermission(user, permissionKey),

      /** The resolved key list, for a screen that needs to reason over it. */
      permissions: permissionsFor(user),
    }),
    [user, loading],
  );
}

export default usePermissions;
