import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Film, FileText } from "lucide-react";

import { HrmsDataTable } from "../../../components/hrms/HrmsDataTable";
import { FilterBar } from "../../../components/hrms/FilterBar";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Textarea } from "../../../components/ui/Textarea";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog";
import {
  contentApi,
  uploadContent,
  readVideoDuration,
  formatFileSize,
  formatDuration,
  formatInstant,
} from "../../../services/hrms/academy";
import { MAX_CONTENT_BYTES } from "@shared/constants/academy.js";
import { PercentBar } from "./academyShared";
import { FilterChips } from "./academyVisuals";

const PAGE_SIZE = 25;

/** The thumbnail tint per content type, so a row is recognisable by shape. */
const TYPE_TILE = {
  video: "bg-primary-50 text-primary-700",
  pdf: "bg-error-50 text-error-500",
  document: "bg-slate-100 text-slate-600",
};

/**
 * The chip row the design reference uses in place of a type dropdown.
 *
 * It has no "Links" chip. `CONTENT_TYPES` is video, pdf and document — there is
 * no link content type in this module, and a chip that can never match anything
 * is a control that teaches people not to trust the row.
 */
const TYPE_CHIPS = [
  { key: null, label: "All" },
  { key: "video", label: "Videos" },
  { key: "pdf", label: "PDFs" },
  { key: "document", label: "Documents" },
];

/** What the file picker offers, per declared content type. */
const ACCEPT = {
  video: "video/mp4,video/webm",
  pdf: "application/pdf",
  document:
    "application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/plain,text/csv,image/png,image/jpeg",
};

/**
 * The content library.
 *
 * One row per uploaded video, PDF or document, reusable across courses. The
 * screen's real job is the two things the API refuses and a person needs
 * warning about: an item still used by a course cannot be deleted, and a video
 * cannot be uploaded without its duration.
 */
