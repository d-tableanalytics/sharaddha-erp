import { describe, test, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { BuddyChainEditor, buddyChainError } from "./BuddyChainField";
import { BuddyAssignmentPanel, BuddyBadge } from "./BuddyAssignmentPanel";

/**
 * Buddy System UI.
 *
 * The editor is an ordered list where position 1 is the primary; reordering
 * changes who that is, and nobody may appear twice. The panel says who holds
 * the task today and why, and keeps the history one click away.
 */

const users = [
  { _id: "u1", user: "Rahul Sharma", role: "Billing" },
  { _id: "u2", user: "Priya Singh", role: "Billing" },
  { _id: "u3", user: "Amit Verma", role: "Billing" },
];

function Harness({ initial, onChangeSpy }) {
  const [chain, setChain] = useState(initial);
  return (
    <BuddyChainEditor
      users={users}
      chain={chain}
      onChange={(next) => { onChangeSpy?.(next); setChain(next); }}
    />
  );
}

describe("BuddyChainEditor", () => {
  test("labels the first position primary and the rest backups", () => {
    render(<Harness initial={["u1", "u2"]} />);
    expect(screen.getByLabelText("Primary assignee").value).toBe("u1");
    expect(screen.getByLabelText("Backup 1").value).toBe("u2");
  });

  test("does not offer someone already in the chain", () => {
    render(<Harness initial={["u1", ""]} />);
    const backup = screen.getByLabelText("Backup 1");
    expect(within(backup).queryByText(/Rahul Sharma/)).toBeNull();
    expect(within(backup).getByText(/Priya Singh/)).toBeTruthy();
  });

  test("reorders, adds and removes", () => {
    const spy = vi.fn();
    render(<Harness initial={["u1", "u2"]} onChangeSpy={spy} />);

    fireEvent.click(screen.getAllByLabelText("Move down")[0]);
    expect(spy).toHaveBeenLastCalledWith(["u2", "u1"]);
    expect(screen.getByLabelText("Primary assignee").value).toBe("u2");

    fireEvent.click(screen.getByText(/Add another buddy/));
    expect(spy).toHaveBeenLastCalledWith(["u2", "u1", ""]);

    fireEvent.click(screen.getAllByLabelText("Remove")[2]);
    expect(spy).toHaveBeenLastCalledWith(["u2", "u1"]);
  });

  test("a two-person chain cannot shrink below a primary and one backup", () => {
    render(<Harness initial={["u1", "u2"]} />);
    screen.getAllByLabelText("Remove").forEach((b) => expect(b.disabled).toBe(true));
  });

  test("validation mirrors the server's first checks", () => {
    expect(buddyChainError(["u1"])).toMatch(/at least one backup/);
    expect(buddyChainError(["u1", ""])).toMatch(/every position/);
    expect(buddyChainError(["u1", "u1"])).toMatch(/cannot appear twice/);
    expect(buddyChainError(["u1", "u2"])).toBeNull();
  });
});

const buddyTask = (extra = {}) => ({
  _id: "t1",
  assignmentType: "buddy",
  buddyChain: [
    { userId: "u1", name: "Rahul Sharma" },
    { userId: "u2", name: "Priya Singh" },
    { userId: "u3", name: "Amit Verma" },
  ],
  assignmentSource: "automatic",
  assignmentReason: "Primary assignee Rahul Sharma is on approved leave today",
  assignmentHistory: [
    {
      _id: "h1", day: "2026-10-06", at: "2026-10-06T04:30:00.000Z", event: "buddy_activated", source: "automatic",
      fromName: "Rahul Sharma", toName: "Priya Singh", reason: "Primary assignee Rahul Sharma is on approved leave today",
    },
  ],
  ...extra,
});

describe("BuddyAssignmentPanel", () => {
  test("shows the active backup, why, and the backup order", () => {
    render(<BuddyAssignmentPanel task={buddyTask()} doerId="u2" doerName="Priya Singh" />);
    expect(screen.getByText("✓ Enabled")).toBeTruthy();
    expect(screen.getByText("Automatically activated")).toBeTruthy();
    expect(screen.getByText(/Primary assignee Rahul Sharma is on approved leave today/)).toBeTruthy();
    expect(screen.getByText(/2\. Priya Singh/).textContent).toMatch(/active/);
  });

  test("history is one click away", () => {
    render(<BuddyAssignmentPanel task={buddyTask()} doerId="u2" doerName="Priya Singh" />);
    fireEvent.click(screen.getByText(/Assignment history \(1\)/));
    expect(screen.getByText("Automatic buddy assignment")).toBeTruthy();
    expect(screen.getByText("Rahul Sharma → Priya Singh")).toBeTruthy();
  });

  test("renders nothing for a single-assignee task", () => {
    const { container } = render(<BuddyAssignmentPanel task={{ assignmentType: "single" }} doerId="u1" doerName="Rahul" />);
    expect(container.innerHTML).toBe("");
  });

  test("a manual pin can be resumed by whoever may override", async () => {
    const onOverride = vi.fn().mockResolvedValue();
    render(
      <BuddyAssignmentPanel
        task={buddyTask({ assignmentSource: "manual", assignmentReason: "Assigned manually by Meera" })}
        doerId="u3"
        doerName="Amit Verma"
        onOverride={onOverride}
      />,
    );
    expect(screen.getByText("Assigned manually")).toBeTruthy();
    fireEvent.click(screen.getByText(/Resume automatic buddy rotation/));
    expect(onOverride).toHaveBeenCalledWith({ resume: true });
  });

  test("no override controls without the handler", () => {
    render(<BuddyAssignmentPanel task={buddyTask()} doerId="u2" doerName="Priya Singh" />);
    expect(screen.queryByText("Assign manually")).toBeNull();
  });
});

describe("BuddyBadge", () => {
  test("says a backup is holding it, with the reason as its tooltip", () => {
    render(<BuddyBadge task={buddyTask()} />);
    const badge = screen.getByText(/Buddy active/);
    expect(badge.closest("[title]").getAttribute("title")).toMatch(/approved leave/);
  });

  test("nothing for a single-assignee task", () => {
    const { container } = render(<BuddyBadge task={{ assignmentType: "single" }} />);
    expect(container.innerHTML).toBe("");
  });
});
