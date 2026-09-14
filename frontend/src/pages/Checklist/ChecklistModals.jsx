/**
 * Checklist Modals & Drawers.
 *
 * Six overlay components, all sharing the existing `Modal` and `Drawer` shells
 * from `components/ui/`. Each is a controlled component: the parent owns the
 * open/close state and the onSuccess callback.
 */

import { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { checklistApi } from '../../services/checklist';
import toast from 'react-hot-toast';
import {
  Upload,
  X,
} from 'lucide-react';

// ── Shared field styles ─────────────────────────────────────────────────────

const fieldClass =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E4C92]/30 focus:border-[#1E4C92] transition-all';

const labelClass = 'block text-xs font-bold text-slate-600 mb-1.5';

// ═════════════════════════════════════════════════════════════════════════════
// 1. CompleteChecklistModal
// ═════════════════════════════════════════════════════════════════════════════

export function CompleteChecklistModal({ isOpen, onClose, task, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [proofUrl, setProofUrl] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await checklistApi.completeTask(task._id, {
        proofUrl: proofUrl || undefined,
        proofFileName: proofUrl ? 'proof-document' : undefined,
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
        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100">
          <p className="text-sm font-bold text-[#1E4C92]">{task?.taskName}</p>
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
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-[#1E4C92] hover:!bg-[#173a70] !text-white rounded-xl font-bold text-xs shadow-sm"
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
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
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
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-amber-500 hover:!bg-amber-600 !text-white rounded-xl font-bold text-xs shadow-sm"
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
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
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
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-[#1E4C92] hover:!bg-[#173a70] !text-white rounded-xl font-bold text-xs shadow-sm"
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
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={handleSubmit}
            className="flex-1 !bg-[#1E4C92] hover:!bg-[#173a70] !text-white rounded-xl font-bold text-xs shadow-sm"
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
              {['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].map((f) => (
                <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
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
            className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] focus:ring-[#1E4C92]"
          />
          <span className="text-sm font-semibold text-slate-700">Proof required</span>
        </label>

        <div className="flex items-center gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">Cancel</Button>
          <Button loading={loading} onClick={handleSubmit} className="flex-1 !bg-[#1E4C92] hover:!bg-[#173a70] !text-white rounded-xl font-bold text-xs shadow-sm">
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
      setForm({
        taskName: '',
        taskCode: '',
        frequency: 'daily',
        doer: isAdmin ? '' : currentUser?._id || '',
        department: '',
        site: 'HO',
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        proofRequired: false,
      });
    }
  }, [isOpen, isAdmin, currentUser]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.taskName || !form.taskCode || !form.doer || !form.startDate || !form.endDate) {
      return toast.error('Please fill in all required fields');
    }
    setLoading(true);
    try {
      const result = await checklistApi.createRoutine(form);
      toast.success(`Routine created with ${result?.occurrencesCreated || 0} occurrences`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create routine');
    } finally {
      setLoading(false);
    }
  };

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
            <select value={form.frequency} onChange={(e) => set('frequency', e.target.value)} className={fieldClass}>
              {['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].map((f) => (
                <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Start Date *</label>
            <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>End Date *</label>
            <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={fieldClass} />
          </div>
        </div>

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
            className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] focus:ring-[#1E4C92]"
          />
          <span className="text-sm font-semibold text-slate-700">Proof required for completion</span>
        </label>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl font-bold text-xs">Cancel</Button>
          <Button loading={loading} onClick={handleSubmit} className="flex-1 !bg-[#1E4C92] hover:!bg-[#173a70] !text-white rounded-xl font-bold text-xs shadow-sm">
            Create Routine
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
