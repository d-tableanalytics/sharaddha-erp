import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Search,
  Library,
  CircleCheck,
  FileEdit,
  Archive,
  Layers,
  BookOpen,
  ClipboardList,
  Users,
  Settings2,
  MoreVertical,
} from "lucide-react";

import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/hrms/ErrorState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Pagination } from "../../../components/ui/Pagination";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Textarea } from "../../../components/ui/Textarea";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { DUE_DATE_MODE_LABELS } from "@shared/constants/academy.js";
import { pathsApi, formatDay } from "../../../services/hrms/academy";
import { departmentsApi } from "../../../services/hrms/org";
import { StatCard } from "./academyShared";
import { CoverTile } from "./academyVisuals";
import { PATH_STATUS_META } from "./pathStatus";
import { PathDetailDrawer, PathTags } from "./PathDetailDrawer";

/**
 * Server-paged, so the page size is a constant here rather than `usePagination`
 * — that hook slices a list already held in memory, which is the opposite of
 * what AD-13 asks a list screen to do.
 */
const PAGE_SIZE = 12;

const SORTS = [
  { value: "updated", label: "Updated (Newest)" },
  { value: "created", label: "Created (Newest)" },
  { value: "name", label: "Name (A–Z)" },
  { value: "assigned", label: "Most assigned" },
];

/**
 * The learning path catalogue.
 *
 * ---------------------------------------------------------------------------
 * CARDS, NOT A TABLE
 * ---------------------------------------------------------------------------
 * This screen was a data table, and a data table is the wrong instrument for
 * it. The other admin tabs list RECORDS — assignments, content items, rules —
 * where the job is scanning one column across many rows. A learning path is a
 * composed thing somebody authored, and the question asked of this screen is
 * "what is in it and who has it", which is four numbers and a description read
 * together, per path, not down a column.
 *
 * It stays server-paged, server-filtered and server-sorted; only the
 * presentation changed. A catalogue is small enough to browse and large enough
 * that loading all of it would still be a mistake.
 *
 * Clicking a card opens a DRAWER rather than navigating: inspecting six paths
 * to decide which to assign should not cost twelve page loads. The builder is
 * still a full page, reached from inside the drawer.
 */
