/**
 * The flat key the permission grid is built on, and the module grouping.
 *
 * A `Set` of `${module}|${action}|${scope}` strings — rather than nested
 * objects — is what keeps the widget simple: a checkbox's state is one
 * `Set.has`, bulk operations are set arithmetic, and the save handler splits
 * back to triples. `|` is safe because no module, action or scope value
 * contains it; sub-modules use `:`.
 *
 * Their own module so the grid file exports only components (fast refresh),
 * and so the round trip can be tested without rendering anything.
 */

export const permKey = (module, action, scope) => `${module}|${action}|${scope}`;

export const parsePermKey = (key) => {
  const [module, action, scope] = key.split("|");
  return { module, action, scope };
};

/**
 * Sub-modules grouped under their parent: `[['employees', ['employees',
 * 'employees:compensation']], …]`, in the order the server sent them.
 *
 * `employees:compensation` and `helpdesk:it` are separate module keys, not a
 * fourth axis — that is what lets a Payroll Admin see salary-linked data
 * without the whole employee record. Listing them as eleven more top-level
 * cards would bury that relationship.
 */
export function groupModules(modules) {
  const groups = new Map();
  for (const module of modules) {
    const parent = module.includes(":") ? module.split(":")[0] : module;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(module);
  }
  return [...groups.entries()];
}

// ---------------------------------------------------------------------------
// Permission dependencies
// ---------------------------------------------------------------------------

/**
 * Everything you can do to a record presupposes being able to see it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS RESOLVED HERE AND NOT LEFT TO THE ADMINISTRATOR
 * ---------------------------------------------------------------------------
 * `leave:approve:org` without `leave:view:org` is not a stricter role - it is a
 * broken one. The approver reaches the endpoint and then cannot load the list
 * of things to approve, so the screen is empty and the permission looks
 * unassigned. Nothing in the evaluator implies `view` from `approve` (each
 * triple is checked literally), so the implication has to be made somewhere,
 * and the builder is the only place that can do it without changing what a
 * grant MEANS at request time.
 *
 * The rule is per (module, scope): ticking `edit` at `team` adds `view` at
 * `team`, not at every scope. A wider `view` would already satisfy a narrower
 * check through scope precedence, but writing the narrow one is what the
 * administrator actually asked for.
 *
 * `view` itself depends on nothing, which is what makes a view-only role - the
 * common case - expressible with one tick.
 */
export const VIEW_ACTION = "view";

export const impliesView = (action) => action !== VIEW_ACTION;

/**
 * The keys that must also be SET when `keys` are set.
 *
 * Returns only the additions, so a caller can union them in without having to
 * know the rule.
 */
export function dependenciesFor(keys) {
  const out = new Set();
  for (const key of keys) {
    const { module, action, scope } = parsePermKey(key);
    if (impliesView(action)) out.add(permKey(module, VIEW_ACTION, scope));
  }
  return [...out];
}

/**
 * The keys that must also be CLEARED when `keys` are cleared.
 *
 * The mirror of `dependenciesFor`: dropping `view` at a scope drops everything
 * at that scope that would have depended on it, rather than leaving behind the
 * broken combination this whole mechanism exists to prevent.
 */
export function dependentsOf(keys, selected, actions) {
  const out = new Set();
  for (const key of keys) {
    const { module, action, scope } = parsePermKey(key);
    if (action !== VIEW_ACTION) continue;
    for (const other of actions) {
      if (!impliesView(other)) continue;
      const dependent = permKey(module, other, scope);
      if (selected.has(dependent)) out.add(dependent);
    }
  }
  return [...out];
}

/**
 * Apply a bulk toggle with dependencies resolved.
 *
 * One function for every path into the grid - a single checkbox, a row, a whole
 * module - so the rule cannot hold in one and not the others.
 */
export function applyToggle(selected, keys, checked, actions) {
  const next = new Set(selected);

  if (checked) {
    for (const key of keys) next.add(key);
    for (const key of dependenciesFor(keys)) next.add(key);
    return next;
  }

  for (const key of dependentsOf(keys, next, actions)) next.delete(key);
  for (const key of keys) next.delete(key);
  return next;
}
