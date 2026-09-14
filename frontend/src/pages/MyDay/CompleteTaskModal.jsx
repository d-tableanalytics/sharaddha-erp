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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isVerificationRequired
                  ? "bg-indigo-50 text-indigo-600 border border-indigo-200/60"
                  : "bg-emerald-50 text-emerald-600 border border-emerald-200/60"
              }`}
            >
              {isVerificationRequired ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 leading-tight">
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
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs font-semibold text-red-700 bg-red-50 rounded-xl border border-red-200">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Workflow Note */}
          <div
            className={`p-3.5 rounded-xl text-xs font-medium border ${
              isVerificationRequired
                ? "bg-indigo-50/60 border-indigo-200/70 text-indigo-900"
                : "bg-emerald-50/60 border-emerald-200/70 text-emerald-900"
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
                Upload Evidence / Photos {isEvidenceRequired && <span className="text-red-500">*</span>}
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
              className="group border-2 border-dashed border-slate-300 hover:border-[#1E4C92] rounded-2xl p-6 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-blue-50/30"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-12 h-12 mx-auto mb-2 rounded-2xl bg-white shadow-xs border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-[#1E4C92] transition-colors">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-700">
                Drop files here or <span className="text-[#1E4C92] underline">browse</span>
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
                        <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-blue-500 shrink-0" />
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
                      className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
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
              className="w-full p-3 text-xs font-semibold bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 text-slate-800 placeholder-slate-400 resize-none transition-all"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-5 py-2.5 text-xs font-bold text-white rounded-xl shadow-xs flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer ${
                isVerificationRequired
                  ? "bg-[#1E4C92] hover:bg-[#163a6a]"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
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
