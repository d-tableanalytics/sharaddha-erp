import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../services/delegation", () => {
  const api = {
    getDelegations: vi.fn().mockResolvedValue([]),
    updateDelegation: vi.fn().mockResolvedValue({}),
  };
  return { default: api, delegationService: api };
});
vi.mock("../../services/checklist", () => ({
  checklistApi: { getTasks: vi.fn(), completeTask: vi.fn() },
}));
vi.mock("../../services/o2d/orders", async (importOriginal) => ({
  ...(await importOriginal()),
  o2dApi: { get: vi.fn(), documents: vi.fn(), completeStage: vi.fn() },
}));
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { useUserStore } from "../../store/userStore";
import { checklistApi } from "../../services/checklist";
import { o2dApi } from "../../services/o2d/orders";
import { MyDay } from "./MyDay";

/**
 * My Work's Done on an O2D task.
 *
 * A one-tap "done" cannot satisfy a stage that needs a PI number, so Done on an
 * O2D row opens the stage's own form and completes through the O2D API — the
 * same completion as Order Tracker — instead of ticking the checklist row.
 */
const today = new Date();
today.setHours(18, 0, 0, 0);

const o2dRow = (over = {}) => ({
  _id: "occ-3",
  taskName: "Send SOR + PI to Customer — TESTPO1",
  taskCode: "O2D-TESTPO1-S3",
  doer: null,
  doerFirstName: "Billing team",
  department: "Billing",
  frequency: "once",
  plannedDate: today.toISOString(),
  status: "pending",
  sourceType: "o2d_stage",
  sourceOrderId: "o1",
  sourceStageNumber: 3,
  sourcePoNumber: "TESTPO1",
  canComplete: true,
  ...over,
});

const renderMyWork = () =>
  render(
    <MemoryRouter>
      <MyDay />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    user: { _id: "u1", user: "Prajana Suvarna", role: "Billing", permissions: ["*"], status: "Active" },
    loading: false,
  });
  o2dApi.get.mockResolvedValue({
    order: { _id: "o1", poNumber: "TESTPO1" },
    stages: [{ stageNumber: 3, stageName: "Send SOR + PI to Customer", ownerRole: "Billing", status: "PENDING" }],
  });
  o2dApi.documents.mockResolvedValue([]);
  o2dApi.completeStage.mockResolvedValue({});
});

const openChecklistTab = async () => {
  const tab = await screen.findByRole("tab", { name: /Checklist/i });
  fireEvent.click(tab);
};

describe("My Work — O2D tasks", () => {
  test("asks for this person's own queue, including the O2D tasks they can act on", async () => {
    checklistApi.getTasks.mockResolvedValue({ tasks: [] });
    renderMyWork();
    await waitFor(() => expect(checklistApi.getTasks).toHaveBeenCalledWith({ limit: 100, mine: "true" }));
  });

  test("Done opens the stage's form and completes through the O2D API, not the checklist tick", async () => {
    checklistApi.getTasks.mockResolvedValue({ tasks: [o2dRow()] });
    renderMyWork();
    await openChecklistTab();

    const card = (await screen.findByText(/Send SOR \+ PI to Customer — TESTPO1/)).closest("div.rounded-xl");
    fireEvent.click(within(card).getByRole("button", { name: /Done/ }));

    fireEvent.change(await screen.findByLabelText(/PI Number/i), { target: { value: "PI-9" } });
    fireEvent.change(screen.getByLabelText(/SOR Reference/i), { target: { value: "SOR-9" } });
    fireEvent.click(screen.getByRole("button", { name: /complete stage/i }));

    await waitFor(() => expect(o2dApi.completeStage).toHaveBeenCalledWith("o1", 3, {
      evidence: { piNumber: "PI-9", sorReference: "SOR-9" },
      remarks: null,
    }));
    expect(checklistApi.completeTask).not.toHaveBeenCalled();
  });

  test("a new task is tagged, and the Checklist tab says how many are new", async () => {
    checklistApi.getTasks.mockResolvedValue({ tasks: [o2dRow({ isNew: true })] });
    renderMyWork();

    const tab = await screen.findByRole("tab", { name: /Checklist/i });
    await waitFor(() => expect(within(tab).getByText("1 new")).toBeTruthy());
    fireEvent.click(tab);

    const card = (await screen.findByText(/Send SOR \+ PI to Customer — TESTPO1/)).closest("div.rounded-xl");
    expect(within(card).getByText("New")).toBeTruthy();
  });

  test("an O2D task this person cannot complete is view-only", async () => {
    checklistApi.getTasks.mockResolvedValue({ tasks: [o2dRow({ canComplete: false })] });
    renderMyWork();
    await openChecklistTab();

    const card = (await screen.findByText(/Send SOR \+ PI to Customer — TESTPO1/)).closest("div.rounded-xl");
    expect(within(card).queryByRole("button", { name: /Done/ })).toBeNull();
    expect(within(card).getByText(/View only/)).toBeTruthy();
  });
});
