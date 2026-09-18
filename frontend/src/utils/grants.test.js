/**
 * The grant-list helpers both permission screens share.
 *
 * `mergeGrantLists` and `grantsBeyond` are the mechanism that lets a role's
 * baseline cells and an account's role-inherited cells be ORDINARY,
 * freely-toggleable checkboxes — no locked boxes — without either screen
 * accidentally writing somebody else's access onto the wrong record. These are
 * pure functions, so the whole safety argument is testable without rendering
 * anything.
 */

import { describe, it, expect } from "vitest";
import {
  grantsToMap,
  mapToGrants,
  sameGrants,
  mapHas,
  toggleCell,
  mergeGrantLists,
  grantsBeyond,
} from "./grants";

describe("grantsToMap / mapToGrants", () => {
  it("round-trips a grant list through the lookup form", () => {
    const grants = [
      { module: "fms", submodule: "my_tasks", actions: ["view", "edit"] },
      { module: "expenses", submodule: "claims", actions: ["view"] },
    ];
    const map = grantsToMap(grants);
    expect(mapHas(map, "fms", "my_tasks", "view")).toBe(true);
    expect(mapHas(map, "fms", "my_tasks", "delete")).toBe(false);
    expect(mapHas(map, "expenses", "claims", "view")).toBe(true);

    const back = mapToGrants(map);
    expect(back).toHaveLength(2);
  });

  it("drops a sub-module with nothing ticked", () => {
    const map = grantsToMap([{ module: "fms", submodule: "my_tasks", actions: ["view"] }]);
    map.set("fms.my_tasks", new Set()); // emptied by unticking the one action
    expect(mapToGrants(map)).toEqual([]);
  });
});

describe("sameGrants", () => {
  it("is insensitive to the order of grants and of actions within them", () => {
    const a = [
      { module: "fms", submodule: "my_tasks", actions: ["view", "edit"] },
      { module: "expenses", submodule: "claims", actions: ["view"] },
    ];
    const b = [
      { module: "expenses", submodule: "claims", actions: ["view"] },
      { module: "fms", submodule: "my_tasks", actions: ["edit", "view"] },
    ];
    expect(sameGrants(a, b)).toBe(true);
  });

  it("is not fooled by a tick and an untick that cancel out", () => {
    const before = [{ module: "fms", submodule: "my_tasks", actions: ["view"] }];
    const map = toggleCell(toggleCell(grantsToMap(before), "fms", "my_tasks", "edit"), "fms", "my_tasks", "edit");
    expect(sameGrants(mapToGrants(map), before)).toBe(true);
  });
});

describe("mergeGrantLists", () => {
  it("unions two lists, merging actions per cell", () => {
    const merged = mergeGrantLists(
      [{ module: "fms", submodule: "order_tracker", actions: ["view"] }],
      [{ module: "fms", submodule: "order_tracker", actions: ["edit"] }, { module: "fms", submodule: "my_tasks", actions: ["view"] }],
    );
    expect(mapHas(merged, "fms", "order_tracker", "view")).toBe(true);
    expect(mapHas(merged, "fms", "order_tracker", "edit")).toBe(true);
    expect(mapHas(merged, "fms", "my_tasks", "view")).toBe(true);
  });

  it("tolerates undefined and empty inputs", () => {
    expect(mapToGrants(mergeGrantLists(undefined, undefined))).toEqual([]);
    expect(mapToGrants(mergeGrantLists([], []))).toEqual([]);
    const a = [{ module: "fms", submodule: "my_tasks", actions: ["view"] }];
    expect(sameGrants(mapToGrants(mergeGrantLists(a, undefined)), a)).toBe(true);
  });

  /**
   * The wildcard case: a super-admin role's baseline, once expanded by the
   * backend's own `grantsFromPermissions(['*'])`, is already a full grid — the
   * merge just needs to carry it through unchanged.
   */
  it("carries a fully-expanded wildcard grant list straight through", () => {
    const wildcard = [
      { module: "fms", submodule: "my_tasks", actions: ["view", "edit"] },
      { module: "fms", submodule: "order_tracker", actions: ["view", "create", "edit", "delete", "approve"] },
    ];
    const merged = mergeGrantLists(wildcard, []);
    expect(sameGrants(mapToGrants(merged), wildcard)).toBe(true);
  });
});

describe("grantsBeyond", () => {
  /**
   * 🔴 THE CENTRAL SAFETY GUARANTEE.
   *
   * `UserAccessModal` seeds its draft with the role's grants merged in so
   * every cell can be freely ticked and unticked. If a role-derived tick were
   * saved back onto the account verbatim, the account would carry a permanent
   * copy of that role's access — one that survives the account being moved to
   * a completely different role later. `grantsBeyond` is what stops that: it
   * is the function actually called before every save.
   */
  it("excludes everything already covered by the base, however the draft holds it", () => {
    const inherited = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view"] },
    ]);
    // The draft still contains the inherited cell — the checkbox for it is
    // ordinary and was left ticked, exactly as it started.
    const draft = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view"] },
      { module: "fms", submodule: "my_tasks", actions: ["edit"] },
    ]);

    const extra = mapToGrants(grantsBeyond(draft, inherited));
    expect(extra).toEqual([{ module: "fms", submodule: "my_tasks", actions: ["edit"] }]);
  });

  it("keeps a partial action set: only the actions NOT in the base are extra", () => {
    const inherited = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view"] },
    ]);
    const draft = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view", "edit"] },
    ]);

    const extra = mapToGrants(grantsBeyond(draft, inherited));
    expect(extra).toEqual([{ module: "fms", submodule: "order_tracker", actions: ["edit"] }]);
  });

  it("unticking an inherited cell changes nothing about what is saveable", () => {
    const inherited = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view"] },
    ]);
    // The admin unticked it — the draft no longer carries it at all.
    const draftAfterUntick = grantsToMap([]);

    expect(mapToGrants(grantsBeyond(draftAfterUntick, inherited))).toEqual([]);
    // Identical to the result while it was still ticked.
    const draftWhileTicked = grantsToMap([
      { module: "fms", submodule: "order_tracker", actions: ["view"] },
    ]);
    expect(mapToGrants(grantsBeyond(draftWhileTicked, inherited))).toEqual([]);
  });

  it("a super-admin's fully-expanded baseline swallows the whole draft, leaving nothing extra", () => {
    const inherited = grantsToMap([
      { module: "fms", submodule: "my_tasks", actions: ["view", "edit"] },
      { module: "fms", submodule: "order_tracker", actions: ["view", "create", "edit", "delete", "approve"] },
      { module: "expenses", submodule: "claims", actions: ["view", "create"] },
    ]);
    // Even if every box on screen is ticked (because the role already grants
    // literally everything), none of it is this account's OWN extra access.
    const draft = mergeGrantLists(mapToGrants(inherited), []);

    expect(mapToGrants(grantsBeyond(draft, inherited))).toEqual([]);
  });

  it("returns nothing extra when the draft is empty", () => {
    const inherited = grantsToMap([{ module: "fms", submodule: "my_tasks", actions: ["view"] }]);
    expect(mapToGrants(grantsBeyond(grantsToMap([]), inherited))).toEqual([]);
  });
});
