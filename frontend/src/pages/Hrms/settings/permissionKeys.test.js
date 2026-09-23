import { describe, it, expect } from "vitest";

import {
  applyToggle,
  dependenciesFor,
  dependentsOf,
  groupModules,
  impliesView,
  parsePermKey,
  permKey,
} from "./permissionKeys";

describe("permKey / parsePermKey", () => {
  it("round-trips a triple through the flat key unchanged", () => {
    const key = permKey("leave", "approve", "team");
    expect(key).toBe("leave|approve|team");
    expect(parsePermKey(key)).toEqual({ module: "leave", action: "approve", scope: "team" });
  });
});

describe("groupModules", () => {
  it("groups a sub-module under its colon-prefixed parent", () => {
    const groups = groupModules(["employees", "employees:compensation", "settings"]);
    expect(groups).toEqual([
      ["employees", ["employees", "employees:compensation"]],
      ["settings", ["settings"]],
    ]);
  });

  it("a parent with no explicit row still groups its sub-modules", () => {
    // helpdesk:it can be granted without helpdesk ever appearing — the group
    // still has to exist for it to render under.
    const groups = groupModules(["helpdesk:it", "helpdesk:payroll"]);
    expect(groups).toEqual([["helpdesk", ["helpdesk:it", "helpdesk:payroll"]]]);
  });
});

describe("impliesView", () => {
  it("every action but view depends on view; view depends on nothing", () => {
    expect(impliesView("view")).toBe(false);
    for (const action of ["create", "edit", "delete", "approve", "run", "export"]) {
      expect(impliesView(action)).toBe(true);
    }
  });
});

describe("dependenciesFor", () => {
  it("edit at a scope requires view at the SAME scope, not every scope", () => {
    expect(dependenciesFor([permKey("leave", "edit", "team")])).toEqual([
      permKey("leave", "view", "team"),
    ]);
  });

  it("view requires nothing", () => {
    expect(dependenciesFor([permKey("leave", "view", "org")])).toEqual([]);
  });

  it("de-duplicates across several keys that imply the same view", () => {
    const deps = dependenciesFor([
      permKey("leave", "edit", "org"),
      permKey("leave", "approve", "org"),
    ]);
    expect(deps).toEqual([permKey("leave", "view", "org")]);
  });
});

describe("dependentsOf", () => {
  const actions = ["view", "edit", "approve"];

  it("clearing view drops every dependent action AT THAT SCOPE that is selected", () => {
    const selected = new Set([
      permKey("leave", "view", "org"),
      permKey("leave", "edit", "org"),
      permKey("leave", "approve", "org"),
      // A different scope's edit must survive — it depends on ITS OWN view.
      permKey("leave", "edit", "team"),
    ]);
    const dependents = dependentsOf([permKey("leave", "view", "org")], selected, actions);
    expect(new Set(dependents)).toEqual(
      new Set([permKey("leave", "edit", "org"), permKey("leave", "approve", "org")]),
    );
  });

  it("clearing a non-view action has no dependents", () => {
    const selected = new Set([permKey("leave", "edit", "org")]);
    expect(dependentsOf([permKey("leave", "edit", "org")], selected, actions)).toEqual([]);
  });

  it("only reports a dependent that is actually selected", () => {
    const selected = new Set([permKey("leave", "view", "org")]); // edit never ticked
    expect(dependentsOf([permKey("leave", "view", "org")], selected, actions)).toEqual([]);
  });
});

describe("applyToggle", () => {
  const actions = ["view", "edit", "delete"];

  it("checking edit adds view at the same scope", () => {
    const next = applyToggle(new Set(), [permKey("assets", "edit", "org")], true, actions);
    expect(next).toEqual(
      new Set([permKey("assets", "edit", "org"), permKey("assets", "view", "org")]),
    );
  });

  it("checking view alone adds nothing extra", () => {
    const next = applyToggle(new Set(), [permKey("assets", "view", "org")], true, actions);
    expect(next).toEqual(new Set([permKey("assets", "view", "org")]));
  });

  it("unchecking view cascades to clear edit and delete at that scope", () => {
    const start = new Set([
      permKey("assets", "view", "org"),
      permKey("assets", "edit", "org"),
      permKey("assets", "delete", "org"),
    ]);
    const next = applyToggle(start, [permKey("assets", "view", "org")], false, actions);
    expect(next).toEqual(new Set());
  });

  it("a bulk row toggle (all scopes for one action) resolves dependencies per key", () => {
    const keys = [
      permKey("assets", "edit", "self"),
      permKey("assets", "edit", "team"),
      permKey("assets", "edit", "org"),
    ];
    const next = applyToggle(new Set(), keys, true, actions);
    expect(next).toEqual(
      new Set([
        ...keys,
        permKey("assets", "view", "self"),
        permKey("assets", "view", "team"),
        permKey("assets", "view", "org"),
      ]),
    );
  });

  it("unchecking a module's whole block leaves nothing dangling", () => {
    const all = new Set([
      permKey("assets", "view", "org"),
      permKey("assets", "edit", "org"),
      permKey("assets", "delete", "org"),
      // Another module untouched by the bulk clear.
      permKey("leave", "view", "org"),
    ]);
    const cleared = applyToggle(
      all,
      [permKey("assets", "view", "org"), permKey("assets", "edit", "org"), permKey("assets", "delete", "org")],
      false,
      actions,
    );
    expect(cleared).toEqual(new Set([permKey("leave", "view", "org")]));
  });

  it("checking an already-checked key is a no-op", () => {
    const start = new Set([permKey("assets", "view", "org")]);
    expect(applyToggle(start, [permKey("assets", "view", "org")], true, actions)).toEqual(start);
  });
});
