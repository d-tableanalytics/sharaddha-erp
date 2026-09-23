import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TasksTable, isO2dMirror } from "./TasksTable";

/**
 * An O2D stage appearing on the Checklist.
 *
 * Assigning a stage to a person mirrors it here so they see everything they owe
 * in one place. The row is a VIEW of work that lives in the order, which sets
 * what this screen may offer:
 *
 *   it must SAY so, because a row that looks homegrown invites somebody to
 *     wonder why Order Tracker disagrees with it;
 *   it must not offer REASSIGN or MARK NON-FUNCTIONAL, because the server
 *     refuses both — the stage owns who it belongs to and whether it was
 *     needed — and a button whose only outcome is a refusal is worse than no
 *     button;
 *   it must still offer COMPLETE, because completing it here is the entire
 *     point of it being here.
 */

const mirroredTask = (extra = {}) => ({
  _id: "occ-1",
  taskName: "Send SOR + PI to Customer — PO-4471",
  taskCode: "O2D-PO-4471-S3",
  doerFirstName: "Priya",
  doerLastName: "Nair",
  department: "Billing",
  frequency: "once",
  plannedDate: "2026-09-20T10:00:00.000Z",
  status: "pending",
  sourceType: "o2d_stage",
  sourceOrderId: "order-1",
  sourceStageNumber: 3,
  sourcePoNumber: "PO-4471",
  ...extra,
});

const ownTask = (extra = {}) => ({
  _id: "occ-2",
  taskName: "Daily floor sweep",
  taskCode: "CHK-0002",
  doerFirstName: "Priya",
  doerLastName: "Nair",
  department: "Warehouse",
  frequency: "daily",
  plannedDate: "2026-09-20T10:00:00.000Z",
  status: "pending",
  ...extra,
});

const renderTable = (tasks, props = {}) =>
  render(
    <TasksTable
      tasks={tasks}
      loading={false}
      isAdmin
      selectedIds={[]}
      onToggleSelect={vi.fn()}
      onToggleSelectAll={vi.fn()}
      onComplete={vi.fn()}
      onRemark={vi.fn()}
      onReassign={vi.fn()}
      onNonFunctional={vi.fn()}
      hasFilters={false}
      onClearFilters={vi.fn()}
      onCreateNew={vi.fn()}
      {...props}
    />,
  );

describe("isO2dMirror", () => {
  test("recognises a mirrored row by its source, not its name or code", () => {
    expect(isO2dMirror(mirroredTask())).toBe(true);
    // A task somebody typed a similar name into is still their own task.
    expect(isO2dMirror(ownTask({ taskName: "O2D something", taskCode: "O2D-FAKE" }))).toBe(false);
    expect(isO2dMirror(undefined)).toBe(false);
  });
});

describe("a mirrored row on the Checklist", () => {
  test("says where it came from, naming the order", () => {
    renderTable([mirroredTask()]);
    expect(screen.getByText(/O2D · PO-4471/)).toBeTruthy();
  });

  test("an ordinary checklist task carries no such badge", () => {
    renderTable([ownTask()]);
    expect(screen.queryByText(/O2D ·/)).toBeNull();
  });

  test("offers Complete — the reason it is on this screen at all", () => {
    const onComplete = vi.fn();
    renderTable([mirroredTask()], { onComplete });

    const button = screen.getByRole("button", { name: /Complete/i });
    expect(button).toBeTruthy();
  });

  test("hides Reassign and Mark non-functional, and says where they live", async () => {
    const user = userEvent.setup();
    renderTable([mirroredTask()]);

    const row = screen.getByText(/O2D · PO-4471/).closest("tr");
    const menus = within(row).getAllByRole("button");
    await user.click(menus[menus.length - 1]);

    // Queried as BUTTONS, not as text: the explanatory line below them says
    // the word "Reassigning", and a text query would be satisfied by the very
    // sentence explaining that the action is gone.
    expect(screen.queryByRole("button", { name: /Reassign/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark non-functional/ })).toBeNull();
    expect(screen.getByText(/done from Order Tracker/i)).toBeTruthy();

    // Remarks stay: a note is additive and desyncs nothing.
    expect(screen.getByRole("button", { name: /Add remark/ })).toBeTruthy();
  });

  test("an ordinary task keeps both actions", async () => {
    const user = userEvent.setup();
    renderTable([ownTask()]);

    const row = screen.getByText("Daily floor sweep").closest("tr");
    const menus = within(row).getAllByRole("button");
    await user.click(menus[menus.length - 1]);

    expect(screen.getByRole("button", { name: /Reassign/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mark non-functional/ })).toBeTruthy();
  });
});
