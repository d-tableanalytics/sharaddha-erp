import { usePermissions } from "../../hooks/usePermissions";

/**
 * Render children only when the user holds this cell.
 *
 *   <Can module="work_queue" submodule="tasks" action="create">
 *     <Button onClick={openCreateDrawer}>Assign Task</Button>
 *   </Can>
 *
 * ---------------------------------------------------------------------------
 * WHY A COMPONENT AS WELL AS THE HOOK
 * ---------------------------------------------------------------------------
 *
 * Both exist because the two shapes fail differently. A hook is right when the
 * answer feeds a decision - disabling a row, filtering a menu, choosing what to
 * fetch. This is right when the answer decides whether a block of JSX exists at
 * all, because the alternative is `{canCreate && (...)}` repeated across a
 * hundred call sites, and a `&&` is easy to write as `||` and impossible to
 * grep for.
 *
 * `<Can>` is greppable. "Which buttons are gated on work_queue delete" is one
 * search, and a button that is NOT wrapped is visibly not wrapped.
 *
 * ---------------------------------------------------------------------------
 * FAILS CLOSED
 * ---------------------------------------------------------------------------
 *
 * Renders nothing while the profile is loading and nothing when the grant is
 * absent. A button that appears for a moment and then vanishes is worse than
 * one that appears a moment late, and a button that appears because the answer
 * had not arrived yet is a 403 the user did not need to see.
 *
 * `fallback` is for the cases where the absence needs to say something - a
 * disabled control with a reason, or a read-only rendering of the same field.
 * Most call sites want the default, which is to render nothing at all.
 */
export function Can({
  module: moduleKey,
  submodule,
  action,
  /** Any ONE of these is enough. Use instead of `action`, not with it. */
  anyOf,
  fallback = null,
  children,
}) {
  const { can, canAny } = usePermissions();

  const allowed = anyOf?.length
    ? canAny(moduleKey, submodule, anyOf)
    : can(moduleKey, submodule, action);

  if (!allowed) return fallback;

  // A function child gets told what was decided, for the rare control that
  // wants to render itself disabled rather than disappear.
  return typeof children === "function" ? children(allowed) : children;
}

export default Can;
