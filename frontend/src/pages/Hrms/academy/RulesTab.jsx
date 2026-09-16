import { useCallback, useEffect, useState } from "react";
import { Plus, Play, Trash2, Users, X } from "lucide-react";

import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { SearchableSelect } from "../../../components/hrms/SearchableSelect";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog";
import { departmentsApi, locationsApi } from "../../../services/hrms/org";
import { rulesApi, pathsApi, formatInstant } from "../../../services/hrms/academy";
import { EMPLOYMENT_TYPES } from "@shared/constants/hrms.js";
import { RULE_TRIGGER_LABELS } from "@shared/constants/academy.js";
import { Toggle } from "./CatalogueTab";

const PAGE_SIZE = 25;

const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
};

/**
 * Automatic assignment rules.
 *
 * "IF department = IT AND designation = Software Developer AND employment type
 * = full time, THEN assign IT — New Employee Onboarding."
 *
 * The screen's job is to make the AND/OR reading unambiguous, because that is
 * where a rule engine misleads people: within one criterion the match is OR
 * (any of these departments), across criteria it is AND. The form says so in
 * words under each field rather than relying on the reader to infer it.
 */
export function RulesTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0 });
  const [paths, setPaths] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [running, setRunning] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await rulesApi.list({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      pathsApi.list({ pageSize: 200, active: true }).then((r) => r.data ?? []),
      departmentsApi.list().catch(() => []),
      locationsApi.list().catch(() => []),
    ])
      .then(([p, d, l]) => {
        setPaths(p);
        setDepartments(Array.isArray(d) ? d : (d?.data ?? []));
        setLocations(Array.isArray(l) ? l : (l?.data ?? []));
      })
      .catch(() => {});
  }, []);

  const run = useCallback(
    async (rule) => {
      setRunning(rule.id);
      setNotice(null);
      try {
        const result = await rulesApi.run(rule.id);
        setNotice(
          `"${rule.name}": ${result.assigned} assigned of ${result.matched} matching employees` +
            (result.hasMore
              ? `. ${result.totalMatching} match in total — run it again to continue.`
              : "."),
        );
        load();
      } catch (err) {
        setNotice(err.message);
      } finally {
        setRunning(null);
      }
    },
    [load],
  );

  const remove = useCallback(async () => {
    if (!deleting) return;
    try {
      await rulesApi.remove(deleting.id);
      setDeleting(null);
      load();
    } catch (err) {
      setNotice(err.message);
      setDeleting(null);
    }
  }, [deleting, load]);

  const columns = [
    {
      header: "Rule",
      accessorKey: "name",
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">
            {RULE_TRIGGER_LABELS[row.trigger] ?? row.trigger}
          </p>
        </div>
      ),
    },
    {
      header: "Matches",
      cell: (row) => <CriteriaSummary rule={row} departments={departments} locations={locations} />,
    },
    {
      header: "Assigns",
      cell: (row) => <span className="text-sm text-slate-700">{row.pathName}</span>,
    },
    {
      header: "Assigned",
      cell: (row) => (
        <div className="text-xs">
          <p className="font-semibold text-slate-700 tabular-nums">{row.totalAssignedCount}</p>
          {row.lastRunAt && (
            <p className="text-slate-400">last {formatInstant(row.lastRunAt)}</p>
          )}
        </div>
      ),
      className: "text-center",
    },
    {
      header: "Status",
      cell: (row) =>
        row.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Off</Badge>,
    },
    {
      header: "",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1" data-no-row-click>
          <Button
            size="xs"
            variant="ghost"
            loading={running === row.id}
            onClick={() => run(row)}
            title="Assign this path to everybody who matches, right now"
          >
            <Play size={13} className="mr-1" />
            Run
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(row)}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDeleting(row)}
            aria-label={`Delete ${row.name}`}
          >
            <Trash2 size={13} className="text-error-500" />
          </Button>
        </div>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-500 leading-relaxed">
          When a new employee is created, every active rule that matches them assigns its learning
          path — so somebody can owe both a company orientation and a department induction. Use
          <span className="font-semibold text-slate-600"> Run</span> to apply a rule to the existing
          workforce.
        </p>
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus size={15} className="mr-1.5" />
          New rule
        </Button>
      </div>

      {notice && (
        <div
          role="status"
          className="p-3 rounded-lg bg-primary-50 border border-primary-200 text-xs text-primary-800"
        >
          {notice}
        </div>
      )}

      <HrmsDataTable
        columns={columns}
        rows={data.data}
        loading={loading}
        error={error}
        onRetry={load}
        page={page}
        pageSize={PAGE_SIZE}
        total={data.total}
        onPageChange={setPage}
        emptyTitle="No assignment rules yet"
        emptyDescription="A rule assigns a learning path automatically when a new employee matches it — by department, location, designation or employment type."
      />

      {editing && (
        <RuleModal
          rule={editing.id ? editing : null}
          paths={paths}
          departments={departments}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this rule?"
        description={
          deleting
            ? `"${deleting.name}" will stop assigning "${deleting.pathName}" to new employees. The ${deleting.totalAssignedCount} assignment(s) it has already created are left untouched — people part-way through keep their training.`
            : ""
        }
        confirmText="Delete rule"
        variant="danger"
      />
    </div>
  );
}

