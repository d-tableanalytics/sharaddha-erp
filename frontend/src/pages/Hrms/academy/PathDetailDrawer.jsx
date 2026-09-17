import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GraduationCap,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Lock,
  Layers,
  BookOpen,
  ClipboardList,
  Clock,
  Trophy,
  Pencil,
  Send,
  Settings2,
  Users,
} from "lucide-react";

import { Drawer } from "../../../components/ui/Drawer";
import { TabNav } from "../../../components/hrms/TabNav";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Initial } from "../../../components/hrms/dashboard/DashboardPieces";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { DUE_DATE_MODE_LABELS } from "@shared/constants/academy.js";
import {
  pathsApi,
  assignmentsApi,
  formatDay,
  formatDuration,
  CONTENT_TYPE_LABELS,
} from "../../../services/hrms/academy";
import { PercentBar, AcademyStatusBadge, LESSON_ICONS } from "./academyShared";
import { CoverTile } from "./academyVisuals";
import { PATH_STATUS_META } from "./pathStatus";

/**
 * One learning path, inspected without leaving the catalogue.
 *
 * ---------------------------------------------------------------------------
 * A DRAWER FOR READING, A PAGE FOR BUILDING
 * ---------------------------------------------------------------------------
 * `PathBuilderPage` already owns the editorial job — reordering courses, adding
 * lessons, deleting things — and needs the whole screen to do it. What was
 * missing was the far commoner job: opening a path to see what is IN it before
 * deciding whether to assign it, and going straight back to the list.
 *
 * That is the split the Employees module uses and the reason this is a drawer:
 * the catalogue stays behind it, so inspecting six paths in a row costs no
 * navigation at all.
 *
 * Every editing action here hands off to the builder rather than reimplementing
 * it. Two places that can add a lesson is two places that can disagree about
 * what adding one does to a live assignment.
 */
