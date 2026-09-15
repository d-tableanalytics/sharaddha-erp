/**
 * Checklist Modals & Drawers.
 *
 * Six overlay components, all sharing the existing `Modal` and `Drawer` shells
 * from `components/ui/`. Each is a controlled component: the parent owns the
 * open/close state and the onSuccess callback.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { checklistApi } from '../../services/checklist';
import toast from 'react-hot-toast';
import {
  Upload,
  X,
  Calendar,
  AlertCircle,
} from 'lucide-react';

// ── Shared field styles ─────────────────────────────────────────────────────

const fieldClass =
  'w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-600 transition-all';

const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

// ═════════════════════════════════════════════════════════════════════════════
// 1. CompleteChecklistModal
// ═════════════════════════════════════════════════════════════════════════════

export function CompleteChecklistModal({ isOpen, onClose, task, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [proofUrl, setProofUrl] = useState('');

  const handleSubmit = async () => {
    if (task?.proofRequired && !proofUrl?.trim()) {
      return toast.error('Proof document URL is required to complete this task');
    }
    setLoading(true);
    try {
      await checklistApi.completeTask(task._id, {
        proofUrl: proofUrl.trim() || undefined,
        proofFileName: proofUrl.trim() ? 'proof-document' : undefined,
      });
      toast.success('Task marked as completed');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to complete task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Complete Task" size="sm">
      <div className="space-y-4">
        <div className="p-3.5 rounded-lg bg-primary-50/70 border border-primary-100">
          <p className="text-sm font-bold text-primary-700">{task?.taskName}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{task?.taskCode}</p>
        </div>

        {task?.proofRequired && (
          <div>
            <label className={labelClass}>Proof URL (document link)</label>
            <div className="relative">
              <Upload size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                className={`${fieldClass} pl-9`}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-primary-600 hover:!bg-primary-700 !text-white rounded-lg font-bold text-xs shadow-sm"
          >
            Mark Complete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. NonFunctionalModal
// ═════════════════════════════════════════════════════════════════════════════

export function NonFunctionalModal({ isOpen, onClose, task, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await checklistApi.markNonFunctional(task._id, { reason });
      toast.success('Task marked as non-functional');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mark Non-Functional" size="sm">
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
          <p className="text-sm font-semibold text-amber-800">{task?.taskName}</p>
          <p className="text-xs text-amber-600 font-mono mt-0.5">{task?.taskCode}</p>
        </div>

        <div>
          <label className={labelClass}>Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this task non-functional?"
            rows={3}
            className={fieldClass}
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-amber-500 hover:!bg-amber-600 !text-white rounded-lg font-bold text-xs shadow-sm"
          >
            Mark Non-Functional
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. ReassignChecklistModal
// ═════════════════════════════════════════════════════════════════════════════

export function ReassignChecklistModal({ isOpen, onClose, task, users, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [newDoer, setNewDoer] = useState('');

  useEffect(() => {
    if (isOpen) setNewDoer('');
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!newDoer) return toast.error('Please select a user');
    setLoading(true);
    try {
      await checklistApi.reassignTask(task._id, { newDoer });
      toast.success('Task reassigned');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to reassign task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reassign Task" size="sm">
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p className="text-sm font-semibold text-slate-800">{task?.taskName}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Currently assigned to: {task?.doerFirstName} {task?.doerLastName}
          </p>
        </div>

        <div>
          <label className={labelClass}>Reassign to</label>
          <select value={newDoer} onChange={(e) => setNewDoer(e.target.value)} className={fieldClass}>
            <option value="">Select a user…</option>
            {(users || []).map((u) => (
              <option key={u._id} value={u._id}>
                {u.user || u.email} ({u.role})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-primary-600 hover:!bg-primary-700 !text-white rounded-lg font-bold text-xs shadow-sm"
          >
            Reassign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. RemarkModal
// ═════════════════════════════════════════════════════════════════════════════

export function RemarkModal({ isOpen, onClose, taskIds, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (isOpen) setText('');
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!text.trim()) return toast.error('Please enter a remark');
    setLoading(true);
    try {
      await checklistApi.addRemark({ taskIds, text: text.trim() });
      toast.success(`Remark added to ${taskIds.length} task(s)`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add remark');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Remark" size="sm">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Adding remark to <span className="font-bold text-slate-700">{taskIds?.length || 0}</span> task(s).
        </p>

        <div>
          <label className={labelClass}>Remark</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter follow-up note…"
            rows={3}
            className={fieldClass}
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-primary-600 hover:!bg-primary-700 !text-white rounded-lg font-bold text-xs shadow-sm"
          >
            Add Remark
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. EditChecklistModal
// ═════════════════════════════════════════════════════════════════════════════

export function EditChecklistModal({ isOpen, onClose, routine, users, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (isOpen && routine) {
      setForm({
        taskName: routine.taskName || '',
        frequency: routine.frequency || 'daily',
        doer: routine.doer || '',
        department: routine.department || '',
        site: routine.site || 'HO',
        startDate: routine.startDate ? new Date(routine.startDate).toISOString().split('T')[0] : '',
        endDate: routine.endDate ? new Date(routine.endDate).toISOString().split('T')[0] : '',
        proofRequired: routine.proofRequired || false,
      });
    }
  }, [isOpen, routine]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await checklistApi.updateRoutine(routine._id, form);
      toast.success('Routine updated');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update routine');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Routine" size="md">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Task Name</label>
          <input type="text" value={form.taskName || ''} onChange={(e) => set('taskName', e.target.value)} className={fieldClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Frequency</label>
            <select value={form.frequency || ''} onChange={(e) => set('frequency', e.target.value)} className={fieldClass}>
              {['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].map((f) => (
                <option key={f} value={f}>{f === 'once' ? 'One-time' : f.charAt(0).toUpperCase() + f.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Assigned To</label>
            <select value={form.doer || ''} onChange={(e) => set('doer', e.target.value)} className={fieldClass}>
              <option value="">Select…</option>
              {(users || []).map((u) => (
                <option key={u._id} value={u._id}>{u.user || u.email}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Start Date</label>
            <input type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>End Date</label>
            <input type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} className={fieldClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Department</label>
            <input type="text" value={form.department || ''} onChange={(e) => set('department', e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Site</label>
            <input type="text" value={form.site || ''} onChange={(e) => set('site', e.target.value)} className={fieldClass} />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.proofRequired || false}
            onChange={(e) => set('proofRequired', e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 accent-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm font-semibold text-slate-700">Proof required</span>
        </label>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">Cancel</Button>
          <Button loading={loading} onClick={handleSubmit} className="flex-1 !bg-primary-600 hover:!bg-primary-700 !text-white rounded-lg font-bold text-xs shadow-sm">
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. CreateChecklistDrawer
// ═════════════════════════════════════════════════════════════════════════════

export function CreateChecklistDrawer({ isOpen, onClose, users, isAdmin, currentUser, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  const [form, setForm] = useState({
    taskName: '',
    taskCode: '',
    frequency: 'daily',
    doer: '',
    department: '',
    site: 'HO',
    startDate: '',
    endDate: '',
    proofRequired: false,
  });

  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      setForm({
        taskName: '',
        taskCode: '',
        frequency: 'daily',
        doer: isAdmin ? '' : currentUser?._id || '',
        department: '',
        site: 'HO',
        startDate: today,
        endDate: today,
        proofRequired: false,
      });
      isSubmittingRef.current = false;
    }
  }, [isOpen, isAdmin, currentUser]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Calculate estimated task occurrences
  const estimatedCount = useMemo(() => {
    if (!form.startDate) return 0;
    if (form.frequency === 'once') return 1;
    if (!form.endDate) return 0;
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    if (start > end) return 0;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end && count < 1000) {
      count++;
      switch (form.frequency) {
        case 'daily': cur.setDate(cur.getDate() + 1); break;
        case 'weekly': cur.setDate(cur.getDate() + 7); break;
        case 'fortnightly': cur.setDate(cur.getDate() + 14); break;
        case 'monthly': cur.setMonth(cur.getMonth() + 1); break;
        case 'quarterly': cur.setMonth(cur.getMonth() + 3); break;
        case 'yearly': cur.setFullYear(cur.getFullYear() + 1); break;
        default: cur.setDate(cur.getDate() + 1);
      }
    }
    return count;
  }, [form.startDate, form.endDate, form.frequency]);

  const handleSubmit = async () => {
    if (loading || isSubmittingRef.current) return;
    const effectiveEndDate = form.frequency === 'once' ? form.startDate : (form.endDate || form.startDate);

    if (!form.taskName || !form.taskCode || !form.doer || !form.startDate || !effectiveEndDate) {
      return toast.error('Please fill in all required fields');
    }

    if (form.frequency !== 'once' && new Date(form.startDate) > new Date(effectiveEndDate)) {
      return toast.error('End date cannot be earlier than start date');
    }

    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const result = await checklistApi.createRoutine({
        ...form,
        endDate: effectiveEndDate,
      });
      toast.success(
        result?.occurrencesCreated === 1
          ? 'Checklist task created successfully'
          : `Routine created with ${result?.occurrencesCreated || 0} occurrences`
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create routine');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const isInvalidDateRange = form.frequency !== 'once' && form.endDate && new Date(form.startDate) > new Date(form.endDate);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={isAdmin ? 'New Checklist' : 'Add Checklist Task'} maxWidth="max-w-lg">
      <div className="space-y-5">
        <div>
          <label className={labelClass}>Task Name *</label>
          <input type="text" value={form.taskName} onChange={(e) => set('taskName', e.target.value)} placeholder="e.g. Fire extinguisher check" className={fieldClass} />
        </div>

        <div>
          <label className={labelClass}>Task Code *</label>
          <input type="text" value={form.taskCode} onChange={(e) => set('taskCode', e.target.value.toUpperCase())} placeholder="e.g. FE-CHECK-01" className={`${fieldClass} font-mono`} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Frequency *</label>
            <select
              value={form.frequency}
              onChange={(e) => {
                const newFreq = e.target.value;
                set('frequency', newFreq);
                if (newFreq === 'once') {
                  set('endDate', form.startDate);
                }
              }}
              className={fieldClass}
            >
              {['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].map((f) => (
                <option key={f} value={f}>{f === 'once' ? 'One-time' : f.charAt(0).toUpperCase() + f.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Assigned To *</label>
            {isAdmin ? (
              <select value={form.doer} onChange={(e) => set('doer', e.target.value)} className={fieldClass}>
                <option value="">Select user…</option>
                {(users || []).map((u) => (
                  <option key={u._id} value={u._id}>{u.user || u.email}</option>
                ))}
              </select>
            ) : (
              <input type="text" disabled value={currentUser?.user || currentUser?.email || ''} className={`${fieldClass} opacity-60`} />
            )}
          </div>
        </div>

        {form.frequency === 'once' ? (
          <div>
            <label className={labelClass}>Scheduled Date *</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => {
                set('startDate', e.target.value);
                set('endDate', e.target.value);
              }}
              className={fieldClass}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Date *</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  const newStart = e.target.value;
                  set('startDate', newStart);
                  if (form.endDate && new Date(newStart) > new Date(form.endDate)) {
                    set('endDate', newStart);
                  }
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>End Date *</label>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => set('endDate', e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
        )}

        {/* Occurrence Preview Helper Banner */}
        {form.startDate && (
          <div className={`flex items-center gap-2.5 p-3 rounded-lg text-xs font-semibold ${
            isInvalidDateRange
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-primary-50 text-primary-700 border border-primary-100'
          }`}>
            {isInvalidDateRange ? (
              <>
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>End date cannot be earlier than start date</span>
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4 shrink-0 text-primary-700" />
                <span>
                  {form.frequency === 'once'
                    ? 'This will create 1 single checklist task.'
                    : estimatedCount === 1
                      ? 'This will schedule 1 task occurrence.'
                      : `This will schedule ${estimatedCount} task occurrences (1 per ${form.frequency}).`}
                </span>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Department</label>
            <input type="text" value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. Safety" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Site</label>
            <input type="text" value={form.site} onChange={(e) => set('site', e.target.value)} placeholder="e.g. HO" className={fieldClass} />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.proofRequired}
            onChange={(e) => set('proofRequired', e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 accent-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm font-semibold text-slate-700">Proof required for completion</span>
        </label>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-lg font-bold text-xs">Cancel</Button>
          <Button
            loading={loading}
            disabled={loading || isInvalidDateRange}
            onClick={handleSubmit}
            className="flex-1 !bg-primary-600 hover:!bg-primary-700 !text-white rounded-lg font-bold text-xs shadow-sm"
          >
            {form.frequency === 'once'
              ? 'Create Task'
              : `Create Routine (${estimatedCount} ${estimatedCount === 1 ? 'task' : 'tasks'})`}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
