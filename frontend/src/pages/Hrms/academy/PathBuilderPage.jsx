import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  Film,
  FileText,
  ClipboardList,
} from "lucide-react";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { SearchableSelect } from "../../../components/hrms/SearchableSelect";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Textarea } from "../../../components/ui/Textarea";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { DEFAULT_VIDEO_COMPLETION_PERCENT } from "@shared/constants/academy.js";
import {
  pathsApi,
  coursesApi,
  contentApi,
  academyAssessmentsApi,
  formatDuration,
} from "../../../services/hrms/academy";
import { Toggle } from "./CatalogueTab";

const LESSON_ICONS = { video: Film, pdf: FileText, document: FileText, quiz: ClipboardList };

/**
 * The course-and-lesson builder for one learning path.
 *
 * ---------------------------------------------------------------------------
 * REORDERING IS BUTTONS, NOT DRAG-AND-DROP
 * ---------------------------------------------------------------------------
 * Section 5 says to prefer drag-and-drop "if the existing project already
 * supports it". It does not — there is no drag library in the dependency list
 * and no HRMS screen that drags anything — so adding one would introduce a
 * dependency and an interaction pattern that exists nowhere else in the portal.
 *
 * Move-up/move-down is the existing pattern (the assessment question editor
 * beside this uses it), works on touch without a long-press, and is reachable
 * from a keyboard. Each press sends the COMPLETE new order in one request, so
 * the sequence cannot end up with duplicate positions.
 */
