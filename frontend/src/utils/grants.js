/**
 * Turning grant lists into something a checkbox grid can read, and back.
 *
 * Two screens draw a permission matrix - a ROLE's, and one ACCOUNT's extra
 * access on top of its role - and they are the same grid over the same
 * registry. These helpers live here rather than in either screen so the two
 * cannot drift into disagreeing about what a tick means.
 *
 * The wire format is a LIST of `{ module, submodule, actions[] }`, which is
 * what the API stores and what reads well in a database row. A grid wants a
 * lookup instead, so it is converted on the way in and back on the way out.
 */

export const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
};

/** Grants are a list; the matrix wants a lookup. 'module.submodule' -> Set. */
export const grantsToMap = (grants = []) => {
  const map = new Map();
  for (const g of grants) {
    map.set(`${g.module}.${g.submodule}`, new Set(g.actions || []));
  }
  return map;
};

/** Back to the wire format. Sub-modules with nothing ticked are dropped. */
export const mapToGrants = (map) =>
  [...map.entries()]
    .filter(([, actions]) => actions.size > 0)
    .map(([id, actions]) => {
      const [module, submodule] = id.split('.');
      return { module, submodule, actions: [...actions] };
    });

/**
 * Do two grant lists mean the same thing?
 *
 * Order-insensitive on both axes, because it decides whether the Save button is
 * enabled: comparing raw JSON would light it up after a tick and an untick that
 * cancelled out, and an admin who is told they have unsaved changes when they
 * do not soon stops believing the button.
 */
export const sameGrants = (a = [], b = []) => {
  const norm = (g) =>
    JSON.stringify(
      [...g]
        .map((x) => ({ ...x, actions: [...(x.actions || [])].sort() }))
        .sort((p, q) => `${p.module}.${p.submodule}`.localeCompare(`${q.module}.${q.submodule}`)),
    );
  return norm(a) === norm(b);
};

/** Is this action ticked for this sub-module in the given map? */
export const mapHas = (map, moduleKey, subKey, action) =>
  map.get(`${moduleKey}.${subKey}`)?.has(action) || false;

/** Toggle one cell, returning a NEW map (the grids hold these in state). */
export const toggleCell = (map, moduleKey, subKey, action) => {
  const next = new Map(map);
  const id = `${moduleKey}.${subKey}`;
  const actions = new Set(next.get(id) || []);
  if (actions.has(action)) actions.delete(action);
  else actions.add(action);
  next.set(id, actions);
  return next;
};

/**
 * Union two grant lists into one lookup, actions merged per cell.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH SCREENS NEED THIS, AND WHY IT LIVES HERE ONCE
 * ---------------------------------------------------------------------------
 * Neither screen's checkboxes are locked. A role's matrix shows a cell ticked
 * because the role's compiled-in BASELINE grants it, or because its own stored
 * grants do, or both - and every one of those cells is an ordinary checkbox a
 * Super Admin can freely uncheck and recheck. A single account's Extra Access
 * modal shows a cell ticked because the account's ROLE already grants it, or
 * because the account has its own extra grant, or both - same shape, same
 * freedom to toggle.
 *
 * Both screens seed their draft with this union, so a checkbox always opens by
 * telling the truth about what is granted TODAY rather than only the part a
 * previous screen happened to store explicitly. What each screen does with the
 * result on SAVE differs - see `grantsBeyond` for the account modal's half -
 * but the union itself is one calculation, used identically by both, so they
 * cannot drift into two different ideas of what "currently granted" means.
 */
export const mergeGrantLists = (a = [], b = []) => {
  const map = grantsToMap(a);
  for (const [id, actions] of grantsToMap(b)) {
    const merged = new Set(map.get(id) || []);
    for (const action of actions) merged.add(action);
    map.set(id, merged);
  }
  return map;
};

/**
 * What `draftMap` adds ON TOP of `baseMap` - the grants left after removing
 * everything `baseMap` already covers.
 *
 * ---------------------------------------------------------------------------
 * WHY A DRAFT MUST BE FILTERED BEFORE IT IS SAVED AS ONE ACCOUNT'S EXTRA GRANTS
 * ---------------------------------------------------------------------------
 * The Extra Access modal seeds its draft with `mergeGrantLists(role's grants,
 * the account's own extra grants)`, so a cell the role already grants shows
 * ticked and can be freely toggled like any other - no locked checkbox. But
 * "extra access" is stored as a pure ADDITION on top of whatever the account's
 * role happens to be, and if a tick that came from the role were saved back
 * into that list verbatim, the account would carry a permanent, invisible copy
 * of its OLD role's access - one that survives the account being reassigned to
 * a different role entirely, which defeats the point of the role existing.
 *
 * So every save passes the draft through this first. Unchecking a cell that
 * came from the role has no effect either way - it was never going to be
 * counted as "extra" - which is the same honest shape the role matrix uses for
 * its own baseline: the box reflects what is true, the floor beneath it moves
 * only where the floor itself is edited.
 */
export const grantsBeyond = (draftMap, baseMap) => {
  const out = new Map();
  for (const [id, actions] of draftMap) {
    const baseActions = baseMap.get(id) || new Set();
    const extra = new Set([...actions].filter((action) => !baseActions.has(action)));
    if (extra.size > 0) out.set(id, extra);
  }
  return out;
};

export default {
  ACTION_LABELS,
  grantsToMap,
  mapToGrants,
  sameGrants,
  mapHas,
  toggleCell,
  mergeGrantLists,
  grantsBeyond,
};
