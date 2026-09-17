/**
 * SI Academy — the screens.
 *
 * Only the axios instance is mocked. The HRMS client, the shared Zod schemas
 * and the shared permission matrix are all real, so these also cover the
 * request URLs and the `{ success, data }` unwrapping.
 *
 * What the UI offers is asserted here; what it is ALLOWED to do is asserted in
 * backend/tests/academy-api.test.js. Both halves read the same matrix.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../../services/api", () => ({ api: { request: vi.fn() } }));

import { api } from "../../../services/api";
import { AcademyPage } from "./AcademyPage";
import { LessonPlayerPage } from "./LessonPlayerPage";
import { LearningPathPage } from "./LearningPathPage";
import { useHrmsStore } from "../../../store/hrmsStore";
import { buildHrmsActor } from "@shared/permissions/has-permission.js";
import { HRMS_ROLES as R, HRMS_MODULES as M } from "@shared/permissions/constants.js";

const ME = "652f0000000000000000b001";
const A1 = "652f0000000000000000a001";
const A2 = "652f0000000000000000a002";
const A3 = "652f0000000000000000a003";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const assignment = (over = {}) => ({
  id: A1,
  employeeId: ME,
  employeeName: "Sam Person",
  pathId: "652f0000000000000000p001",
  pathName: "New Employee Onboarding",
  source: "rule",
  ruleName: "New joiners",
  status: "in_progress",
  mandatory: true,
  requiresCertificate: true,
  certificateId: null,
  percent: 60,
  completedLessons: 7,
  totalLessons: 12,
  totalCourses: 5,
  dueDate: "2026-12-31",
  dueState: "due_soon",
  dueLabel: "Due in 5 days",
  dueInDays: 5,
  assignedAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-02T00:00:00.000Z",
  completedAt: null,
  lastActivityAt: "2026-01-09T00:00:00.000Z",
  ...over,
});

const myLearning = (over = {}) => {
  const assignments = over.assignments ?? [
    assignment(),
    assignment({
      id: A2,
      pathName: "Sales Product Training",
      status: "assigned",
      percent: 0,
      dueState: "overdue",
      dueLabel: "Overdue by 3 days",
      totalCourses: 3,
      totalLessons: 8,
    }),
    assignment({
      id: A3,
      pathName: "Workplace Policies",
      status: "completed",
      percent: 100,
      dueState: "none",
      dueLabel: null,
      totalCourses: 4,
      totalLessons: 6,
    }),
  ];

  return {
    summary: {
      assigned: assignments.length,
      notStarted: 1,
      inProgress: 1,
      completed: 1,
      overdue: 1,
      dueSoon: 1,
    },
    assignments,
    continue: {
      ...assignments[0],
      nextLesson: { lessonId: "l9", lessonTitle: "HR Policies", courseId: "c3" },
    },
    ...over,
  };
};

const lesson = (over = {}) => ({
  id: "l1",
  title: "Welcome Video",
  description: "A short introduction.",
  type: "video",
  mandatory: true,
  status: "in_progress",
  inAssignment: true,
  contentMissing: false,
  videoPercent: 40,
  videoDurationSeconds: 300,
  videoCompletionPercent: 90,
  lastPositionSeconds: 0,
  completedAt: null,
  assessment: null,
  ...over,
});

const detail = (over = {}) => ({
  ...assignment(),
  description: "Everything you need to get started.",
  sequential: false,
  cancelReason: null,
  nextLesson: { lessonId: "l1", lessonTitle: "Welcome Video", courseId: "c1" },
  courses: [
    {
      courseId: "c1",
      name: "Welcome to Shraddha Impex",
      description: null,
      status: "in_progress",
      percent: 50,
      completedLessons: 1,
      totalLessons: 2,
      mandatory: true,
      active: true,
      locked: false,
      lockedBy: null,
      estimatedMinutes: 15,
      lessons: [lesson({ id: "l0", title: "Company Introduction", status: "completed" }), lesson()],
    },
  ],
  ...over,
});

const quizLesson = (over = {}) =>
  lesson({
    id: "q1",
    title: "Product Knowledge Quiz",
    type: "quiz",
    status: "not_started",
    videoPercent: 0,
    videoDurationSeconds: null,
    assessment: {
      assessmentId: "as1",
      attemptCount: 0,
      passed: false,
      bestScore: null,
      latestScore: null,
      maxAttempts: 3,
      attemptsRemaining: 3,
      passingPercent: 70,
      questionCount: 2,
      scorePolicy: "highest",
      attempts: [],
    },
    ...over,
  });

const dashboard = (over = {}) => ({
  metrics: {
    employeesAssigned: 40,
    assignments: 124,
    notStarted: 26,
    inProgress: 32,
    completed: 78,
    overdue: 14,
    averagePercent: 71,
    certificatesIssued: 60,
  },
  pathCompletion: [
    {
      pathId: "p1",
      pathName: "New Employee Onboarding",
      assigned: 50,
      completed: 30,
      inProgress: 15,
      overdue: 5,
      completionPercent: 60,
      averagePercent: 70,
    },
  ],
  byDepartment: [
    { departmentId: "d1", departmentName: "Sales", assigned: 20, completed: 17, completionPercent: 85 },
    { departmentId: "d2", departmentName: "Finance", assigned: 25, completed: 12, completionPercent: 48 },
  ],
  recentActivity: [
    {
      kind: "completed",
      employeeName: "Asha Verma",
      pathName: "Workplace Policies",
      detail: null,
      attemptNo: null,
      score: null,
      passed: true,
      at: "2026-02-01T10:00:00.000Z",
    },
    {
      kind: "attempt",
      employeeName: "Rohit Mehta",
      pathName: "Sales Product Training",
      detail: "Product Quiz",
      attemptNo: 1,
      score: 40,
      passed: false,
      at: "2026-02-01T08:00:00.000Z",
    },
  ],
  overdueQueue: [],
  ...over,
});

const certificate = (over = {}) => ({
  id: "cert1",
  pathName: "New Employee Onboarding",
  certificateNo: "SI-ACD-2026-0042",
  completionDate: "2026-08-12",
  validUntil: null,
  revoked: false,
  expired: false,
  ...over,
});

const contentRow = (over = {}) => ({
  id: "ct1",
  title: "Welcome to Shraddha Impex",
  description: null,
  type: "video",
  durationSeconds: 300,
  fileSize: 1024 * 1024,
  active: true,
  usedIn: 3,
  uploadedByName: "HR Admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let calls = [];
const envelope = (payload) => ({ data: { success: true, data: payload } });
const page = (rows) => envelope({ data: rows, total: rows.length, page: 1, pageSize: 25 });

function installTransport(overrides = {}) {
  calls = [];
  api.request.mockImplementation(async (config) => {
    calls.push(config);
    const key = `${config.method.toUpperCase()} ${config.url}`;
    if (overrides[key]) return overrides[key](config);

    if (key === "GET /hrms/academy/my-learning") return envelope(myLearning());
    if (key === "GET /hrms/academy/dashboard") return envelope(dashboard());
    if (key === "GET /hrms/academy/certificates/mine") return envelope([certificate()]);
    if (key === "GET /hrms/academy/content") return page([contentRow()]);
    if (key === "GET /hrms/academy/assessments") return page([]);
    if (key === "GET /hrms/academy/paths") return page([]);
    if (key === "GET /hrms/org/departments") return envelope([]);
    if (key === "GET /hrms/academy/assignments") return page([]);
    if (key === "GET /hrms/academy/rules") return page([]);
    if (key === `GET /hrms/academy/assignments/${A1}`) return envelope(detail());
    throw new Error(`unstubbed: ${key}`);
  });
}

const signIn = (roles = [R.EMPLOYEE], employee = { id: ME, managerChain: [] }) =>
  useHrmsStore.setState({
    actor: buildHrmsActor({ userId: "u1", roles, employee }),
    implementedModules: [M.DASHBOARD, M.ACADEMY],
    loaded: true,
    loading: false,
    error: null,
  });

const at = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hrms/academy/:tab" element={<AcademyPage />} />
        <Route path="/hrms/academy/learn/:assignmentId/lesson/:lessonId" element={<LessonPlayerPage />} />
      </Routes>
    </MemoryRouter>,
  );

const urlsHit = () => calls.map((c) => `${c.method.toUpperCase()} ${c.url}`);

beforeEach(() => {
  useHrmsStore.getState().clear();
  installTransport();
});

// ===========================================================================
// My Learning
// ===========================================================================

describe("my learning", () => {
  it("shows the resume row with the next lesson and a link straight to it", async () => {
    signIn();
    at("/hrms/academy/my-learning");

    await screen.findByRole("heading", { name: "Continue Learning" });
    expect(screen.getByText("HR Policies")).toBeTruthy();

    const resume = screen.getByRole("link", { name: /Continue Learning/i });
    expect(resume.getAttribute("href")).toBe(`/hrms/academy/learn/${A1}/lesson/l9`);
  });

  it("states the size of each path from the server's own counts", async () => {
    signIn();
    at("/hrms/academy/my-learning");

    await screen.findByText("Sales Product Training");
    // 3 courses / 8 lessons, singular and plural both handled.
    expect(screen.getByText("3 Courses")).toBeTruthy();
    expect(screen.getByText("8 Lessons")).toBeTruthy();
  });

  /**
   * 🔴 THE INVARIANT THIS SCREEN IS BUILT AROUND.
   *
   * The chip count and the number of cards it reveals come from ONE predicate.
   * A chip reading "Overdue (3)" that reveals two cards is the defect that
   * shape exists to rule out, so it is pinned here rather than left to hold by
   * inspection.
   */
  it("every chip count equals the number of cards it reveals", async () => {
    const user = userEvent.setup();
    signIn();
    at("/hrms/academy/my-learning");

    await screen.findByRole("button", { name: /^All/ });

    for (const label of ["In Progress", "Due Soon", "Overdue", "Completed"]) {
      const chip = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      const claimed = Number(chip.textContent.match(/\((\d+)\)/)[1]);

      await user.click(chip);
      expect(chip.getAttribute("aria-pressed")).toBe("true");

      const shown = screen.queryAllByRole("link", { name: /^(Start|Continue|Review)$/ });
      expect(shown.length, `${label} claims ${claimed}`).toBe(claimed);

      await user.click(chip); // back to All
    }
  });

  it("a chip that matches nothing says so rather than showing an empty grid", async () => {
    const user = userEvent.setup();
    signIn();
    installTransport({
      "GET /hrms/academy/my-learning": () =>
        envelope(myLearning({ assignments: [assignment({ dueState: "none", dueLabel: null })] })),
    });
    at("/hrms/academy/my-learning");

    const overdue = await screen.findByRole("button", { name: /^Overdue/ });
    expect(overdue.textContent).toContain("(0)");

    await user.click(overdue);
    expect(screen.getByText(/Nothing matches that filter/i)).toBeTruthy();
  });
});