export function PathBuilderPage() {
  const { pathId } = useParams();
  const navigate = useNavigate();

  const [path, setPath] = useState(undefined);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [addingCourse, setAddingCourse] = useState(false);
  const [addingLessonTo, setAddingLessonTo] = useState(null);
  /** Which lesson type the "Add Content" panel launched, so the modal opens on it. */
  const [addingLessonType, setAddingLessonType] = useState("video");
  /** The course the "Add Content" panel targets. */
  const [targetCourseId, setTargetCourseId] = useState(null);
  const [deletingCourse, setDeletingCourse] = useState(null);
  const [deletingLesson, setDeletingLesson] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPath(await pathsApi.get(pathId));
    } catch (err) {
      setError(err);
    }
  }, [pathId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Move a course, then send the whole order. */
  const moveCourse = useCallback(
    async (index, delta) => {
      const ids = path.courses.map((c) => c.id);
      const target = index + delta;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];

      setBusy(true);
      setNotice(null);
      try {
        const result = await pathsApi.reorderCourses(pathId, ids);
        /**
         * A reorder can invalidate a prerequisite that was legal before —
         * dragging a course above its own prerequisite makes the dependency
         * point forwards. The server clears those and says which; saying so
         * here is the difference between a helpful system and a surprising one.
         */
        if (result.prerequisitesCleared?.length > 0) {
          setNotice(
            `Prerequisites cleared on ${result.prerequisitesCleared
              .map((c) => `"${c.name}"`)
              .join(", ")} — they pointed at a course that now comes later.`,
          );
        }
        await load();
      } catch (err) {
        setNotice(err.message);
      } finally {
        setBusy(false);
      }
    },
    [path, pathId, load],
  );

  const moveLesson = useCallback(
    async (course, index, delta) => {
      const ids = course.lessons.map((l) => l.id);
      const target = index + delta;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];

      setBusy(true);
      try {
        await coursesApi.reorderLessons(course.id, ids);
        await load();
      } catch (err) {
        setNotice(err.message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const removeCourse = useCallback(async () => {
    if (!deletingCourse) return;
    try {
      await coursesApi.remove(deletingCourse.id);
      setDeletingCourse(null);
      await load();
    } catch (err) {
      setNotice(err.message);
      setDeletingCourse(null);
    }
  }, [deletingCourse, load]);

  const removeLesson = useCallback(async () => {
    if (!deletingLesson) return;
    try {
      await coursesApi.removeLesson(deletingLesson.courseId, deletingLesson.lesson.id);
      setDeletingLesson(null);
      await load();
    } catch (err) {
      setNotice(err.message);
      setDeletingLesson(null);
    }
  }, [deletingLesson, load]);

  /**
   * The course the "Add Content" rail adds to.
   *
   * Defaults to the first course rather than requiring a choice, and falls back
   * to it if the selected one is deleted — a rail whose target has vanished
   * would otherwise silently do nothing when pressed.
   */
  const target =
    (path?.courses ?? []).find((c) => c.id === targetCourseId) ?? path?.courses?.[0] ?? null;

  return (
    <HrmsPageLayout
      title={path?.name ?? "Learning path"}
      subtitle={
        path
          ? `${path.courses.length} course${path.courses.length === 1 ? "" : "s"}${
              path.sequential ? " · completed in order" : ""
            }${path.assignedCount ? ` · ${path.assignedCount} assigned` : ""}`
          : undefined
      }
      breadcrumbs={[
        { label: "HRMS", to: `${HRMS_ROUTE_PREFIX}/dashboard` },
        { label: "SI Academy", to: `${HRMS_ROUTE_PREFIX}/academy/catalogue` },
        { label: path?.name ?? "Learning path" },
      ]}
      loading={path === undefined && !error}
      error={error}
      onRetry={load}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`${HRMS_ROUTE_PREFIX}/academy/catalogue`)}
          >
            <ArrowLeft size={14} className="mr-1.5" />
            All paths
          </Button>
          <Button size="sm" onClick={() => setAddingCourse(true)}>
            <Plus size={15} className="mr-1.5" />
            Add course
          </Button>
        </div>
      }
    >
      {path && (
        <div className="flex flex-col gap-4">
          {notice && (
            <div
              role="status"
              className="p-3 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-700"
            >
              {notice}
            </div>
          )}

          {path.assignedCount > 0 && (
            <p className="text-[11px] text-slate-500 leading-relaxed px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              {path.assignedCount} employee(s) are working through this path. Adding a lesson adds
              it to their assignment; making an existing lesson optional does not change what they
              were already told they owed, and removing something they still owe is refused.
            </p>
          )}

          {path.courses.length === 0 ? (
            <EmptyState
              title="No courses yet"
              description="Add a course, then add video, PDF and quiz lessons to it. A path with no lessons cannot be assigned."
            />
          ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] items-start">
            <div className="flex flex-col gap-4 min-w-0">
            {path.courses.map((course, ci) => (
              <section
                key={course.id}
                className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden"
              >
                <header className="flex flex-wrap items-start gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-slate-200 text-[11px] font-bold text-slate-600 tabular-nums shrink-0">
                    {ci + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">{course.name}</h2>
                      <Badge variant={course.mandatory ? "primary" : "neutral"}>
                        {course.mandatory ? "Mandatory" : "Optional"}
                      </Badge>
                      {!course.active && <Badge variant="warning">Archived</Badge>}
                      {course.prerequisiteCourseId && (
                        <Badge variant="neutral">
                          After{" "}
                          {path.courses.find((c) => c.id === course.prerequisiteCourseId)?.name ??
                            "…"}
                        </Badge>
                      )}
                    </div>
                    {course.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{course.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={ci === 0 || busy}
                      onClick={() => moveCourse(ci, -1)}
                      aria-label="Move course up"
                    >
                      <ChevronUp size={14} />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={ci === path.courses.length - 1 || busy}
                      onClick={() => moveCourse(ci, 1)}
                      aria-label="Move course down"
                    >
                      <ChevronDown size={14} />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setAddingLessonType("video");
                        setAddingLessonTo(course);
                      }}
                    >
                      <Plus size={13} className="mr-1" />
                      Lesson
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setDeletingCourse(course)}
                      aria-label={`Delete ${course.name}`}
                    >
                      <Trash2 size={13} className="text-error-500" />
                    </Button>
                  </div>
                </header>

                {course.lessons.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-slate-500">
                    No lessons yet. A course with no lessons counts as complete the moment it is
                    assigned.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {course.lessons.map((lesson, li) => {
                      const Icon = LESSON_ICONS[lesson.type] ?? FileText;
                      return (
                        <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5">
                          <Icon size={15} className="shrink-0 text-slate-400" />

                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 truncate">{lesson.title}</p>
                            <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                              <span>{lesson.type}</span>
                              {!lesson.mandatory && <span>Optional</span>}
                              {lesson.type === "video" && (
                                <>
                                  <span>{formatDuration(lesson.content?.durationSeconds)}</span>
                                  <span>complete at {lesson.videoCompletionPercent}%</span>
                                </>
                              )}
                              {lesson.contentMissing && (
                                <span className="text-warning-600 font-semibold">
                                  Content missing
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-0.5">
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={li === 0 || busy}
                              onClick={() => moveLesson(course, li, -1)}
                              aria-label="Move lesson up"
                            >
                              <ChevronUp size={13} />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={li === course.lessons.length - 1 || busy}
                              onClick={() => moveLesson(course, li, 1)}
                              aria-label="Move lesson down"
                            >
                              <ChevronDown size={13} />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setDeletingLesson({ courseId: course.id, lesson })}
                              aria-label={`Delete ${lesson.title}`}
                            >
                              <Trash2 size={12} className="text-slate-400" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
            </div>

            <AddContentRail
              courses={path.courses}
              targetCourseId={target?.id ?? null}
              onTargetChange={setTargetCourseId}
              onAdd={(type) => {
                if (!target) return;
                setAddingLessonType(type);
                setAddingLessonTo(target);
              }}
            />
          </div>
          )}
        </div>
      )}

      {addingCourse && path && (
        <CourseModal
          pathId={pathId}
          courses={path.courses}
          onClose={() => setAddingCourse(false)}
          onSaved={() => {
            setAddingCourse(false);
            load();
          }}
        />
      )}

      {addingLessonTo && (
        <LessonModal
          course={addingLessonTo}
          initialType={addingLessonType}
          onClose={() => setAddingLessonTo(null)}
          onSaved={(result) => {
            setAddingLessonTo(null);
            if (result?.assignmentsUpdated > 0) {
              setNotice(
                `Added to ${result.assignmentsUpdated} live assignment(s) — those learners now owe this lesson too.`,
              );
            }
            load();
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={Boolean(deletingCourse)}
        onClose={() => setDeletingCourse(null)}
        onConfirm={removeCourse}
        title="Delete this course?"
        description={
          deletingCourse
            ? `"${deletingCourse.name}" and its ${deletingCourse.lessons.length} lesson(s) will be removed. If anybody still has lessons from it outstanding the deletion is refused — deactivate the course instead.`
            : ""
        }
        confirmText="Delete course"
        variant="danger"
      />

      <ConfirmationDialog
        isOpen={Boolean(deletingLesson)}
        onClose={() => setDeletingLesson(null)}
        onConfirm={removeLesson}
        title="Delete this lesson?"
        description={
          deletingLesson
            ? `"${deletingLesson.lesson.title}" will be removed from the course. If anybody still owes it, the deletion is refused — make it optional instead.`
            : ""
        }
        confirmText="Delete lesson"
        variant="danger"
      />
    </HrmsPageLayout>
  );
}

/** Add a course to the path. */
/**
 * The "Add Content" rail.
 *
 * ---------------------------------------------------------------------------
 * A RAIL HAS TO KNOW WHAT IT IS ADDING TO
 * ---------------------------------------------------------------------------
 * The design reference draws it as a free-floating panel beside the course
 * list. That works in a mockup with one course and stops working with three —
 * "Add Video" has to mean adding it SOMEWHERE, and a panel that silently picks
 * a course for you is how a lesson ends up in the wrong module.
 *
 * So the rail names its target and lets it be changed. The buttons are
 * otherwise exactly the reference's: one per lesson type, each opening the
 * lesson modal already set to it, which is two fewer decisions than opening a
 * blank form and choosing the type inside it.
 *
 * There is no "Add Link". `LESSON_TYPES` is video, pdf, document and quiz —
 * this module has no link lesson, and a button that cannot produce one would be
 * a promise the builder never keeps.
 */
function AddContentRail({ courses, targetCourseId, onTargetChange, onAdd }) {
  const actions = [
    { type: "video", label: "Add Video", icon: Film },
    { type: "pdf", label: "Add PDF", icon: FileText },
    { type: "document", label: "Add Document", icon: FileText },
    { type: "quiz", label: "Add Assessment", icon: ClipboardList },
  ];

  return (
    <aside className="lg:sticky lg:top-4 bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[13px] font-bold text-slate-900">Add Content</h2>
      </header>

      <div className="p-3 flex flex-col gap-3">
        {courses.length > 1 && (
          <Select
            label="Add to course"
            value={targetCourseId ?? ""}
            onChange={(e) => onTargetChange(e.target.value)}
          >
            {courses.map((course, i) => (
              <option key={course.id} value={course.id}>
                {i + 1}. {course.name}
              </option>
            ))}
          </Select>
        )}

        <div className="flex flex-col gap-1.5">
          {actions.map(({ type, label, icon: Icon }) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={() => onAdd(type)}
            >
              <Icon size={14} className="mr-2 text-slate-400" />
              {label}
            </Button>
          ))}
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Videos, PDFs and documents come from the Content Library; assessments come from the
          Assessments tab. Upload or author it there first, then add it here.
        </p>
      </div>
    </aside>
  );
}

function CourseModal({ pathId, courses, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    estimatedMinutes: "",
    mandatory: true,
    prerequisiteCourseId: null,
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await coursesApi.create({
        pathId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
        mandatory: form.mandatory,
        prerequisiteCourseId: form.prerequisiteCourseId,
        active: form.active,
      });
      onSaved();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add a course" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Course name"
          required
          maxLength={160}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="IT Security Awareness"
        />

        <Textarea
          label="Description"
          rows={2}
          maxLength={2000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />

        <Input
          label="Estimated minutes"
          type="number"
          min={1}
          value={form.estimatedMinutes}
          onChange={(e) => set("estimatedMinutes", e.target.value)}
          placeholder="30"
        />

        {courses.length > 0 && (
          <div className="w-full flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700">Prerequisite (optional)</label>
            <SearchableSelect
              value={form.prerequisiteCourseId}
              onChange={(v) => set("prerequisiteCourseId", v)}
              options={courses.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="No prerequisite"
            />
            <span className="text-[11px] text-slate-500">
              This course stays locked until that one is complete — independent of whether the path
              is sequential. It must be a course that comes earlier in the order.
            </span>
          </div>
        )}

        <Toggle
          checked={form.mandatory}
          onChange={(v) => set("mandatory", v)}
          label="Mandatory"
          hint="Optional courses never hold the learning path open."
        />
        <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Active" />

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!form.name.trim()}>
            Add course
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Add a lesson to a course.
 *
 * The type decides which picker appears: a quiz takes an assessment, everything
 * else takes a content item of the matching type. Filtering the list by type
 * here mirrors the server's own check — it refuses a PDF content item in a
 * video lesson — so the mistake is not offered rather than merely rejected.
 */
function LessonModal({ course, initialType = "video", onClose, onSaved }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: initialType,
    contentId: null,
    assessmentId: null,
    mandatory: true,
    videoCompletionPercent: DEFAULT_VIDEO_COMPLETION_PERCENT,
  });
  const [content, setContent] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    Promise.all([
      contentApi.list({ pageSize: 200, active: true }).then((r) => r.data ?? []),
      academyAssessmentsApi.list({ pageSize: 200 }).then((r) => r.data ?? []),
    ])
      .then(([c, a]) => {
        setContent(c);
        setAssessments(a.filter((x) => x.active));
      })
      .catch(() => {});
  }, []);

  const isQuiz = form.type === "quiz";
  const eligible = content.filter((c) => c.type === form.type);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const result = await coursesApi.addLesson(course.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        contentId: isQuiz ? null : form.contentId,
        assessmentId: isQuiz ? form.assessmentId : null,
        mandatory: form.mandatory,
        videoCompletionPercent: Number(form.videoCompletionPercent),
      });
      onSaved(result);
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Add a lesson to ${course.name}`} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select
          label="Lesson type"
          value={form.type}
          onChange={(e) => {
            set("type", e.target.value);
            set("contentId", null);
            set("assessmentId", null);
          }}
        >
          <option value="video">Video</option>
          <option value="pdf">PDF</option>
          <option value="document">Document</option>
          <option value="quiz">Quiz</option>
        </Select>

        <Input
          label="Title"
          required
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Email Security"
        />

        {isQuiz ? (
          <div className="w-full flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700">Assessment</label>
            <SearchableSelect
              value={form.assessmentId}
              onChange={(v) => set("assessmentId", v)}
              options={assessments.map((a) => ({
                value: a.id,
                label: `${a.title} — ${a.questionCount} questions, pass ${a.passingPercent}%`,
              }))}
              placeholder="Choose an assessment…"
            />
            {assessments.length === 0 && (
              <span className="text-[11px] text-warning-600">
                No active assessments yet — create one on the Assessments tab first.
              </span>
            )}
          </div>
        ) : (
          <div className="w-full flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700">Content</label>
            <SearchableSelect
              value={form.contentId}
              onChange={(v) => set("contentId", v)}
              options={eligible.map((c) => ({
                value: c.id,
                label:
                  c.type === "video"
                    ? `${c.title} — ${formatDuration(c.durationSeconds)}`
                    : c.title,
              }))}
              placeholder={`Choose a ${form.type}…`}
            />
            {eligible.length === 0 && (
              <span className="text-[11px] text-warning-600">
                Nothing of this type in the library yet — upload it on the Content Library tab
                first.
              </span>
            )}
          </div>
        )}

        {form.type === "video" && (
          <Input
            label="Complete at (%)"
            type="number"
            min={50}
            max={100}
            value={form.videoCompletionPercent}
            onChange={(e) => set("videoCompletionPercent", e.target.value)}
            helperText="How much of the video must actually be watched. Measured on unique seconds watched, not on the playhead — skipping ahead does not count."
          />
        )}

        <Toggle
          checked={form.mandatory}
          onChange={(v) => set("mandatory", v)}
          label="Mandatory"
          hint="Optional lessons never hold the course or the path open."
        />

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={!form.title.trim() || (isQuiz ? !form.assessmentId : !form.contentId)}
          >
            Add lesson
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PathBuilderPage;