export function ContentLibraryTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "" });
  const [data, setData] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [failure, setFailure] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await contentApi.list({
          page,
          pageSize: PAGE_SIZE,
          search: filters.search || undefined,
          type: filters.type ?? undefined,
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

  const remove = useCallback(async () => {
    if (!confirming) return;
    setFailure(null);
    try {
      await contentApi.remove(confirming.id);
      setConfirming(null);
      load();
    } catch (err) {
      /**
       * The refusal worth rendering carefully: the server names the courses
       * still using the item. "It is in use" without saying where is an error
       * nobody can act on.
       */
      const courses = err.details?.courses ?? [];
      setFailure(
        courses.length > 0
          ? `${err.message} Used by: ${courses.map((c) => c.name).join(", ")}.`
          : err.message,
      );
      setConfirming(null);
    }
  }, [confirming, load]);

  const columns = [
    {
      header: "Title",
      accessorKey: "title",
      cell: (row) => (
        <div className="flex items-center gap-3 min-w-0">
          {/* The reference puts a thumbnail at the head of every row. There is
              no artwork to show, so the tile carries the TYPE — which is what a
              thumbnail of a PDF would have told you anyway. */}
          <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
              TYPE_TILE[row.type] ?? TYPE_TILE.document
            }`}
          >
            {row.type === "video" ? <Film size={16} /> : <FileText size={16} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{row.title}</p>
            {row.description && (
              <p className="text-xs text-slate-500 line-clamp-1">{row.description}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      header: "Type",
      cell: (row) => <Badge variant="neutral">{row.type.toUpperCase()}</Badge>,
    },
    {
      header: "Length",
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {row.type === "video" ? formatDuration(row.durationSeconds) : "—"}
        </span>
      ),
    },
    {
      header: "Size",
      cell: (row) => <span className="text-xs text-slate-600">{formatFileSize(row.fileSize)}</span>,
    },
    {
      /**
       * How many courses depend on this item.
       *
       * It is the column that answers "can I delete this?" before the click
       * rather than after it — `deleteContent` refuses anything in use, and a
       * zero here is the only safe row.
       */
      header: "Used In",
      cell: (row) => (
        <span
          className={`text-xs tabular-nums ${
            row.usedIn > 0 ? "font-semibold text-slate-700" : "text-slate-400"
          }`}
        >
          {row.usedIn > 0
            ? `${row.usedIn} course${row.usedIn === 1 ? "" : "s"}`
            : "Not used"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <Badge variant={row.active ? "success" : "neutral"}>
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      header: "Uploaded",
      cell: (row) => (
        <span className="text-xs text-slate-500">
          {formatInstant(row.createdAt)}
          {row.uploadedByName && <span className="block text-slate-400">{row.uploadedByName}</span>}
        </span>
      ),
    },
    {
      header: "",
      cell: (row) => (
        <Button
          size="xs"
          variant="ghost"
          data-no-row-click
          onClick={() => setConfirming(row)}
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar
          search={filters.search}
          onSearchChange={(v) => {
            setFilters((f) => ({ ...f, search: v }));
            setPage(1);
          }}
          searchPlaceholder="Search the library…"
          values={filters}
          onChange={(key, value) => {
            setFilters((f) => ({ ...f, [key]: value }));
            setPage(1);
          }}
          onReset={() => {
            setFilters({ search: "" });
            setPage(1);
          }}
        />

        <Button size="sm" onClick={() => setUploading(true)}>
          <Plus size={15} className="mr-1.5" />
          Upload Content
        </Button>
      </div>

      <FilterChips
        options={TYPE_CHIPS}
        value={filters.type ?? null}
        ariaLabel="Filter by content type"
        onChange={(key) => {
          setFilters((f) => ({ ...f, type: key ?? undefined }));
          setPage(1);
        }}
      />

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
        emptyTitle="The library is empty"
        emptyDescription="Upload a training video, a policy PDF or a document. Each one can be reused by any number of courses."
      />

      {uploading && (
        <UploadContentModal
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            load();
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={remove}
        title="Delete this content?"
        description={
          confirming
            ? `"${confirming.title}" will be removed from the library. If any course still uses it, the deletion will be refused and nothing will change.`
            : ""
        }
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

/**
 * Upload one content item.
 *
 * A video's DURATION is read in the browser before the upload, because the
 * server has no media parser and a video with no duration can never have its
 * completion measured — the schema refuses one. It is safe to trust: the
 * duration is only ever the denominator of a ratio whose numerator the server
 * accumulates itself, so overstating it makes a video harder to complete.
 */
function UploadContentModal({ onClose, onUploaded }) {
  const [type, setType] = useState("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  const inputRef = useRef(null);

  const limit = MAX_CONTENT_BYTES[type] ?? MAX_CONTENT_BYTES.document;

  const pick = async (event) => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setDuration(null);
    setFailure(null);
    if (!chosen) return;

    // Checked here as well as on the server, so the person finds out before
    // spending two minutes uploading rather than after.
    if (chosen.size > limit) {
      setFailure(
        `That file is ${formatFileSize(chosen.size)} — larger than the ${Math.round(
          limit / 1024 / 1024,
        )} MB limit for a ${type}.`,
      );
      return;
    }

    if (!title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, ""));

    if (type === "video") {
      setReading(true);
      const seconds = await readVideoDuration(chosen);
      setReading(false);
      if (!seconds) {
        setFailure(
          "This browser could not read the video's length. Upload an MP4 or WebM — without a duration, completion cannot be measured.",
        );
        return;
      }
      setDuration(seconds);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    setFailure(null);
    setProgress(0);
    try {
      await uploadContent(
        file,
        { title: title.trim(), description: description.trim(), type, durationSeconds: duration },
        setProgress,
      );
      onUploaded();
    } catch (err) {
      setFailure(err?.response?.data?.message ?? err.message);
    } finally {
      setSaving(false);
    }
  };

  const ready = file && title.trim() && (type !== "video" || duration) && !failure;

  return (
    <Modal isOpen onClose={saving ? () => {} : onClose} title="Upload content" size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select
          label="Type"
          value={type}
          disabled={saving}
          onChange={(e) => {
            setType(e.target.value);
            setFile(null);
            setDuration(null);
            setFailure(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
        >
            <option value="video">Video — tracked by how much is watched</option>
            <option value="pdf">PDF — read inline, confirmed by the learner</option>
          <option value="document">Document — downloaded, confirmed by the learner</option>
        </Select>

        <div className="w-full flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">File</label>
          <input
            ref={inputRef}
            type="file"
            required
            disabled={saving}
            accept={ACCEPT[type]}
            onChange={pick}
            className="w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-100"
          />
          <span className="text-xs text-slate-500">
            Up to {Math.round(limit / 1024 / 1024)} MB.
            {type === "video" && " MP4 or WebM."}
            {reading && " Reading the video's length…"}
            {duration != null && ` Length: ${formatDuration(duration)}.`}
          </span>
        </div>

        <Input
          label="Title"
          required
          maxLength={200}
          disabled={saving}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Textarea
          label="Description"
          rows={2}
          maxLength={2000}
          disabled={saving}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {saving && (
          <div className="flex flex-col gap-1.5">
            <PercentBar percent={progress} size="sm" />
            <span className="text-[11px] text-slate-500 tabular-nums">
              Uploading… {progress}%
            </span>
          </div>
        )}

        {failure && (
          <p role="alert" className="text-xs text-error-600 font-medium">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!ready}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default ContentLibraryTab;
