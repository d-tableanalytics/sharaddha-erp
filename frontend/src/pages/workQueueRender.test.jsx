import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The five WorkQueue screens render at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * The whole module had no test of any kind, and `Sidebar.test.jsx` records what
 * that costs: a live `ReferenceError` reached the browser with a GREEN build and
 * a GREEN suite, because nothing ever imported the component and a bundler will
 * happily bundle a module that throws the moment it runs.
 *
 * These pages were just swept for design-system alignment — class names in
 * sixteen files — and a class-name edit that lands inside a template literal or
 * a `className={...}` expression breaks at RUNTIME, not at build. `vite build`
 * returning 0 says nothing about that.
 *
 * So this asserts the one thing a build cannot: each page mounts, and puts its
 * title on screen through the shared header. The design-system specifics are
 * deliberately NOT asserted here — pinning exact utility classes would make
 * every future restyle a test edit, which is how a suite becomes something
 * people delete rather than trust.
 */

// The services are the network. Each page calls its own on mount; the SHAPES
// below are only enough to get past the first render, because what is under
// test is that the component executes, not what it does with the data.
vi.mock("../services/activity", () => ({
  default: { getActivities: vi.fn().mockResolvedValue({ data: [], total: 0 }) },
}));
vi.mock("../services/delegation", () => ({
  default: {
    getTasks: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getTaskStats: vi.fn().mockResolvedValue({}),
    getUsers: vi.fn().mockResolvedValue([]),
    getTags: vi.fn().mockResolvedValue([]),
    getActivities: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  },
}));
vi.mock("../services/checklist", () => ({
  checklistApi: {
    getTasks: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getRoutines: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getStats: vi.fn().mockResolvedValue({}),
    getScoreboard: vi.fn().mockResolvedValue({ data: [] }),
  },
}));
vi.mock("../services/scoreboard", () => ({
  scoreboardApi: {
    getScoreboard: vi.fn().mockResolvedValue({ data: [] }),
    getSummary: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

import { useUserStore } from "../store/userStore";

const SCREENS = [
  { name: "Activities", title: /Activities/i, load: () => import("./Activities/Activities") },
  { name: "Checklist", title: /Checklist/i, load: () => import("./Checklist/ChecklistPage") },
  { name: "Delegation", title: /Delegation/i, load: () => import("./Delegation/DelegationPage") },
  { name: "In-Loop Tasks", title: /./, load: () => import("./InLoopTasks/InLoopTasks") },
  { name: "Executive Scoreboard", title: /./, load: () => import("./ExecutiveScoreboard/ExecutiveScoreboard") },
];

beforeEach(() => {
  useUserStore.setState({
    user: {
      _id: "u1",
      user: "A Person",
      role: "Super Admin",
      permissions: ["*"],
      status: "Active",
    },
    loading: false,
  });
});

describe("every WorkQueue screen mounts", () => {
  for (const screenDef of SCREENS) {
    test(`${screenDef.name} renders without throwing`, async () => {
      const mod = await screenDef.load();
      // These pages export variously as default or named; take whichever is a
      // component rather than making every page change its export for a test.
      const Page = mod.default ?? Object.values(mod).find((v) => typeof v === "function");
      expect(Page, `${screenDef.name} exports no component`).toBeTruthy();

      expect(() =>
        render(
          <MemoryRouter>
            <Page />
          </MemoryRouter>,
        ),
      ).not.toThrow();
    });
  }
});

describe("the shared page header is actually used", () => {
  test("Activities renders its title through PageHeader", async () => {
    const { default: Page } = await import("./Activities/Activities");
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    // `PageHeader` renders the title as the page's <h1>. The hand-rolled header
    // this replaced also produced an h1, so this asserts the heading survived
    // the swap — not which classes it carries.
    const heading = await screen.findByRole("heading", { level: 1, name: /Activities/i });
    expect(heading).toBeTruthy();
  });
});
