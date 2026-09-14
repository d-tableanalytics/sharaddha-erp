import { describe, test, expect } from "vitest";

import {
  SYSTEM_ROLE_NAMES,
  assignableRolesFor,
  PERMISSIONS,
} from "./permissions";

/**
 * The role list behind every user-management dropdown.
 *
 * These exist because of a real, shipped bug: `assignableRolesFor` held its own
 * hand-typed list of eight role names while the system defined twelve, so HR,
 * Billing, Accounts and Billing Head could not be assigned to anybody through
 * the UI. The server accepted all four; only the dropdown did not offer them.
 *
 * The test that matters is therefore not "is Billing in the list" — that would
 * pass forever after one edit, and the NEXT role added would go missing exactly
 * the same way. It is "does the offer cover everything the system defines",
 * which fails the moment the two fall out of step again.
 */

const superAdmin = { role: "Super Admin", permissions: ["*"] };
const salesDesk = { role: "Sales", permissions: [PERMISSIONS.MANAGE_CUSTOMER_USERS] };

describe("assignable roles", () => {
  test("offers every role the system defines", () => {
    const offered = assignableRolesFor(superAdmin);
    const missing = SYSTEM_ROLE_NAMES.filter((r) => !offered.includes(r));

    expect(missing).toEqual([]);
  });

  test("names the four that were missing, so the regression is legible", () => {
    const offered = assignableRolesFor(superAdmin);

    // Redundant with the test above by construction — kept because a failure
    // here says WHICH roles vanished, where the general test only says that
    // something did.
    for (const role of ["HR", "Billing", "Accounts", "Billing Head"]) {
      expect(offered).toContain(role);
    }
  });

  test("offers nothing the system does not define", () => {
    const offered = assignableRolesFor(superAdmin);
    const invented = offered.filter((r) => !SYSTEM_ROLE_NAMES.includes(r));

    // A role in the dropdown that the server does not accept is the same bug
    // pointing the other way: the option saves, and 400s.
    expect(invented).toEqual([]);
  });

  test("lists Customer last, so staff roles lead", () => {
    const offered = assignableRolesFor(superAdmin);
    expect(offered[offered.length - 1]).toBe("Customer");
  });

  test("appends custom roles without duplicating built-in ones", () => {
    const offered = assignableRolesFor(superAdmin, ["Auditor", "Admin"]);

    expect(offered).toContain("Auditor");
    // "Admin" is already a system role; passing it again must not list it twice.
    expect(offered.filter((r) => r === "Admin")).toHaveLength(1);
  });

  test("an actor who manages only customers is still limited to Customer", () => {
    // The narrowing is the part most easily lost when the list is refactored:
    // widening it would let the sales desk create an Admin.
    expect(assignableRolesFor(salesDesk)).toEqual(["Customer"]);
  });

  test("an actor with no user-management permission gets no staff roles", () => {
    expect(assignableRolesFor({ role: "Customer", permissions: [] })).toEqual(["Customer"]);
  });
});