/** The criteria, in a sentence, so the table row is readable without opening it. */
function CriteriaSummary({ rule, departments, locations }) {
  if (rule.matchAll) {
    return (
      <Badge variant="primary">
        <Users size={11} className="mr-1" />
        Every new employee
      </Badge>
    );
  }

  const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;
  const parts = [];

  if (rule.criteria.departmentIds.length > 0) {
    parts.push(rule.criteria.departmentIds.map((id) => nameOf(departments, id)).join(" or "));
  }
  if (rule.criteria.locationIds.length > 0) {
    parts.push(rule.criteria.locationIds.map((id) => nameOf(locations, id)).join(" or "));
  }
  if (rule.criteria.designations.length > 0) {
    parts.push(rule.criteria.designations.join(" or "));
  }
  if (rule.criteria.employmentTypes.length > 0) {
    parts.push(
      rule.criteria.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t] ?? t).join(" or "),
    );
  }

  return (
    <span className="text-xs text-slate-600 leading-relaxed">
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 && <span className="text-slate-400 font-semibold"> and </span>}
          {part}
        </span>
      ))}
    </span>
  );
}

/** Create or edit a rule, with a live preview of how many people it matches. */
function RuleModal({ rule, paths, departments, locations, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: rule?.name ?? "",
    pathId: rule?.pathId ?? null,
    matchAll: rule?.matchAll ?? false,
    departmentIds: rule?.criteria?.departmentIds ?? [],
    locationIds: rule?.criteria?.locationIds ?? [],
    designations: rule?.criteria?.designations ?? [],
    employmentTypes: rule?.criteria?.employmentTypes ?? [],
    trigger: rule?.trigger ?? "on_create",
    active: rule?.active ?? true,
  }));
  const [designationDraft, setDesignationDraft] = useState("");
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const push = (key, value) => {
    if (!value) return;
    setForm((f) => (f[key].includes(value) ? f : { ...f, [key]: [...f[key], value] }));
  };
  const drop = (key, value) =>
    setForm((f) => ({ ...f, [key]: f[key].filter((x) => x !== value) }));

  /** Existing rules can be previewed; a brand-new one has no id to preview yet. */
  useEffect(() => {
    if (!rule?.id) return;
    rulesApi
      .preview(rule.id)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [rule]);

  const anyCriteria =
    form.departmentIds.length > 0 ||
    form.locationIds.length > 0 ||
    form.designations.length > 0 ||
    form.employmentTypes.length > 0;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const payload = {
        name: form.name.trim(),
        pathId: form.pathId,
        matchAll: form.matchAll,
        criteria: form.matchAll
          ? { departmentIds: [], locationIds: [], designations: [], employmentTypes: [] }
          : {
              departmentIds: form.departmentIds,
              locationIds: form.locationIds,
              designations: form.designations,
              employmentTypes: form.employmentTypes,
            },
        trigger: form.trigger,
        active: form.active,
      };
      if (rule?.id) await rulesApi.update(rule.id, payload);
      else await rulesApi.create(payload);
      onSaved();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={rule ? "Edit rule" : "New assignment rule"} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Rule name"
          required
          maxLength={160}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="IT developers — onboarding"
        />

        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">Assign this path</label>
          <SearchableSelect
            value={form.pathId}
            onChange={(v) => set("pathId", v)}
            options={paths.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Choose a learning path…"
          />
        </div>

        <fieldset className="flex flex-col gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
          <legend className="px-1.5 text-xs font-semibold text-slate-700">When it applies</legend>

          <Toggle
            checked={form.matchAll}
            onChange={(v) => set("matchAll", v)}
            label="Every new employee"
            hint="Company-wide. Has to be chosen deliberately — a rule cannot become company-wide by leaving the criteria empty."
          />

          {!form.matchAll && (
            <>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Within a field the match is <span className="font-semibold">any of</span>; across
                fields it is <span className="font-semibold">all of</span>. Leave a field empty to
                ignore it.
              </p>

              <ChipField
                label="Department"
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
                selected={form.departmentIds}
                labelFor={(id) => departments.find((d) => d.id === id)?.name ?? id}
                onAdd={(v) => push("departmentIds", v)}
                onRemove={(v) => drop("departmentIds", v)}
              />

              <ChipField
                label="Location"
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
                selected={form.locationIds}
                labelFor={(id) => locations.find((l) => l.id === id)?.name ?? id}
                onAdd={(v) => push("locationIds", v)}
                onRemove={(v) => drop("locationIds", v)}
              />

              <ChipField
                label="Employment type"
                options={EMPLOYMENT_TYPES.map((t) => ({
                  value: t,
                  label: EMPLOYMENT_TYPE_LABELS[t] ?? t,
                }))}
                selected={form.employmentTypes}
                labelFor={(t) => EMPLOYMENT_TYPE_LABELS[t] ?? t}
                onAdd={(v) => push("employmentTypes", v)}
                onRemove={(v) => drop("employmentTypes", v)}
              />

              {/*
                Designation is free text on the employee record rather than a
                catalogue, so it is typed rather than picked. Matched
                case-insensitively and trimmed on the server, so "Software
                Developer" and "software developer " are the same job.
              */}
              <div className="w-full flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Designation</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={designationDraft}
                    onChange={(e) => setDesignationDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      push("designations", designationDraft.trim());
                      setDesignationDraft("");
                    }}
                    placeholder="Software Developer"
                    className="flex-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      push("designations", designationDraft.trim());
                      setDesignationDraft("");
                    }}
                  >
                    Add
                  </Button>
                </div>
                <Chips
                  values={form.designations}
                  labelFor={(d) => d}
                  onRemove={(v) => drop("designations", v)}
                />
                <span className="text-[11px] text-slate-500">
                  Matched exactly, ignoring case and surrounding spaces.
                </span>
              </div>
            </>
          )}
        </fieldset>

        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">Trigger</label>
          <select
            value={form.trigger}
            onChange={(e) => set("trigger", e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            {Object.entries(RULE_TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500">
            "Only when run manually" is how an existing workforce is backfilled onto a new
            compliance path without the rule also firing on every future hire.
          </span>
        </div>

        <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Active" />

        {preview && (
          <p className="text-xs text-slate-600 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
            As saved, this rule matches{" "}
            <span className="font-bold">{preview.matches} employee(s)</span>
            {preview.sample.length > 0 && (
              <>
                {" "}
                — for example {preview.sample.slice(0, 3).map((s) => s.name).join(", ")}
              </>
            )}
            .
          </p>
        )}

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
            disabled={!form.name.trim() || !form.pathId || (!form.matchAll && !anyCriteria)}
          >
            {rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A select that adds to a chip list. Used by three of the four criteria. */
function ChipField({ label, options, selected, labelFor, onAdd, onRemove }) {
  return (
    <div className="w-full flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-700">{label}</label>
      <SearchableSelect
        value={null}
        onChange={onAdd}
        options={options.filter((o) => !selected.includes(o.value))}
        placeholder={`Any ${label.toLowerCase()}`}
      />
      <Chips values={selected} labelFor={labelFor} onRemove={onRemove} />
    </div>
  );
}

function Chips({ values, labelFor, onRemove }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onRemove(value)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition-colors"
        >
          {labelFor(value)}
          <X size={11} />
        </button>
      ))}
    </div>
  );
}

export default RulesTab;