// ===========================================================================
// The path page
// ===========================================================================

describe("the learning path page", () => {
  it("separates the course list from the path's own details", async () => {
    const user = userEvent.setup();
    signIn();
    render(
      <MemoryRouter initialEntries={[`/hrms/academy/learn/${A1}`]}>
        <Routes>
          <Route
            path="/hrms/academy/learn/:assignmentId"
            element={<LearningPathPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("tab", { name: "Course Content" });
    expect(screen.getByText("Welcome to Shraddha Impex")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "About" }));
    // The hero clamps the description; About carries it in full, so it is on
    // the page twice and that is the intent.
    expect(screen.getAllByText("Everything you need to get started.").length).toBe(2);
    // The About tab names where the assignment came from.
    expect(screen.getByText("New joiners")).toBeTruthy();
    // The course list is no longer rendered behind it.
    expect(screen.queryByText("Welcome to Shraddha Impex")).toBeNull();
  });
});

// ===========================================================================
// The lesson player
// ===========================================================================

describe("the lesson player", () => {
  it("states the completion rule for a video rather than burying it", async () => {
    signIn();
    installTransport({
      [`GET /hrms/academy/assignments/${A1}/lessons/l1/content-url`]: () =>
        envelope({ url: "https://storage.example/v.mp4", name: "v.mp4" }),
    });

    at(`/hrms/academy/learn/${A1}/lesson/l1`);

    await screen.findByRole("heading", { name: "Details" });
    expect(screen.getByText(/Marked complete automatically at/i)).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByText(/Lesson 2 of 2/)).toBeTruthy();
  });

  it("offers the course outline beside the lesson", async () => {
    signIn();
    installTransport({
      [`GET /hrms/academy/assignments/${A1}/lessons/l1/content-url`]: () =>
        envelope({ url: "https://storage.example/v.mp4", name: "v.mp4" }),
    });

    at(`/hrms/academy/learn/${A1}/lesson/l1`);

    const outline = await screen.findByRole("navigation", { name: "Course content" });
    expect(within(outline).getByText("Company Introduction")).toBeTruthy();
    // The lesson being watched is marked as the current page for a screen reader.
    const current = within(outline).getByRole("link", { current: "page" });
    expect(current.textContent).toContain("Welcome Video");
  });

  it("turns the details rail into the quiz's rules before it is started", async () => {
    signIn();
    installTransport({
      [`GET /hrms/academy/assignments/${A1}`]: () =>
        envelope(
          detail({
            nextLesson: null,
            courses: [
              {
                courseId: "c1",
                name: "Assessment",
                description: null,
                status: "not_started",
                percent: 0,
                completedLessons: 0,
                totalLessons: 1,
                mandatory: true,
                active: true,
                locked: false,
                lockedBy: null,
                estimatedMinutes: null,
                lessons: [quizLesson()],
              },
            ],
          }),
        ),
    });

    at(`/hrms/academy/learn/${A1}/lesson/q1`);

    await screen.findByRole("heading", { name: "Quiz Details" });
    expect(screen.getByText("Pass Mark").nextSibling.textContent).toContain("70%");
    expect(screen.getByText("Attempt Limit").nextSibling.textContent).toContain("3 attempts");
    expect(screen.getByText("Questions").nextSibling.textContent).toContain("2");
  });
});