export function PathDetailDrawer({ pathId, onClose }) {
  const [tab, setTab] = useState("overview");
  const [path, setPath] = useState(undefined);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!pathId) return;
    setError(null);
    setPath(undefined);
    try {
      setPath(await pathsApi.get(pathId));
    } catch (err) {
      setError(err);
    }
  }, [pathId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Reset to the first tab whenever a different path is opened. */
  useEffect(() => {
    setTab("overview");
  }, [pathId]);

  const status = path ? PATH_STATUS_META[path.status] : null;

  return (
    <Drawer
      isOpen={Boolean(pathId)}
      onClose={onClose}
      maxWidth="max-w-2xl"
      bodyClassName="p-5"
      title={
        <span className="flex items-center gap-2.5 min-w-0">
          <GraduationCap size={18} className="shrink-0 text-slate-400" />
          <span className="truncate">{path?.name ?? "Learning path"}</span>
          {status && (
            <Badge variant={status.tone} className="shrink-0">
              {status.label}
            </Badge>
          )}
        </span>
      }
      subheader={
        path ? (
          <TabNav
            tabs={[
              { key: "overview", label: "Overview" },
              { key: "structure", label: "Courses & Lessons" },
              { key: "settings", label: "Settings" },
              { key: "assignments", label: "Assignments", badge: path.assignedCount ?? 0 },
            ]}
            activeKey={tab}
            onChange={setTab}
            className="border-b-0"
          />
        ) : null
      }
      footer={
        path ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`${HRMS_ROUTE_PREFIX}/academy/paths/${path.id}`} className="max-sm:w-full">
              <Button size="sm" variant="outline" className="max-sm:w-full">
                <Pencil size={14} className="mr-1.5" />
                Edit Learning Path
              </Button>
            </Link>

            <Link
              to={`${HRMS_ROUTE_PREFIX}/academy/assignments`}
              className="sm:ml-auto max-sm:w-full"
            >
              {/*
                Assigning is refused for a path with nothing in it — the server
                would accept it and hand somebody a path that completes the
                instant it lands. Said here rather than discovered there.
              */}
              <Button size="sm" className="max-sm:w-full" disabled={path.status === "draft"}>
                <Send size={14} className="mr-1.5" />
                Assign to Employees
              </Button>
            </Link>
          </div>
        ) : null
      }
    >
      {error ? (
        <ErrorState description={error.message} onRetry={load} />
      ) : path === undefined ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <LoadingSpinner size={28} />
        </div>
      ) : tab === "overview" ? (
        <Overview path={path} />
      ) : tab === "structure" ? (
        <Structure path={path} />
      ) : tab === "settings" ? (
        <Settings path={path} />
      ) : (
        <Assignments path={path} />
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ path }) {
  return (
    <div className="flex flex-col gap-5">
      <PathHero path={path} />

      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold text-slate-900">Learning Path Structure</h3>
          <Link
            to={`${HRMS_ROUTE_PREFIX}/academy/paths/${path.id}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-700 hover:underline"
          >
            <Settings2 size={12} />
            Open builder
          </Link>
        </div>
        <CourseList path={path} />
      </section>

      <div className="grid gap-4 sm:grid-cols-5">
        <CompletionRequirements path={path} className="sm:col-span-3" />
        <CertificatePanel path={path} className="sm:col-span-2" />
      </div>
    </div>
  );
}

function PathHero({ path }) {
  return (
    <section className="flex flex-col sm:flex-row gap-4">
      <div className="shrink-0 w-full h-28 sm:w-[148px] sm:h-[84px] rounded-xl overflow-hidden">
        <CoverTile name={path.name} kind="path" />
      </div>

      <div className="flex-1 flex flex-col gap-2.5 min-w-0">
        <div>
          <h3 className="text-base font-bold text-slate-900 leading-snug">{path.name}</h3>
          {path.description && (
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">{path.description}</p>
          )}
        </div>

        <PathTags path={path} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
          <Count icon={Layers} n={path.courseCount} one="Course" many="Courses" />
          <Count icon={BookOpen} n={path.lessonCount} one="Lesson" many="Lessons" />
          <Count icon={ClipboardList} n={path.assessmentCount} one="Assessment" many="Assessments" />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-slate-400 border-t border-slate-100">
          {path.createdByName && (
            <span className="inline-flex items-center gap-1.5 pt-2">
              Created by
              <Initial name={path.createdByName} size={20} />
              <span className="font-semibold text-slate-600">{path.createdByName}</span>
            </span>
          )}
          {path.createdAt && (
            <span className="pt-2">Created on {formatDay(path.createdAt.slice(0, 10))}</span>
          )}
          {path.updatedAt && (
            <span className="pt-2">Last updated {formatDay(path.updatedAt.slice(0, 10))}</span>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The chip row under the title.
 *
 * `mandatory` and the audience are shown ALONGSIDE the free-text tags rather
 * than being left to them: they are facts the system enforces, and relying on
 * somebody having typed "Mandatory" as a tag would make the chip row a
 * description of what was typed instead of what is true.
 */
export function PathTags({ path, className }) {
  const audience = path.audience ?? {};
  const targeted =
    (audience.departmentIds?.length ?? 0) +
      (audience.locationIds?.length ?? 0) +
      (audience.designations?.length ?? 0) +
      (audience.employmentTypes?.length ?? 0) >
    0;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {(path.tags ?? []).map((tag) => (
        <Badge key={tag} variant="primary" className="text-[10px] px-2 py-0">
          {tag}
        </Badge>
      ))}
      <Badge variant={path.mandatory ? "warning" : "neutral"} className="text-[10px] px-2 py-0">
        {path.mandatory ? "Mandatory" : "Optional"}
      </Badge>
      <Badge variant="neutral" className="text-[10px] px-2 py-0">
        {targeted ? "Targeted" : "All Employees"}
      </Badge>
    </div>
  );
}

function Count({ icon: Icon, n, one, many }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={12} className="text-slate-400" />
      <span className="tabular-nums">{n ?? 0}</span> {n === 1 ? one : many}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The structure
// ---------------------------------------------------------------------------

/**
 * The numbered course list.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE LOCKS HERE ARE STRUCTURAL, NOT SOMEBODY'S PROGRESS
 * ---------------------------------------------------------------------------
 * This is the CATALOGUE, not a learner's copy. A padlock means the path is
 * sequential and this course sits behind the one before it — it is a statement
 * about the design of the path, the same for everybody who reads this screen.
 *
 * It deliberately does not show completion. An administrator opening a path in
 * the catalogue has no progress against it, and borrowing the learner's
 * vocabulary would put a tick beside a course nobody has taken.
 */
function CourseList({ path }) {
  const [open, setOpen] = useState(() => new Set([path.courses?.[0]?.id]));
  const allOpen = (path.courses ?? []).length > 0 && open.size === path.courses.length;

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!path.courses || path.courses.length === 0) {
    return (
      <EmptyState
        title="No courses yet"
        description="This path has nothing in it, so it cannot usefully be assigned. Open the builder to add courses and lessons."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end -mt-1">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(path.courses.map((c) => c.id)))
          }
        >
          {allOpen ? (
            <ChevronUp size={12} className="mr-1" />
          ) : (
            <ChevronDown size={12} className="mr-1" />
          )}
          {allOpen ? "Collapse all" : "Expand All"}
        </Button>
      </div>

      {path.courses.map((course, index) => {
        const expanded = open.has(course.id);
        // Sequential paths gate every course after the first on the one before.
        const gated = path.sequential && index > 0;

        return (
          <article
            key={course.id}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(course.id)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-50 text-primary-700 text-xs font-bold tabular-nums shrink-0">
                {index + 1}
              </span>

              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{course.name}</span>
                  {!course.mandatory && (
                    <Badge variant="neutral" className="text-[10px] px-2 py-0">
                      Optional
                    </Badge>
                  )}
                  {!course.active && (
                    <Badge variant="warning" className="text-[10px] px-2 py-0">
                      Archived
                    </Badge>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
                  <span>
                    {course.lessons.length} {course.lessons.length === 1 ? "Lesson" : "Lessons"}
                  </span>
                  {course.estimatedMinutes && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} className="text-slate-400" />~{course.estimatedMinutes} min
                    </span>
                  )}
                </span>
              </span>

              {gated && (
                <Badge variant="neutral" className="shrink-0 text-[10px]">
                  <Lock size={10} className="mr-1" />
                  In order
                </Badge>
              )}

              <span className="shrink-0 text-slate-300">
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </button>

            {expanded && (
              <div className="border-t border-slate-100">
                {course.lessons.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-slate-500">No lessons yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-50">
                    {course.lessons.map((lesson) => {
                      const Icon = LESSON_ICONS[lesson.type] ?? LESSON_ICONS.document;
                      return (
                        <li
                          key={lesson.id}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-50/40"
                        >
                          {lesson.contentMissing ? (
                            <Circle size={13} className="shrink-0 text-warning-500" />
                          ) : (
                            <Circle size={13} className="shrink-0 text-slate-300" />
                          )}
                          <Icon size={14} className="shrink-0 text-slate-400" />

                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] text-slate-800 truncate">
                              {lesson.title}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              {CONTENT_TYPE_LABELS[lesson.type] ?? lesson.type}
                              {lesson.content?.durationSeconds != null && (
                                <> · {formatDuration(lesson.content.durationSeconds)}</>
                              )}
                              {!lesson.mandatory && <> · Optional</>}
                            </span>
                          </span>

                          {lesson.contentMissing && (
                            <Badge variant="warning" className="shrink-0 text-[10px]">
                              Unavailable
                            </Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Structure({ path }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
          <Count icon={Layers} n={path.courseCount} one="Course" many="Courses" />
          <Count icon={BookOpen} n={path.lessonCount} one="Lesson" many="Lessons" />
          <Count icon={ClipboardList} n={path.assessmentCount} one="Assessment" many="Assessments" />
        </div>
        <Link to={`${HRMS_ROUTE_PREFIX}/academy/paths/${path.id}`}>
          <Button size="xs" variant="outline">
            <Settings2 size={12} className="mr-1.5" />
            Open builder
          </Button>
        </Link>
      </div>

      <CourseList path={path} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Completion and certificate
// ---------------------------------------------------------------------------

/**
 * What finishing this path actually requires.
 *
 * ---------------------------------------------------------------------------
 * EVERY LINE IS READ OFF THE PATH, NEVER WRITTEN BY HAND
 * ---------------------------------------------------------------------------
 * A requirements panel that lists rules somebody typed into a description is
 * the worst version of this component: it looks authoritative and drifts the
 * first time the configuration changes. Each row below is derived from the
 * field that enforces it, so a path with no due date shows no deadline row and
 * a path with no assessment shows no pass mark.
 */
function CompletionRequirements({ path, className }) {
  const rows = [
    { key: "mandatory", label: "Complete all mandatory lessons", on: true },
    path.assessmentCount > 0 && {
      key: "assessment",
      label: `Pass ${path.assessmentCount === 1 ? "the assessment" : `all ${path.assessmentCount} assessments`}`,
      on: true,
    },
    path.sequential && {
      key: "order",
      label: "Take the courses in order",
      on: true,
    },
    path.dueDateMode !== "none" && {
      key: "due",
      label:
        path.dueDateMode === "fixed"
          ? `Complete by ${formatDay(path.dueDate)}`
          : `Complete within ${path.dueDays} days of ${
              path.dueDateMode === "joining_plus_days" ? "joining" : "assignment"
            }`,
      on: true,
    },
  ].filter(Boolean);

  return (
    <section
      className={`p-4 bg-white border border-slate-200 rounded-xl ${className ?? ""}`}
    >
      <h3 className="text-sm font-bold text-slate-900 mb-3">Completion Requirements</h3>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="mt-px shrink-0 text-success-600" />
            <span className="text-xs text-slate-600 leading-relaxed">{row.label}</span>
          </li>
        ))}
        {!path.mandatory && (
          <li className="flex items-start gap-2.5">
            <Circle size={15} className="mt-px shrink-0 text-slate-300" />
            <span className="text-xs text-slate-500 leading-relaxed">
              This path is optional — it never holds anybody's record open.
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

function CertificatePanel({ path, className }) {
  const awards = path.requiresCertificate;

  return (
    <section
      className={`flex items-start gap-3 p-4 rounded-xl border ${
        awards ? "bg-primary-50/60 border-primary-100" : "bg-slate-50 border-slate-200"
      } ${className ?? ""}`}
    >
      <Trophy
        size={20}
        strokeWidth={1.5}
        className={`mt-0.5 shrink-0 ${awards ? "text-warning-500" : "text-slate-300"}`}
      />
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900">Certificate</h3>
        <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
          {awards ? (
            <>
              Issued automatically once every mandatory lesson is complete
              {path.certificateValidityMonths
                ? `, valid for ${path.certificateValidityMonths} months.`
                : ", and it does not expire."}
            </>
          ) : (
            "This path does not award a certificate."
          )}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The path's configuration, read-only.
 *
 * Editing lives in the builder. A second form here would be a second place that
 * can put the due-date fields into an inconsistent state, and `updatePath`
 * re-validates the MERGED row precisely because that is easy to do.
 */
function Settings({ path }) {
  const rows = [
    { label: "Status", value: PATH_STATUS_META[path.status]?.label ?? path.status },
    { label: "Mandatory", value: path.mandatory ? "Yes" : "No" },
    { label: "Course order", value: path.sequential ? "Must be taken in order" : "Any order" },
    { label: "Due date", value: DUE_DATE_MODE_LABELS[path.dueDateMode] ?? path.dueDateMode },
    path.dueDateMode === "fixed" && { label: "Due on", value: formatDay(path.dueDate) },
    (path.dueDateMode === "joining_plus_days" || path.dueDateMode === "assigned_plus_days") && {
      label: "Days allowed",
      value: `${path.dueDays} days`,
    },
    { label: "Certificate", value: path.requiresCertificate ? "Awarded" : "None" },
    path.requiresCertificate && {
      label: "Certificate validity",
      value: path.certificateValidityMonths
        ? `${path.certificateValidityMonths} months`
        : "Does not expire",
    },
  ].filter(Boolean);

  const audience = path.audience ?? {};
  const audienceRows = [
    audience.departmentIds?.length && `${audience.departmentIds.length} department(s)`,
    audience.locationIds?.length && `${audience.locationIds.length} location(s)`,
    audience.designations?.length && audience.designations.join(", "),
    audience.employmentTypes?.length && audience.employmentTypes.join(", "),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <section className="p-4 bg-white border border-slate-200 rounded-xl">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Configuration</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {row.label}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-700">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="p-4 bg-white border border-slate-200 rounded-xl">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Audience</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          {audienceRows.length === 0 ? (
            <>
              Every employee. Rules that reference this path will match anybody, so narrow it on the
              rule instead if that is not what you want.
            </>
          ) : (
            audienceRows.join(" · ")
          )}
        </p>

        {(path.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {path.tags.map((tag) => (
              <Badge key={tag} variant="primary" className="text-[10px] px-2 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** Who has this path, and how far through it they are. */
function Assignments({ path }) {
  const [rows, setRows] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    assignmentsApi
      .list({ pathId: path.id, pageSize: 25 })
      .then((res) => {
        if (!cancelled) setRows(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [path.id]);

  if (error) return <ErrorState description={error.message} />;

  if (rows === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <LoadingSpinner size={26} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="w-9 h-9 text-slate-400 stroke-[1.5]" />}
        title="Nobody has this path yet"
        description="Assign it from the Assignments tab, or let a rule assign it automatically when somebody joins."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-slate-500">
        Showing the first {rows.length} of {path.assignedCount ?? rows.length}.{" "}
        <Link
          to={`${HRMS_ROUTE_PREFIX}/academy/assignments`}
          className="font-bold text-primary-700 hover:underline"
        >
          See all in Assignments
        </Link>
      </p>

      <ul className="flex flex-col divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 p-3">
            <Initial name={row.employeeName} size={30} />

            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold text-slate-900 truncate">
                {row.employeeName}
              </span>
              <span className="flex items-center gap-2 mt-1">
                <PercentBar percent={row.percent} size="sm" className="max-w-[120px]" />
                <span className="text-[11px] font-bold text-slate-600 tabular-nums">
                  {row.percent}%
                </span>
              </span>
            </span>

            <AcademyStatusBadge
              status={row.status}
              dueState={row.dueState}
              className="shrink-0 text-[10px]"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PathDetailDrawer;
