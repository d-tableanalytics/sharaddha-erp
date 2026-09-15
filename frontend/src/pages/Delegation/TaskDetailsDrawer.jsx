import { useState } from 'react';
import {
  X,
  Clock,
  User,
  Folder,
  Flag,
  Calendar,
  CheckCircle2,
  ShieldCheck,
  MessageSquare,
  Plus,
  Loader2,
  FileText,
  PhoneCall,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import {
  ReviseDateModal,
  TaskReminderModal,
  FollowUpModal,
  VerificationSubmitModal,
} from './DelegationModals';
import toast from 'react-hot-toast';
import delegationService from '../../services/delegation';

function getInitials(first = '', last = '') {
  const f = first ? first.charAt(0) : '';
  const l = last ? last.charAt(0) : '';
  return (f + l).toUpperCase() || 'U';
}

const LIFECYCLE_STEPS = [
  { id: 'Pending', label: 'Pending' },
  { id: 'In Progress', label: 'In Progress' },
  { id: 'Awaiting Verification', label: 'Verification' },
  { id: 'Completed', label: 'Completed' },
];

export function TaskDetailsDrawer({
  isOpen,
  onClose,
  task,
  onUpdateStatus,
  onVerifyAndComplete,
  onAddSubtask,
  onToggleSubtask,
  onAddRemark,
  onReviseDueDate,
  onAddReminder,
  onAddFollowUp,
  onDeleteTask,
}) {
  const [remarkText, setRemarkText] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [submittingRemark, setSubmittingRemark] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Modal open states
  const [isReviseDateOpen, setIsReviseDateOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !task) return null;

  const currentStepIndex = LIFECYCLE_STEPS.findIndex((s) => s.id === task.status);
  const isOverdue =
    task.dueDate &&
    task.status !== 'Completed' &&
    new Date(task.dueDate).getTime() < Date.now();

  // Subtask progress
  const totalSubtasks = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;
  const progressPercent = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0;

  const handlePostRemark = async (e) => {
    e.preventDefault();
    if (!remarkText.trim()) return;
    setSubmittingRemark(true);
    try {
      await onAddRemark(task._id, { text: remarkText.trim() });
      setRemarkText('');
    } catch (err) {
      toast.error('Failed to post remark');
    } finally {
      setSubmittingRemark(false);
    }
  };

  const handleAddSubtask = async (e) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      await onAddSubtask(task._id, { title: newSubtaskTitle.trim() });
      setNewSubtaskTitle('');
    } catch (err) {
      toast.error('Failed to add subtask');
    } finally {
      setAddingSubtask(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      if (onDeleteTask) {
        await onDeleteTask(task._id);
      } else {
        await delegationService.deleteDelegation(task._id);
        toast.success('Task moved to Trash Bin');
      }
      setShowDeleteModal(false);
      onClose?.();
    } catch (err) {
      console.error('Failed to delete task', err);
      toast.error(err?.response?.data?.message || 'Failed to delete task');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
        <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-md text-xs font-black uppercase bg-primary-50 text-primary-700 border border-primary-200">
                {task.category || 'Operations'}
              </span>
              <span className="text-xs font-bold text-slate-400">
                Created: {new Date(task.createdAt || Date.now()).toLocaleDateString('en-GB')}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title="Delete Task"
                aria-label="Delete Task"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                title="Close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Title & Priority */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-2">
                <h2 className="text-lg font-black text-slate-900 leading-tight">
                  {task.taskTitle}
                </h2>
                <span className="px-2.5 py-1 text-xs font-black rounded-lg border uppercase shrink-0 bg-primary-50 text-primary-700 border-primary-200">
                  {task.priority || 'Medium'}
                </span>
              </div>

              {/* Assignee & Assigner Row */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-semibold pt-1">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 font-black text-[10px] flex items-center justify-center border border-sky-400">
                    {getInitials(task.doerFirstName, task.doerLastName)}
                  </div>
                  <span>
                    Doer: <strong>{task.doerFirstName} {task.doerLastName}</strong>
                  </span>
                </div>
                <span>•</span>
                <div>
                  Delegated by: <strong>{task.assignerName || 'You'}</strong>
                </div>
              </div>
            </div>

            {/* Lifecycle Progress Stepper */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between text-xs font-black text-slate-700 uppercase tracking-wider">
                <span>Task Lifecycle</span>
                <span className="text-primary-700">{task.status}</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {LIFECYCLE_STEPS.map((step, idx) => {
                  const isDone = currentStepIndex >= idx;
                  const isCurrent = currentStepIndex === idx;

                  return (
                    <div key={step.id} className="flex flex-col items-center gap-1.5 text-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition-all ${
                          isDone
                            ? 'bg-primary-600 text-white shadow-xs'
                            : 'bg-slate-200 text-slate-500'
                        } ${isCurrent ? 'ring-4 ring-primary-500/20' : ''}`}
                      >
                        {isDone ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          isCurrent ? 'text-primary-700 font-black' : 'text-slate-500'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Status Action Buttons for Delegator */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                {task.status === 'Awaiting Verification' ? (
                  <button
                    type="button"
                    onClick={() => setIsVerifyOpen(true)}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 transition-all active:scale-98"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Review & Verify Completion</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Quick status:</span>
                    {['In Progress', 'Completed'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onUpdateStatus(task._id, { status: st })}
                        disabled={task.status === st}
                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                          task.status === st
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Pills: Revise Date, Reminder, Follow Up */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setIsReviseDateOpen(true)}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-left flex flex-col gap-1 transition-all"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Calendar className="w-3.5 h-3.5 text-primary-700" />
                  <span>Revise Due Date</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  {task.dueDate
                    ? new Date(task.dueDate).toLocaleDateString('en-GB')
                    : 'Not set'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsReminderOpen(true)}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-left flex flex-col gap-1 transition-all"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Clock className="w-3.5 h-3.5 text-orange-500" />
                  <span>Set Reminder</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  {task.reminders?.length || 0} active
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsFollowUpOpen(true)}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-left flex flex-col gap-1 transition-all"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <PhoneCall className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Log Follow-Up</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  {task.followUps?.length || 0} logged
                </span>
              </button>
            </div>

            {/* Description */}
            {task.description && (
              <div>
                <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Task Instructions & Details
                </h4>
                <div
                  className="p-4 rounded-lg bg-slate-50/60 border border-slate-200 text-xs font-medium text-slate-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: task.description }}
                />
              </div>
            )}

            {/* Evidence & Proof Section */}
            {task.evidenceRequired && (
              <div className="p-4 rounded-lg border border-primary-200 bg-primary-50/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-primary-900 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-primary-600" />
                    Required Evidence Proof
                  </span>
                  <span className="text-[11px] font-black uppercase text-primary-700">
                    {task.evidenceUrl ? 'Uploaded' : 'Pending Upload'}
                  </span>
                </div>
                {task.evidenceUrl ? (
                  <div className="pt-2 border-t border-primary-200/60 text-xs">
                    <a
                      href={task.evidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <span>{task.evidenceUrl}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {task.evidenceNotes && (
                      <p className="text-slate-600 mt-1 italic">"{task.evidenceNotes}"</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-primary-800/80">
                    The assignee must attach proof before submitting for verification.
                  </p>
                )}
              </div>
            )}

            {/* Subtasks / Checklist */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                    Subtasks Checklist
                  </h4>
                  <span className="text-xs font-bold text-slate-400">
                    ({completedSubtasks}/{totalSubtasks})
                  </span>
                </div>
                <span className="text-xs font-black text-primary-700">{progressPercent}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
                <div
                  className="h-full bg-primary-600 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Subtask list */}
              <div className="space-y-1.5">
                {task.subtasks?.map((st) => (
                  <label
                    key={st._id}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={st.completed}
                      onChange={() => onToggleSubtask(task._id, st._id, !st.completed)}
                      className="w-4 h-4 rounded border-slate-300 accent-primary-600 cursor-pointer"
                    />
                    <span
                      className={`text-xs font-medium ${
                        st.completed ? 'line-through text-slate-400' : 'text-slate-700'
                      }`}
                    >
                      {st.title}
                    </span>
                  </label>
                ))}
              </div>

              {/* Add Subtask Input */}
              <form onSubmit={handleAddSubtask} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Add a new checklist step..."
                  className="flex-1 h-9 px-3 text-xs font-medium bg-white border border-slate-200 rounded-lg outline-none focus:border-primary-600"
                />
                <button
                  type="submit"
                  disabled={addingSubtask || !newSubtaskTitle.trim()}
                  className="h-9 px-3.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                >
                  {addingSubtask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add</span>
                </button>
              </form>
            </div>

            {/* Date Revision History */}
            {task.dateRevisions?.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                  Date Revision History
                </h4>
                <div className="space-y-2">
                  {task.dateRevisions.map((rev) => (
                    <div
                      key={rev._id}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-700">
                        <span>New date: {new Date(rev.newDate).toLocaleDateString('en-GB')}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(rev.createdAt).toLocaleDateString('en-GB')}
                        </span>
                      </div>
                      <p className="text-slate-600 mt-1 italic">Reason: "{rev.reason}"</p>
                      <div className="text-[10px] text-slate-400 mt-0.5">By {rev.revisedByName}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Remarks & Activity Feed */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-700" />
                <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                  Activity & Remarks ({task.remarks?.length || 0})
                </h4>
              </div>

              {/* Feed */}
              <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar">
                {task.remarks?.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">No remarks yet.</p>
                ) : (
                  task.remarks?.map((rem) => (
                    <div
                      key={rem._id}
                      className="p-3 rounded-lg bg-slate-50/80 border border-slate-200 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">{rem.byName || 'Team Member'}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(rem.createdAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-slate-600 font-medium">{rem.text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Add Remark Box */}
              <form onSubmit={handlePostRemark} className="space-y-2 pt-2">
                <textarea
                  rows={2}
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  placeholder="Post an update, comment, or note..."
                  className="w-full p-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-primary-600 resize-none"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingRemark || !remarkText.trim()}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {submittingRemark && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Post Remark</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Danger Zone / Delete Task */}
            <div className="pt-4 border-t border-slate-200">
              <div className="p-3.5 rounded-lg bg-rose-50/60 border border-rose-200/70 flex items-center justify-between gap-4">
                <div>
                  <h5 className="text-xs font-bold text-rose-900">Delete Task</h5>
                  <p className="text-[11px] text-rose-700/80 mt-0.5">
                    Move this task to the Trash Bin. You can restore it anytime later.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  className="px-3 py-1.5 bg-white hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-300 hover:border-rose-600 rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Task</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-modals */}
      <ReviseDateModal
        isOpen={isReviseDateOpen}
        onClose={() => setIsReviseDateOpen(false)}
        task={task}
        onRevise={onReviseDueDate}
      />

      <TaskReminderModal
        isOpen={isReminderOpen}
        onClose={() => setIsReminderOpen(false)}
        task={task}
        onAddReminder={onAddReminder}
      />

      <FollowUpModal
        isOpen={isFollowUpOpen}
        onClose={() => setIsFollowUpOpen(false)}
        task={task}
        onAddFollowUp={onAddFollowUp}
      />

      <VerificationSubmitModal
        isOpen={isVerifyOpen}
        onClose={() => setIsVerifyOpen(false)}
        task={task}
        onVerify={onVerifyAndComplete}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => !isDeleting && setShowDeleteModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-800 leading-snug">
                  Delete Task?
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  This task will be soft-deleted and moved to the Trash Bin. You can restore it anytime from the Trash view.
                </p>
              </div>
            </div>

            {/* Task Preview Card */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Task to delete
              </span>
              <p className="text-xs font-bold text-slate-800 line-clamp-2">
                {task.taskTitle || 'Untitled Task'}
              </p>
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold text-[10px]">
                  {task.status}
                </span>
                {task.doerFirstName && (
                  <>
                    <span>•</span>
                    <span>Assignee: {task.doerFirstName} {task.doerLastName}</span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
                className="flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Task</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default TaskDetailsDrawer;
