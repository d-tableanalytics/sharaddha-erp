import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TaskListView, isO2dMirror } from "./TaskListView";

/**
 * An O2D stage appearing in the Delegation list.
 *
 * The mirror is there so the assignee sees everything they owe in one place.
 * The row is a VIEW of work that lives in the order, which sets what this
 * screen may offer:
 *
 *   it must SAY so, naming the order, because a row that looks homegrown
 *     invites somebody to wonder why Order Tracker disagrees with it;
 *   it must not offer DELETE, because deleting the mirror leaves the real
 *     stage open, still assigned and still counting against its SLA, with
 *     nobody looking at it — which is why the server refuses;
 *   it must still be COMPLETABLE, because that is the point of it being here.
 *
 * The predicate is keyed on `sourceType` and exported from one place, so the
 * list, the drawer and the bulk handlers cannot drift into three opinions
 * about what counts as a mirror.
 */

const mirrored = (extra = {}) => ({
  _id: "del-1",
  taskTitle: "Advance Order Decision — PO-4471",
  doerFirstName: "Priya",
  doerLastName: "Nair",
  status: "Pending",
  priority: "High",
  dueDate: "2026-09-20T10:00:00.000Z",
  createdAt: "2026-09-18T10:00:00.000Z",
  sourceType: "o2d_stage",
  sourceOrderId: "order-1",
  sourceStageNumber: 4,
  sourcePoNumber: "PO-4471",
  ...extra,
});

const ownTask = (extra = {}) => ({
  _id: "del-2",
  taskTitle: "Draft the quarterly report",
  doerFirstName: "Priya",
  doerLastName: "Nair",
  status: "Pending",
  priority: "Medium",
  dueDate: "2026-09-20T10:00:00.000Z",
  createdAt: "2026-09-18T10:00:00.000Z",
  ...extra,
});

const renderList = (tasks) =>
  render(
    <TaskListView
      tasks={tasks}
      loading={false}
      selectedIds={[]}
      onToggleSelect={vi.fn()}
      onSelectAll={vi.fn()}
      onOpenDetails={vi.fn()}
      onQuickVerify={vi.fn()}
      onClearFilters={vi.fn()}
    />,
  );

describe("isO2dMirror", () => {
  test("recognises a mirrored row by its source, not its title", () => {
    expect(isO2dMirror(mirrored())).toBe(true);
    // Somebody's own task that happens to mention O2D is still their own task.
    expect(isO2dMirror(ownTask({ taskTitle: "Chase the O2D backlog" }))).toBe(false);
    expect(isO2dMirror(undefined)).toBe(false);
  });
});

describe("a mirrored row in the Delegation list", () => {
  test("says where it came from, naming the order", () => {
    renderList([mirrored()]);
    expect(screen.getByText(/O2D · PO-4471/)).toBeTruthy();
  });

  test("names the stage and order in its tooltip, matching Order Tracker", () => {
    renderList([mirrored()]);
    const badge = screen.getByText(/O2D · PO-4471/);
    expect(badge.getAttribute("title")).toMatch(/Stage 4 of order PO-4471/);
  });

  test("an ordinary delegated task carries no such badge", () => {
    renderList([ownTask()]);
    expect(screen.queryByText(/O2D ·/)).toBeNull();
  });

  test("the task itself still renders normally — the badge adds, it does not replace", () => {
    renderList([mirrored()]);
    expect(screen.getByText("Advance Order Decision — PO-4471")).toBeTruthy();
    expect(screen.getAllByText(/Priya/).length > 0).toBe(true);
  });
});
