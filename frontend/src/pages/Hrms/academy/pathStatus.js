/**
 * How a learning path's status reads on screen.
 *
 * ---------------------------------------------------------------------------
 * ONE TABLE, BECAUSE THREE SCREENS SAY THE SAME THING
 * ---------------------------------------------------------------------------
 * The catalogue tiles, the badge on each card and the drawer header all render
 * this status. Three copies of the mapping is how a path comes to be an amber
 * "Draft" on a card and a grey "Inactive" in the panel that opens from it.
 *
 * The status itself is computed SERVER-SIDE (`derivePathStatus` in
 * catalogue.service.js) and arrives on the DTO. Nothing here re-derives it from
 * `active` and `courseCount` — that would be a fourth copy of the rule, and the
 * one the filter does not use.
 */
export const PATH_STATUS_META = Object.freeze({
  active: {
    key: "active",
    label: "Active",
    tone: "success",
    tile: "success",
    hint: "Published and available to assign.",
  },
  draft: {
    key: "draft",
    label: "Draft",
    tone: "warning",
    tile: "warning",
    hint: "Has no courses yet, so it cannot usefully be assigned.",
  },
  archived: {
    key: "archived",
    label: "Archived",
    tone: "danger",
    tile: "danger",
    hint: "Withdrawn. Existing assignments are unaffected.",
  },
});

export const PATH_STATUS_ORDER = Object.freeze(["active", "draft", "archived"]);

export default PATH_STATUS_META;
