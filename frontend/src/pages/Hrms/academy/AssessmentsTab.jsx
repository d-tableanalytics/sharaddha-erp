import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";

import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { academyAssessmentsApi } from "../../../services/hrms/academy";
import { SCORE_POLICY_LABELS } from "@shared/constants/academy.js";
import { Toggle } from "./CatalogueTab";

const PAGE_SIZE = 25;

/** A blank question, in the shape the schema expects. */
const emptyQuestion = () => ({
  text: "",
  type: "single",
  options: [
    { text: "", isCorrect: true },
    { text: "", isCorrect: false },
  ],
});

/**
 * Assessments.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONLY SCREEN THAT EVER SEES THE ANSWER KEY
 * ---------------------------------------------------------------------------
 * Every route behind it is gated on `academy:edit:org`. A learner reaches an
 * assessment only through the player, which calls a different endpoint that
 * returns the questions with `isCorrect` stripped — so this component and
 * `LessonPlayerPage` are looking at deliberately different shapes of the same
 * data.
 */
export function AssessmentsTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [failure, setFailure] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await academyAssessmentsApi.list({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = useCallback(async () => {
    if (!deleting) return;
    setFailure(null);
    try {
      await academyAssessmentsApi.remove(deleting.id);
      setDeleting(null);
      load();
    } catch (err) {
      const courses = err.details?.courses ?? [];
      setFailure(
        courses.length > 0
          ? `${err.message} Used by: ${courses.map((c) => c.name).join(", ")}.`
          : err.message,
      );
      setDeleting(null);
    }
  }, [deleting, load]);

  const columns = [
    {
      header: "Assessment",
      accessorKey: "title",
      cell: (row) => (
        <button
          type="button"
          onClick={() => setEditing({ id: row.id })}
          className="text-sm font-semibold text-slate-900 hover:text-primary-700 hover:underline text-left"
        >
          {row.title}
        </button>
      ),
    },
    {
      header: "Questions",
      cell: (row) => <span className="text-sm tabular-nums">{row.questionCount}</span>,
      className: "text-center",
    },
    {
      header: "Pass mark",
      cell: (row) => <span className="text-sm tabular-nums">{row.passingPercent}%</span>,
      className: "text-center",
    },
    {
      header: "Attempts",
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {row.maxAttempts == null ? "Unlimited" : row.maxAttempts}
        </span>
      ),
    },
    {
      header: "Scoring",
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {SCORE_POLICY_LABELS[row.scorePolicy] ?? row.scorePolicy}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (row) =>
        row.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Off</Badge>,
    },
    {
      header: "",
      cell: (row) => (
        <Button
          size="xs"
          variant="ghost"
          data-no-row-click
          onClick={() => setDeleting(row)}
          aria-label={`Delete ${row.title}`}
        >
          <Trash2 size={13} className="text-error-500" />
        </Button>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus size={15} className="mr-1.5" />
          New assessment
        </Button>
      </div>

      {failure && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-error-50 border border-error-200 text-xs text-error-700"
        >
          {failure}
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
        emptyTitle="No assessments yet"
        emptyDescription="Create an assessment, then add it to a course as a quiz lesson."
      />

      {editing && (
        <AssessmentModal
          assessmentId={editing.id ?? null}
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
        title="Delete this assessment?"
        description={
          deleting
            ? `"${deleting.title}" will be removed. If any course still uses it as a quiz lesson, the deletion is refused and nothing changes. Attempts people have already made are kept either way.`
            : ""
        }
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

/**
 * The question builder.
 *
 * Two rules are enforced here as well as on the server, because discovering
 * them after saving is worse than seeing them under the field: a question needs
 * a correct answer, and a single-answer question can only have one.
 *
 * Editing an assessment replaces its whole question set — which is why an
 * attempt stores its own `passingPercent` and question count rather than
 * recomputing from the live document. An attempt is a record of a sitting.
 */
function AssessmentModal({ assessmentId, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: "",
    description: "",
    passingPercent: 70,
    maxAttempts: "",
    scorePolicy: "highest",
    shuffleQuestions: false,
    active: true,
    questions: [emptyQuestion()],
  }));
  const [loading, setLoading] = useState(Boolean(assessmentId));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    if (!assessmentId) return;
    academyAssessmentsApi
      .get(assessmentId)
      .then((row) =>
        setForm({
          title: row.title,
          description: row.description ?? "",
          passingPercent: row.passingPercent,
          maxAttempts: row.maxAttempts ?? "",
          scorePolicy: row.scorePolicy,
          shuffleQuestions: row.shuffleQuestions,
          active: row.active,
          questions: row.questions.map((q) => ({
            text: q.text,
            type: q.type,
            options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
          })),
        }),
      )
      .catch((err) => setFailure(err.message))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const patchQuestion = (index, patch) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));

  const patchOption = (qi, oi, patch) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi
          ? {
              ...q,
              options: q.options.map((o, j) => {
                if (j !== oi) {
                  // Ticking a correct answer on a SINGLE-answer question clears
                  // the others, because two correct answers make it unmarkable
                  // and the server refuses it.
                  return q.type === "single" && patch.isCorrect
                    ? { ...o, isCorrect: false }
                    : o;
                }
                return { ...o, ...patch };
              }),
            }
          : q,
      ),
    }));

  const moveQuestion = (index, delta) =>
    setForm((f) => {
      const next = [...f.questions];
      const target = index + delta;
      if (target < 0 || target >= next.length) return f;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...f, questions: next };
    });

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        passingPercent: Number(form.passingPercent),
        maxAttempts: form.maxAttempts === "" ? null : Number(form.maxAttempts),
        scorePolicy: form.scorePolicy,
        shuffleQuestions: form.shuffleQuestions,
        active: form.active,
        questions: form.questions.map((q) => ({
          text: q.text.trim(),
          type: q.type,
          options: q.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })),
        })),
      };
      if (assessmentId) await academyAssessmentsApi.update(assessmentId, payload);
      else await academyAssessmentsApi.create(payload);
      onSaved();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setSaving(false);
    }
  };

  /** Per-question problems, shown under the question rather than at the top. */
  const problemFor = (q) => {
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (!q.text.trim()) return "This question needs some text.";
    if (q.options.some((o) => !o.text.trim())) return "Every option needs some text.";
    if (correct === 0) return "Mark the correct answer.";
    if (q.type === "single" && correct > 1) {
      return "A single-answer question can only have one correct option.";
    }
    return null;
  };

  const problems = form.questions.map(problemFor);
  const ready = form.title.trim() && form.questions.length > 0 && problems.every((p) => !p);

  if (loading) {
    return (
      <Modal isOpen onClose={onClose} title="Assessment" size="xl">
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size={28} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={saving ? () => {} : onClose}
      title={assessmentId ? "Edit assessment" : "New assessment"}
      size="xl"
    >
      <form onSubmit={submit} className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Title"
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Security Assessment"
            className="sm:col-span-2"
          />

          <Input
            label="Pass mark (%)"
            type="number"
            min={1}
            max={100}
            required
            value={form.passingPercent}
            onChange={(e) => set("passingPercent", e.target.value)}
          />

          <Input
            label="Attempts allowed"
            type="number"
            min={1}
            max={20}
            value={form.maxAttempts}
            onChange={(e) => set("maxAttempts", e.target.value)}
            placeholder="Unlimited"
            helperText="Leave blank for unlimited retries."
          />

          <div className="w-full flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700">Which attempt counts</label>
            <select
              value={form.scorePolicy}
              onChange={(e) => set("scorePolicy", e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              {Object.entries(SCORE_POLICY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-end gap-2">
            <Toggle
              checked={form.shuffleQuestions}
              onChange={(v) => set("shuffleQuestions", v)}
              label="Shuffle questions"
            />
            <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Active" />
          </div>
        </div>

        {/* ---- Questions --------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Questions{" "}
              <span className="font-normal text-slate-400">({form.questions.length})</span>
            </h3>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => set("questions", [...form.questions, emptyQuestion()])}
            >
              <Plus size={13} className="mr-1" />
              Add question
            </Button>
          </div>

          {form.questions.map((question, qi) => (
            <fieldset
              key={qi}
              className="flex flex-col gap-2.5 p-3.5 rounded-lg border border-slate-200 bg-slate-50/50"
            >
              <div className="flex items-start gap-2">
                <GripVertical size={14} className="mt-2.5 shrink-0 text-slate-300" />

                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <input
                    type="text"
                    value={question.text}
                    maxLength={1000}
                    onChange={(e) => patchQuestion(qi, { text: e.target.value })}
                    placeholder={`Question ${qi + 1}`}
                    className="w-full px-3 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg shadow-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />

                  <div className="flex items-center gap-2">
                    <select
                      value={question.type}
                      onChange={(e) => {
                        const type = e.target.value;
                        // Switching to single-answer with several ticked would
                        // be unmarkable, so keep only the first.
                        const options =
                          type === "single"
                            ? question.options.map((o, i) => ({
                                ...o,
                                isCorrect:
                                  o.isCorrect &&
                                  i === question.options.findIndex((x) => x.isCorrect),
                              }))
                            : question.options;
                        patchQuestion(qi, { type, options });
                      }}
                      className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-primary-500"
                    >
                      <option value="single">One correct answer</option>
                      <option value="multiple">Several correct answers</option>
                    </select>

                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        patchQuestion(qi, {
                          options: [...question.options, { text: "", isCorrect: false }],
                        })
                      }
                      disabled={question.options.length >= 8}
                    >
                      Add option
                    </Button>

                    <div className="ml-auto flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={qi === 0}
                        onClick={() => moveQuestion(qi, -1)}
                        aria-label="Move up"
                      >
                        <ChevronUp size={13} />
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={qi === form.questions.length - 1}
                        onClick={() => moveQuestion(qi, 1)}
                        aria-label="Move down"
                      >
                        <ChevronDown size={13} />
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={form.questions.length === 1}
                        onClick={() =>
                          set(
                            "questions",
                            form.questions.filter((_, i) => i !== qi),
                          )
                        }
                        aria-label="Delete question"
                      >
                        <Trash2 size={13} className="text-error-500" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {question.options.map((option, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          type={question.type === "multiple" ? "checkbox" : "radio"}
                          name={`q-${qi}`}
                          checked={option.isCorrect}
                          onChange={(e) => patchOption(qi, oi, { isCorrect: e.target.checked })}
                          aria-label={`Option ${oi + 1} is correct`}
                          className="w-4 h-4 border-slate-300 text-success-600 focus:ring-success-500"
                        />
                        <input
                          type="text"
                          value={option.text}
                          maxLength={500}
                          onChange={(e) => patchOption(qi, oi, { text: e.target.value })}
                          placeholder={`Option ${oi + 1}`}
                          className="flex-1 px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        />
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={question.options.length <= 2}
                          onClick={() =>
                            patchQuestion(qi, {
                              options: question.options.filter((_, j) => j !== oi),
                            })
                          }
                          aria-label={`Remove option ${oi + 1}`}
                        >
                          <Trash2 size={12} className="text-slate-400" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {problems[qi] && (
                    <p className="text-[11px] text-warning-600 font-medium">{problems[qi]}</p>
                  )}
                </div>
              </div>
            </fieldset>
          ))}
        </div>

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 sticky bottom-0 py-2 bg-white">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!ready}>
            {assessmentId ? "Save changes" : "Create assessment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default AssessmentsTab;