export function CatalogueTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    status: null,
    departmentId: "",
    tag: "",
    sort: "updated",
  });
  const [data, setData] = useState({ data: [], total: 0, summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openPathId, setOpenPathId] = useState(null);
  const [departments, setDepartments] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await pathsApi.list({
          page,
          pageSize: PAGE_SIZE,
          search: filters.search || undefined,
          status: filters.status ?? undefined,
          departmentId: filters.departmentId || undefined,
          tag: filters.tag || undefined,
          sort: filters.sort,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The department list, for the filter.
   *
   * Loaded once and tolerant of failure — somebody without the org grant can
   * still use every other control on this screen, and a dead dropdown is a
   * better outcome than a dead page.
   */
  useEffect(() => {
    let cancelled = false;
    departmentsApi
      .list({ pageSize: 200 })
      .then((res) => {
        // Not paginated - `departmentsApi.list` resolves to the array itself.
        if (!cancelled) setDepartments(Array.isArray(res) ? res : (res?.data ?? []));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  /** Every tag in view, so the filter offers what is actually there. */
  const tagOptions = useMemo(() => {
    const seen = new Set();
    for (const row of data.data) for (const tag of row.tags ?? []) seen.add(tag);
    if (filters.tag) seen.add(filters.tag);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [data.data, filters.tag]);

  const summary = data.summary ?? { total: 0, active: 0, draft: 0, archived: 0 };
  const filtered = Boolean(
    filters.search || filters.status || filters.departmentId || filters.tag,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Heading ------------------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Learning Paths</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Create structured learning journeys with courses, lessons and assessments.
          </p>
        </div>

        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={15} className="mr-1.5" />
          Create Learning Path
        </Button>
      </div>

      {/* ---- Tiles --------------------------------------------------------
          Each one is a FILTER. A tile that reports a number and does nothing
          leaves the reader to build the filter that finds those rows by hand,
          which is the whole distance between a readout and a control. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="Total Learning Paths"
          value={summary.total}
          icon={Library}
          onClick={() => set("status", null)}
          active={filters.status === null}
        />
        <StatCard
          label="Active"
          value={summary.active}
          tone="success"
          icon={CircleCheck}
          onClick={() => set("status", filters.status === "active" ? null : "active")}
          active={filters.status === "active"}
        />
        <StatCard
          label="Drafts"
          value={summary.draft}
          tone="warning"
          icon={FileEdit}
          onClick={() => set("status", filters.status === "draft" ? null : "draft")}
          active={filters.status === "draft"}
        />
        <StatCard
          label="Archived"
          value={summary.archived}
          tone="danger"
          icon={Archive}
          onClick={() => set("status", filters.status === "archived" ? null : "archived")}
          active={filters.status === "archived"}
        />
      </div>

      {/* ---- Filters ------------------------------------------------------
          ONE ROW.

          `Input` and `Select` each wrap themselves in a `w-full` div — right
          for a form, wrong for a toolbar: as flex items every one of them
          claimed the whole line and the bar became a five-line stack. Sizing
          the WRAPPER here and letting the control fill it leaves the shared
          components untouched, so every other form in the portal is unaffected.

          It still wraps on a narrow screen, where five controls on one line
          would each be too narrow to read. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-slate-400 pointer-events-none"
          />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Search learning paths…"
            aria-label="Search learning paths"
            className="pl-9"
          />
        </div>

        <div className="w-[140px] shrink-0">
          <Select
            aria-label="Filter by status"
            value={filters.status ?? ""}
            onChange={(e) => set("status", e.target.value || null)}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </Select>
        </div>

        <div className="w-[170px] shrink-0">
          <Select
            aria-label="Filter by department"
            value={filters.departmentId}
            onChange={(e) => set("departmentId", e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[140px] shrink-0">
          <Select
            aria-label="Filter by tag"
            value={filters.tag}
            onChange={(e) => set("tag", e.target.value)}
            disabled={tagOptions.length === 0}
          >
            <option value="">All Tags</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[210px] shrink-0">
          <Select
            aria-label="Sort by"
            value={filters.sort}
            onChange={(e) => set("sort", e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort by: {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* ---- Grid --------------------------------------------------------- */}
      {error ? (
        <ErrorState description={error.message} onRetry={load} />
      ) : loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <LoadingSpinner size={30} />
        </div>
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={<Library className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
          title={filtered ? "No learning paths match those filters" : "No learning paths yet"}
          description={
            filtered
              ? "Clear the filters to see the whole catalogue."
              : "Create a learning path, add courses and lessons to it, then assign it — manually or with a rule."
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {data.data.map((path) => (
              <PathCard key={path.id} path={path} onOpen={() => setOpenPathId(path.id)} />
            ))}
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={data.total}
            onPageChange={setPage}
          />
        </>
      )}

      <PathDetailDrawer pathId={openPathId} onClose={() => setOpenPathId(null)} />

      {creating && (
        <CreatePathModal
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            load();
            // Straight into the new path: it is empty, and the next thing
            // anybody does with it is add a course.
            if (created?.id) setOpenPathId(created.id);
          }}
        />
      )}
    </div>
  );
}

/**
 * One learning path in the catalogue.
 *
 * The whole card opens the drawer, so there is no hunting for a link. The
 * builder gets its own control because it is a different destination, and it
 * carries `data-no-row-click` reasoning in the explicit `stopPropagation` —
 * without it, pressing "Build" would open the drawer as well as navigating.
 */
function PathCard({ path, onOpen }) {
  const status = PATH_STATUS_META[path.status] ?? PATH_STATUS_META.active;

  return (
    <article className="group flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden transition-all hover:border-primary-300 hover:shadow-md">
      <button
        type="button"
        onClick={onOpen}
        /*
          A FIXED height, not an aspect ratio.

          `aspect-[16/7]` collapsed to the height of its own icon here. The card
          is a column flex container, and a column flex item resolves its height
          from its CONTENT before the ratio is applied — so the ratio never got
          a chance to set one, and every cover rendered as a 40px strip.

          A fixed height also makes every card in a row terminate at the same
          place, which a ratio cannot promise once the columns differ in width.
        */
        className="relative block h-28 shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
        aria-label={`Open ${path.name}`}
      >
        {/*
          No "Mandatory" ribbon over the cover.

          The reference draws one on its first card and the same word again in
          the chip row below it. Saying it twice on one card is not emphasis, it
          is clutter — and the chip row is the better place for it, because
          there it sits beside the tags and the audience and reads as one
          description of who this path is for.
        */}
        <CoverTile name={path.name} kind="path" />
      </button>

      <div className="flex-1 flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 leading-snug min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="text-left hover:text-primary-700 focus:outline-none focus-visible:underline"
            >
              {path.name}
            </button>
          </h3>

          <Link
            to={`${HRMS_ROUTE_PREFIX}/academy/paths/${path.id}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open the builder for ${path.name}`}
            className="shrink-0 p-1 -m-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <MoreVertical size={15} />
          </Link>
        </div>

        {path.description && (
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{path.description}</p>
        )}

        <PathTags path={path} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Layers size={12} className="text-slate-400" />
            {path.courseCount ?? 0} {path.courseCount === 1 ? "Course" : "Courses"}
          </span>
          <span className="inline-flex items-center gap-1">
            <BookOpen size={12} className="text-slate-400" />
            {path.lessonCount ?? 0} {path.lessonCount === 1 ? "Lesson" : "Lessons"}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClipboardList size={12} className="text-slate-400" />
            {path.assessmentCount ?? 0}{" "}
            {path.assessmentCount === 1 ? "Assessment" : "Assessments"}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {/*
            The reference stacks three avatars here. There is no cheap way to
            name three of 128 assignees, and three arbitrary initials out of 128
            tell a reader nothing the number does not — so the COUNT carries it.
          */}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Users size={13} className="text-slate-400" />
            {(path.assignedCount ?? 0).toLocaleString("en-IN")} assigned
          </span>

          <Link
            to={`${HRMS_ROUTE_PREFIX}/academy/paths/${path.id}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-700 hover:underline"
          >
            <Settings2 size={12} />
            Build
          </Link>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/60 border-t border-slate-100">
        <span className="text-[11px] text-slate-400">
          Updated {path.updatedAt ? formatDay(path.updatedAt.slice(0, 10)) : "—"}
        </span>
        <Badge variant={status.tone} title={status.hint}>
          {status.label}
        </Badge>
      </footer>
    </article>
  );
}

/**
 * Create a learning path.
 *
 * The due-date section is the part worth designing carefully: choosing "days
 * after joining" and leaving the number blank is the mistake people make, and
 * the field appears conditionally so the pairing is obvious rather than
 * enforced only by a server error.
 */
function CreatePathModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    tags: "",
    dueDateMode: "none",
    dueDays: 15,
    dueDate: "",
    mandatory: true,
    sequential: false,
    requiresCertificate: false,
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const needsDays =
    form.dueDateMode === "joining_plus_days" || form.dueDateMode === "assigned_plus_days";

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const created = await pathsApi.create({
        name: form.name.trim(),
        description: form.description.trim() || null,
        /**
         * Comma-separated in the field, an array on the wire.
         *
         * Trimmed and de-duplicated here rather than server-side: "Sales, sales"
         * is one tag a person typed twice, and letting both through would put
         * two chips on the card and two entries in the filter.
         */
        tags: [
          ...new Set(
            form.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
        dueDateMode: form.dueDateMode,
        dueDays: needsDays ? Number(form.dueDays) : null,
        dueDate: form.dueDateMode === "fixed" ? form.dueDate : null,
        mandatory: form.mandatory,
        sequential: form.sequential,
        requiresCertificate: form.requiresCertificate,
        active: form.active,
      });
      onCreated(created);
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New learning path" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Name"
          required
          maxLength={160}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="IT — New Employee Onboarding"
        />

        <Textarea
          label="Description"
          rows={2}
          maxLength={2000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this path covers, and who it is for."
        />

        <Input
          label="Tags"
          maxLength={400}
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          placeholder="Onboarding, Compliance"
          helperText="Comma-separated. How people find this path in the catalogue when they cannot remember its title."
        />

        <fieldset className="flex flex-col gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
          <legend className="px-1.5 text-xs font-semibold text-slate-700">Due date</legend>

          <Select value={form.dueDateMode} onChange={(e) => set("dueDateMode", e.target.value)}>
            {Object.entries(DUE_DATE_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          {needsDays && (
            <Input
              label="Days"
              type="number"
              min={1}
              max={730}
              required
              value={form.dueDays}
              onChange={(e) => set("dueDays", e.target.value)}
              helperText={
                form.dueDateMode === "joining_plus_days"
                  ? "Counted from each employee's joining date, so the deadline differs per person."
                  : "Counted from the day the path is assigned — the right choice for a refresher assigned to existing staff."
              }
            />
          )}

          {form.dueDateMode === "fixed" && (
            <Input
              label="Due on"
              type="date"
              required
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              helperText="The same calendar date for everybody."
            />
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-xs font-semibold text-slate-700 mb-1">Behaviour</legend>

          <Toggle
            checked={form.mandatory}
            onChange={(v) => set("mandatory", v)}
            label="Mandatory"
            hint="Optional paths never hold anybody's record open."
          />
          <Toggle
            checked={form.sequential}
            onChange={(v) => set("sequential", v)}
            label="Complete courses in order"
            hint="Each course stays locked until the mandatory ones before it are done."
          />
          <Toggle
            checked={form.requiresCertificate}
            onChange={(v) => set("requiresCertificate", v)}
            label="Award a certificate on completion"
            hint="Generated automatically once every mandatory lesson is complete."
          />
          <Toggle
            checked={form.active}
            onChange={(v) => set("active", v)}
            label="Active"
            hint="An inactive path cannot be assigned."
          />
        </fieldset>

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
            Create path
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A labelled checkbox with a hint. Used by several Academy forms. */
export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-slate-800">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

export default CatalogueTab;
