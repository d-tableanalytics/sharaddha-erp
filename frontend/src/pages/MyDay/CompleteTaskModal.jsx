import { useState, useRef } from "react";
import {
  X,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Image as ImageIcon,
  ShieldCheck,
} from "lucide-react";

/**
 * CompleteTaskModal
 *
 * Handles file evidence upload, notes, and submits completion or verification dispatch
 * for Delegation and Group tasks according to application design standards.
 */
export function CompleteTaskModal({ isOpen, onClose, task, onSubmit }) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  if (!isOpen || !task) return null;

  const isVerificationRequired = !!task.verificationRequired;
  const isEvidenceRequired = !!task.evidenceRequired;
  const targetStatus = isVerificationRequired ? "Awaiting Verification" : "Completed";

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;

    // Validate size (max 100MB per file)
    const valid = selectedFiles.filter((f) => {
      if (f.size > 100 * 1024 * 1024) {
        setError(`File ${f.name} exceeds maximum allowed size of 100MB.`);
        return false;
      }
      return true;
    });

    setFiles((prev) => [...prev, ...valid]);
    setError("");
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (isEvidenceRequired && files.length === 0 && !notes.trim()) {
      setError("Evidence or notes are required for this task before completion.");
      return;
    }

    setSubmitting(true);
    try {
      let evidenceUrl = task.evidenceUrl || "";
      let evidenceNotes = notes.trim();

      if (files.length > 0) {
        const fileNames = files.map((f) => f.name).join(", ");
        evidenceUrl = `uploaded://${files[0].name}`;
        if (!evidenceNotes) {
          evidenceNotes = `Uploaded files: ${fileNames}`;
        } else {
          evidenceNotes = `${evidenceNotes} (Files: ${fileNames})`;
        }
      }

      await onSubmit(task, {
        status: targetStatus,
        evidenceUrl,
        evidenceNotes,
        completedAt: new Date().toISOString(),
      });

      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to complete task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-enterprise-lg border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isVerificationRequired
                  ? "bg-primary-50 text-primary-600 border border-primary-200/60"
                  : "bg-success-50 text-success-600 border border-success-100/60"
              }`}
            >
              {isVerificationRequired ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 leading-tight">
                {isVerificationRequired ? "Submit for Verification" : "Complete Task"}
              </h3>
              <p className="text-xs font-bold text-slate-400 truncate max-w-sm mt-0.5">
                {task.taskTitle || task.taskName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs font-semibold text-error-600 bg-error-50 rounded-xl border border-error-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Workflow Note */}
          <div
            className={`p-3.5 rounded-xl text-xs font-medium border ${
              isVerificationRequired
                ? "bg-primary-50/60 border-primary-200/70 text-primary-900"
                : "bg-success-50/60 border-success-100/70 text-success-600"
            }`}
          >
            {isVerificationRequired
              ? "This task requires manager verification. Once submitted, it moves to 'Waiting for approval' until reviewed."
              : "This task will be marked as Completed immediately upon submission."}
          </div>

          {/* File Upload Zone */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Upload Evidence / Photos {isEvidenceRequired && <span className="text-error-500">*</span>}
              </label>
              <span className="text-[11px] font-medium text-slate-400">JPG, PNG, PDF up to 100MB</span>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const droppedFiles = Array.from(e.dataTransfer.files || []);
                if (droppedFiles.length) {
                  setFiles((prev) => [...prev, ...droppedFiles]);
                }
              }}
              className="group border-2 border-dashed border-slate-300 hover:border-primary-600 rounded-xl p-6 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-primary-50/30"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-12 h-12 mx-auto mb-2 rounded-xl bg-white shadow-enterprise border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-primary-700 transition-colors">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-700">
                Drop files here or <span className="text-primary-700 underline">browse</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Attach job-site photos, test certificates, or signoff documents
              </p>
            </div>

            {/* Attached files list */}
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {file.type.startsWith("image/") ? (
                        <ImageIcon className="w-4 h-4 text-success-500 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-primary-500 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-700 truncate">
                        {file.name}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(idx)}
                      className="p-1 rounded-lg text-slate-400 hover:text-error-500 hover:bg-error-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes Textarea */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Completion Notes / Remarks
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add observations, site conditions, inspection notes, or handover comments..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-transparent hover:bg-slate-100 text-slate-600 px-4 py-2 text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {isVerificationRequired ? "Submit for Verification" : "Complete Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CompleteTaskModal;