// ===========================================================================
// The quiz
// ===========================================================================

describe("sitting an assessment", () => {
  const twoQuestions = {
    attemptNo: 1,
    passingPercent: 70,
    questions: [
      {
        id: "qq1",
        text: "Which brand is known for precision measurement tools?",
        type: "single",
        options: [
          { id: "o1", text: "Koken" },
          { id: "o2", text: "IMADA" },
        ],
      },
      {
        id: "qq2",
        text: "What is the notice period?",
        type: "single",
        options: [
          { id: "o3", text: "30 days" },
          { id: "o4", text: "60 days" },
        ],
      },
    ],
  };

  const quizTransport = (extra = {}) =>
    installTransport({
      [`GET /hrms/academy/assignments/${A1}`]: () =>
        envelope(
          detail({
            nextLesson: null,
            courses: [
              {
                courseId: "c1",
                name: "Assessment",
                description: null,
                status: "not_started",
                percent: 0,
                completedLessons: 0,
                totalLessons: 1,
                mandatory: true,
                active: true,
                locked: false,
                lockedBy: null,
                estimatedMinutes: null,
                lessons: [quizLesson()],
              },
            ],
          }),
        ),
      [`GET /hrms/academy/assignments/${A1}/lessons/q1/attempt`]: () => envelope(twoQuestions),
      ...extra,
    });

  it("asks one question at a time and submits every answer in a single request", async () => {
    const user = userEvent.setup();
    signIn();

    let submitted = null;
    quizTransport({
      [`POST /hrms/academy/assignments/${A1}/lessons/q1/attempt`]: (config) => {
        submitted = config.data;
        return envelope({
          attemptNo: 1,
          score: 50,
          correctCount: 1,
          questionCount: 2,
          passed: false,
          passingPercent: 70,
          attemptsRemaining: 2,
          results: [
            { questionId: "qq1", correct: true },
            { questionId: "qq2", correct: false },
          ],
          assignmentStatus: "in_progress",
          pathCompleted: false,
        });
      },
    });

    at(`/hrms/academy/learn/${A1}/lesson/q1`);

    await user.click(await screen.findByRole("button", { name: "Start assessment" }));

    await screen.findByRole("heading", { name: "Question 1 of 2" });
    // The second question is not on the page yet.
    expect(screen.queryByText("What is the notice period?")).toBeNull();

    await user.click(screen.getByLabelText("IMADA", { selector: "input" }).closest("label"));
    await user.click(screen.getByRole("button", { name: /^Next/ }));

    await screen.findByRole("heading", { name: "Question 2 of 2" });
    await user.click(screen.getByText("30 days"));
    await user.click(screen.getByRole("button", { name: "Submit assessment" }));

    await screen.findByRole("heading", { name: "Assessment Completed" });

    // ONE submission carrying BOTH answers — pagination is a display concern.
    const posts = urlsHit().filter((u) => u.includes("/attempt") && u.startsWith("POST"));
    expect(posts).toHaveLength(1);
    expect(submitted.answers).toHaveLength(2);
  });

  it("reports the outcome with the figures behind it", async () => {
    const user = userEvent.setup();
    signIn();
    quizTransport({
      [`POST /hrms/academy/assignments/${A1}/lessons/q1/attempt`]: () =>
        envelope({
          attemptNo: 2,
          score: 100,
          correctCount: 2,
          questionCount: 2,
          passed: true,
          passingPercent: 70,
          attemptsRemaining: 1,
          results: [
            { questionId: "qq1", correct: true },
            { questionId: "qq2", correct: true },
          ],
          assignmentStatus: "completed",
          pathCompleted: true,
        }),
    });

    at(`/hrms/academy/learn/${A1}/lesson/q1`);
    await user.click(await screen.findByRole("button", { name: "Start assessment" }));
    await screen.findByRole("heading", { name: "Question 1 of 2" });
    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await user.click(screen.getByRole("button", { name: "Submit assessment" }));

    await screen.findByRole("heading", { name: "Assessment Completed" });
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    // A pass offers no retry.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  /**
   * 🔴 The review screen must never become an answer key.
   *
   * The server sends per-question correctness and deliberately not the right
   * answers. This pins that the screen shows only what the LEARNER picked — an
   * unpicked option carries no marking either way, so a wrong attempt cannot be
   * turned into a correct one by reading this page.
   */
  it("reviews what the learner picked and never which option was right", async () => {
    const user = userEvent.setup();
    signIn();
    quizTransport({
      [`POST /hrms/academy/assignments/${A1}/lessons/q1/attempt`]: () =>
        envelope({
          attemptNo: 1,
          score: 50,
          correctCount: 1,
          questionCount: 2,
          passed: false,
          passingPercent: 70,
          attemptsRemaining: 2,
          results: [
            { questionId: "qq1", correct: true },
            { questionId: "qq2", correct: false },
          ],
          assignmentStatus: "in_progress",
          pathCompleted: false,
        }),
    });

    at(`/hrms/academy/learn/${A1}/lesson/q1`);
    await user.click(await screen.findByRole("button", { name: "Start assessment" }));
    await screen.findByRole("heading", { name: "Question 1 of 2" });
    await user.click(screen.getByText("Koken"));
    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await user.click(screen.getByText("60 days"));
    await user.click(screen.getByRole("button", { name: "Submit assessment" }));

    await screen.findByRole("heading", { name: "Assessment Completed" });
    await user.click(screen.getByRole("button", { name: "Review Answers" }));

    await screen.findByRole("heading", { name: "Review answers" });
    expect(screen.getByText(/Correct answers are not shown/i)).toBeTruthy();

    /**
     * Exactly one "Your pick" per question and no other option marked.
     *
     * Four options were rendered across the two questions; only the two the
     * learner chose carry a label. On the question they got WRONG that means
     * the right option sits there unmarked — which is the whole point.
     */
    expect(screen.getAllByText("Your pick")).toHaveLength(2);
    expect(screen.getByText("30 days")).toBeTruthy(); // the correct option...
    expect(screen.getByText("30 days").previousSibling.textContent).toBe(""); // ...unlabelled
  });
});

// ===========================================================================
// The HR dashboard
// ===========================================================================

describe("the academy dashboard", () => {
  const asHr = () => signIn([R.HR_ADMIN]);

  it("reports the completion RATE, not the average progress", async () => {
    asHr();
    at("/hrms/academy/dashboard");

    // 78 of 124 completed is 63%. The average progress is 71% and must not be
    // the headline — they answer different questions.
    const ring = await screen.findByRole("img", { name: /63% Overall completion/i });
    expect(ring).toBeTruthy();
    expect(screen.getByText(/average progress 71%/i)).toBeTruthy();
  });

  it("breaks completion down by department", async () => {
    asHr();
    at("/hrms/academy/dashboard");

    await screen.findByRole("heading", { name: "Completion by Department" });
    expect(screen.getByRole("progressbar", { name: "Sales: 85%" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Finance: 48%" })).toBeTruthy();
    expect(screen.getByText("17 of 20 complete")).toBeTruthy();
  });

  it("shows failed attempts in the activity feed as plainly as passes", async () => {
    asHr();
    at("/hrms/academy/dashboard");

    await screen.findByRole("heading", { name: "Recent Activity" });
    expect(screen.getByText("Asha Verma")).toBeTruthy();
    expect(screen.getByText(/failed/)).toBeTruthy();
    expect(screen.getByText(/\(Attempt 1\)/)).toBeTruthy();
  });
});

// ===========================================================================
// Certificates
// ===========================================================================

describe("certificates", () => {
  it("finds a certificate by its number, which is what people are given", async () => {
    const user = userEvent.setup();
    signIn();
    at("/hrms/academy/certificates");

    await screen.findByText("SI-ACD-2026-0042");
    await user.type(screen.getByLabelText("Search certificates"), "0042");
    expect(screen.getByText("SI-ACD-2026-0042")).toBeTruthy();

    await user.clear(screen.getByLabelText("Search certificates"));
    await user.type(screen.getByLabelText("Search certificates"), "nothing-like-this");
    expect(screen.getByText(/No certificates match that search/i)).toBeTruthy();
  });

  it("will not offer a revoked certificate for download", async () => {
    signIn();
    installTransport({
      "GET /hrms/academy/certificates/mine": () => envelope([certificate({ revoked: true })]),
    });
    at("/hrms/academy/certificates");

    await screen.findByText("Revoked");
    expect(screen.getByRole("button", { name: /Download PDF/i }).disabled).toBe(true);
  });
});

// ===========================================================================
// The content library
// ===========================================================================

describe("the content library", () => {
  it("says how many courses depend on an item, before anyone tries to delete it", async () => {
    signIn([R.HR_ADMIN]);
    at("/hrms/academy/content");

    await screen.findByText("Welcome to Shraddha Impex");
    expect(screen.getByText("3 courses")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("filters by type through the server rather than in the browser", async () => {
    const user = userEvent.setup();
    signIn([R.HR_ADMIN]);
    at("/hrms/academy/content");

    await screen.findByText("Welcome to Shraddha Impex");
    await user.click(screen.getByRole("button", { name: "PDFs" }));

    await waitFor(() => {
      const last = calls.at(-1);
      expect(last.url).toBe("/hrms/academy/content");
      expect(last.params.type).toBe("pdf");
    });
  });
});

// ===========================================================================
// The learning path catalogue
// ===========================================================================

const pathRow = (over = {}) => ({
  id: "p1",
  name: "New Employee Onboarding",
  description: "Everything you need to get started at Shraddha Impex.",
  tags: ["Onboarding"],
  audience: { departmentIds: [], locationIds: [], designations: [], employmentTypes: [] },
  dueDateMode: "joining_plus_days",
  dueDays: 30,
  dueDate: null,
  mandatory: true,
  sequential: true,
  requiresCertificate: true,
  certificateValidityMonths: null,
  active: true,
  status: "active",
  courseCount: 5,
  lessonCount: 12,
  assessmentCount: 1,
  assignedCount: 128,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  ...over,
});

const catalogue = (rows, summary = {}) => ({
  data: rows,
  total: rows.length,
  page: 1,
  pageSize: 12,
  summary: { total: 12, active: 8, draft: 2, archived: 2, ...summary },
});

const pathDetail = (over = {}) => ({
  ...pathRow(),
  createdByName: "Sumedh",
  updatedByName: "Sumedh",
  courses: [
    {
      id: "c1",
      name: "Welcome to Shraddha Impex",
      description: null,
      estimatedMinutes: 20,
      mandatory: true,
      active: true,
      prerequisiteCourseId: null,
      lessons: [
        {
          id: "l1",
          title: "Company Introduction",
          type: "video",
          mandatory: true,
          contentMissing: false,
          videoCompletionPercent: 90,
          content: { durationSeconds: 300 },
        },
        {
          id: "l2",
          title: "Our Mission and Values",
          type: "document",
          mandatory: true,
          contentMissing: false,
          content: { durationSeconds: null },
        },
      ],
    },
    {
      id: "c2",
      name: "Company Overview",
      description: null,
      estimatedMinutes: 30,
      mandatory: true,
      active: true,
      prerequisiteCourseId: "c1",
      lessons: [],
    },
  ],
  ...over,
});

describe("the learning paths catalogue", () => {
  const asAdmin = () => signIn([R.HR_ADMIN]);

  const withCatalogue = (rows = [pathRow()], extra = {}) =>
    installTransport({
      "GET /hrms/academy/paths": () => envelope(catalogue(rows)),
      "GET /hrms/org/departments": () => envelope([{ id: "d1", name: "Sales" }]),
      ...extra,
    });

  it("summarises the catalogue and states what each path contains", async () => {
    asAdmin();
    withCatalogue();
    at("/hrms/academy/catalogue");

    await screen.findByText("New Employee Onboarding");

    // The four tiles from the reference.
    expect(screen.getByRole("button", { name: /Total Learning Paths/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^12/ })).toBeTruthy();

    // Counts, not just a course number.
    expect(screen.getByText("5 Courses")).toBeTruthy();
    expect(screen.getByText("12 Lessons")).toBeTruthy();
    expect(screen.getByText("1 Assessment")).toBeTruthy();
    expect(screen.getByText("128 assigned")).toBeTruthy();
  });

  /**
   * A tile that reports a number and does nothing leaves the reader to build
   * the filter that finds those rows by hand. Each one is a control.
   */
  it("filtering by a tile asks the SERVER for that status", async () => {
    const user = userEvent.setup();
    asAdmin();
    withCatalogue();
    at("/hrms/academy/catalogue");

    await screen.findByText("New Employee Onboarding");
    await user.click(screen.getByRole("button", { name: /Drafts/i }));

    await waitFor(() => {
      const last = calls.filter((c) => c.url === "/hrms/academy/paths").at(-1);
      expect(last.params.status).toBe("draft");
      // Paging resets — page 3 of "all" is not page 3 of "drafts".
      expect(last.params.page).toBe(1);
    });
  });

  it("carries the status through to the badge without re-deriving it", async () => {
    asAdmin();
    withCatalogue([
      pathRow({ id: "p1", name: "Live path", status: "active" }),
      pathRow({ id: "p2", name: "Empty path", status: "draft", courseCount: 0, lessonCount: 0 }),
      pathRow({ id: "p3", name: "Retired path", status: "archived", active: false }),
    ]);
    at("/hrms/academy/catalogue");

    await screen.findByText("Live path");

    // Scoped to the card footers — "Active" and "Archived" are also stat-tile
    // labels, and asserting against those would pass without a badge existing.
    const badgeIn = (name) =>
      screen
        .getByText(name)
        .closest("article")
        .querySelector("footer")
        .textContent;

    expect(badgeIn("Live path")).toContain("Active");
    expect(badgeIn("Empty path")).toContain("Draft");
    expect(badgeIn("Retired path")).toContain("Archived");
  });

  it("searching and sorting both go to the server", async () => {
    const user = userEvent.setup();
    asAdmin();
    withCatalogue();
    at("/hrms/academy/catalogue");

    await screen.findByText("New Employee Onboarding");

    await user.selectOptions(screen.getByLabelText("Sort by"), "name");
    await waitFor(() => {
      const last = calls.filter((c) => c.url === "/hrms/academy/paths").at(-1);
      expect(last.params.sort).toBe("name");
    });

    await user.type(screen.getByLabelText("Search learning paths"), "onboard");
    await waitFor(() => {
      const last = calls.filter((c) => c.url === "/hrms/academy/paths").at(-1);
      expect(last.params.search).toBe("onboard");
    });
  });

  it("offers only the tags that are actually in the catalogue", async () => {
    asAdmin();
    withCatalogue([
      pathRow({ id: "p1", tags: ["Onboarding", "Compliance"] }),
      pathRow({ id: "p2", name: "Sales basics", tags: ["Sales"] }),
    ]);
    at("/hrms/academy/catalogue");

    await screen.findByText("Sales basics");
    const tagFilter = screen.getByLabelText("Filter by tag");
    const options = [...tagFilter.options].map((o) => o.textContent);

    expect(options).toEqual(["All Tags", "Compliance", "Onboarding", "Sales"]);
  });
});

// ===========================================================================
// The path drawer
// ===========================================================================

describe("the learning path drawer", () => {
  const openDrawer = async (detail = pathDetail(), rows = [pathRow()]) => {
    const user = userEvent.setup();
    signIn([R.HR_ADMIN]);
    installTransport({
      "GET /hrms/academy/paths": () => envelope(catalogue(rows)),
      "GET /hrms/org/departments": () => envelope([]),
      [`GET /hrms/academy/paths/${detail.id}`]: () => envelope(detail),
      "GET /hrms/academy/assignments": () => page([]),
    });
    at("/hrms/academy/catalogue");

    await user.click(await screen.findByRole("button", { name: `Open ${rows[0].name}` }));
    return user;
  };

  it("opens a path without leaving the catalogue", async () => {
    await openDrawer();

    await screen.findByRole("heading", { name: "Learning Path Structure" });
    // The catalogue is still mounted behind it.
    expect(screen.getByLabelText("Search learning paths")).toBeTruthy();
    expect(screen.getByText("Sumedh")).toBeTruthy();
  });

  it("shows the structure and expands a course to its lessons", async () => {
    const user = await openDrawer();

    await screen.findByRole("heading", { name: "Learning Path Structure" });
    // The first course opens by default; its lessons are visible with type
    // and duration.
    expect(screen.getByText("Company Introduction")).toBeTruthy();
    expect(screen.getByText(/Video · 5m/)).toBeTruthy();

    // The second is collapsed until asked for.
    expect(screen.queryByText("No lessons yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Company Overview/ }));
    expect(screen.getByText("No lessons yet.")).toBeTruthy();
  });

  /**
   * 🔴 Every requirement is read off the path. A panel that lists rules
   * somebody typed looks authoritative and drifts the first time the
   * configuration changes.
   */
  it("derives the completion requirements from the path's own configuration", async () => {
    await openDrawer();

    await screen.findByRole("heading", { name: "Completion Requirements" });
    expect(screen.getByText("Complete all mandatory lessons")).toBeTruthy();
    expect(screen.getByText("Pass the assessment")).toBeTruthy();
    expect(screen.getByText("Take the courses in order")).toBeTruthy();
    expect(screen.getByText("Complete within 30 days of joining")).toBeTruthy();
  });

  it("drops the rows a path does not have", async () => {
    await openDrawer(
      pathDetail({
        sequential: false,
        assessmentCount: 0,
        dueDateMode: "none",
        requiresCertificate: false,
      }),
    );

    await screen.findByRole("heading", { name: "Completion Requirements" });
    expect(screen.getByText("Complete all mandatory lessons")).toBeTruthy();
    expect(screen.queryByText("Take the courses in order")).toBeNull();
    expect(screen.queryByText(/Pass the assessment/)).toBeNull();
    expect(screen.queryByText(/Complete within/)).toBeNull();
    expect(screen.getByText("This path does not award a certificate.")).toBeTruthy();
  });

  it("will not offer to assign a path with nothing in it", async () => {
    await openDrawer(
      pathDetail({ status: "draft", courseCount: 0, lessonCount: 0, courses: [] }),
      [pathRow({ status: "draft", courseCount: 0 })],
    );

    await screen.findByText(/No courses yet/i);
    expect(screen.getByRole("button", { name: /Assign to Employees/i }).disabled).toBe(true);
  });

  it("lists who has the path on its own tab", async () => {
    const user = await openDrawer();
    await screen.findByRole("heading", { name: "Learning Path Structure" });

    // The module tab strip behind the drawer also has an "Assignments" tab, so
    // this has to be the one inside the panel.
    const drawerTabs = screen.getAllByRole("tab", { name: /Assignments/ });
    await user.click(drawerTabs.at(-1));

    await waitFor(() => {
      const last = calls.filter((c) => c.url === "/hrms/academy/assignments").at(-1);
      expect(last.params.pathId).toBe("p1");
    });
    expect(await screen.findByText(/Nobody has this path yet/i)).toBeTruthy();
  });
});

// ===========================================================================
// Sizing
// ===========================================================================

/**
 * 🔴 THE PREVIEWS MUST CARRY A DEFINITE HEIGHT.
 *
 * Every cover and the media player used `aspect-video` / `aspect-[16/9]`, and
 * all of them collapsed on screen: the media sits inside a column flex
 * container, where an item's height resolves from its CONTENT before the aspect
 * ratio is consulted. An empty box wrapping a `<video>` has no content height,
 * so the ratio never got a width to work from and the player rendered as a
 * sliver.
 *
 * jsdom computes no layout, so a rendered height cannot be measured here. What
 * CAN be asserted is the thing that was wrong: these boxes must be sized by an
 * explicit height and must not be left to an aspect ratio.
 */
describe("preview sizing", () => {
  const hasDefiniteHeight = (el) => /(^|\s)(h-\[|h-\d|sm:h-|h-full)/.test(el.className);

  it("the lesson player's media box is sized, not left to an aspect ratio", async () => {
    signIn();
    installTransport({
      [`GET /hrms/academy/assignments/${A1}/lessons/l1/content-url`]: () =>
        envelope({ url: "https://storage.example/v.mp4", name: "v.mp4" }),
    });

    at(`/hrms/academy/learn/${A1}/lesson/l1`);
    await screen.findByRole("heading", { name: "Details" });

    // The element only mounts once the presigned URL has resolved.
    await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
    const video = document.querySelector("video");
    const box = video.parentElement;

    expect(hasDefiniteHeight(box)).toBe(true);
    expect(box.className).not.toContain("aspect-");
    // Letterboxed rather than cropped — a portrait clip is shown whole.
    expect(video.className).toContain("object-contain");
  });

  it("a catalogue cover is sized, not left to an aspect ratio", async () => {
    signIn([R.HR_ADMIN]);
    installTransport({
      "GET /hrms/academy/paths": () => envelope(catalogue([pathRow()])),
      "GET /hrms/org/departments": () => envelope([]),
    });

    at("/hrms/academy/catalogue");
    await screen.findByText("New Employee Onboarding");

    const cover = screen.getByRole("button", { name: "Open New Employee Onboarding" });
    expect(hasDefiniteHeight(cover)).toBe(true);
    expect(cover.className).not.toContain("aspect-");
  });

  /**
   * `Input` and `Select` wrap themselves in a `w-full` div. In a toolbar that
   * made every control claim its own line. Each one is now given a sized
   * wrapper, so none of them may be a bare full-width flex child.
   */
  it("every filter control is sized so the bar stays one row", async () => {
    signIn([R.HR_ADMIN]);
    installTransport({
      "GET /hrms/academy/paths": () => envelope(catalogue([pathRow()])),
      "GET /hrms/org/departments": () => envelope([]),
    });

    at("/hrms/academy/catalogue");
    const search = await screen.findByLabelText("Search learning paths");

    const bar = search.closest("div.flex.flex-wrap");
    expect(bar).toBeTruthy();

    for (const child of [...bar.children]) {
      // Either it flexes (the search field) or it has an explicit width.
      expect(/flex-1|w-\[/.test(child.className), child.className).toBe(true);
    }

    // All four selects live in that one bar.
    expect(bar.querySelectorAll("select").length).toBe(4);
  });
});
