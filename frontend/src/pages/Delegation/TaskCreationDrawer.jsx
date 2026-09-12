import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Calendar,
  Users,
  CheckSquare,
  ShieldCheck,
  Tag,
  Loader2,
  FileText,
  Clock,
  Flag,
  Folder,
} from 'lucide-react';
import toast from 'react-hot-toast';

export function TaskCreationDrawer({
  isOpen,
  onClose,
  users = [],
  categories = [],
  onSubmit,
}) {
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [doerId, setDoerId] = useState('');
  const [inLoopIds, setInLoopIds] = useState([]);
  const [priority, setPriority] = useState('Medium');
  const [category, setCategory] = useState('Operations');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [dueDate, setDueDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [subtasks, setSubtasks] = useState(['']);
  const [submitting, setSubmitting] = useState(false);

  // Set default doer when users load
  useEffect(() => {
    if (users.length > 0 && !doerId) {
      setDoerId(users[0]._id);
    }
  }, [users, doerId]);

  if (!isOpen) return null;

  const handleAddSubtask = () => {
    setSubtasks([...subtasks, '']);
  };

  const handleSubtaskChange = (index, value) => {
    const updated = [...subtasks];
    updated[index] = value;
    setSubtasks(updated);
  };

  const handleRemoveSubtask = (index) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.trim().replace(/^#/, '');
      if (val && !tags.some((t) => t.name.toLowerCase() === val.toLowerCase())) {
        const colors = ['#1E4C92', '#0284c7', '#ea580c', '#16a34a', '#7c3aed'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        setTags([...tags, { name: val, color: randomColor }]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagName) => {
    setTags(tags.filter((t) => t.name !== tagName));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim() || !doerId || !dueDate) {
      toast.error('Please provide a title, assignee, and due date.');
      return;
    }

    const selectedDoer = users.find((u) => u._id === doerId);
    const selectedInLoop = users
      .filter((u) => inLoopIds.includes(u._id))
      .map((u) => ({ userId: u._id, name: u.user, email: u.email }));

    const validSubtasks = subtasks.filter((s) => s.trim()).map((s) => ({ title: s.trim() }));

    setSubmitting(true);
    try {
      await onSubmit({
        taskTitle: taskTitle.trim(),
        description: description.trim(),
        doerId,
        doerFirstName: selectedDoer?.user?.split(' ')[0] || 'Member',
        doerLastName: selectedDoer?.user?.split(' ').slice(1).join(' ') || '',
        assigneeHierarchy: `${selectedDoer?.user || 'Member'} → ${selectedDoer?.role || 'Team'}`,
        inLoop: selectedInLoop,
        priority,
        category,
        tags,
        startDate,
        dueDate,
        recurrence,
        verificationRequired,
        evidenceRequired,
        subtasks: validSubtasks,
      });

      // Reset
      setTaskTitle('');
      setDescription('');
      setTags([]);
      setSubtasks(['']);
      setDueDate('');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const priorities = [
    { label: 'Low', color: 'border-slate-300 text-slate-600' },
    { label: 'Medium', color: 'border-blue-400 text-blue-600' },
    { label: 'High', color: 'border-orange-400 text-orange-600' },
    { label: 'Urgent', color: 'border-red-500 text-red-600' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#1E4C92] text-white">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">Assign New Task</h2>
              <p className="text-xs font-semibold text-slate-500">
                Delegate work to a team member with audit tracking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Title */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              Task Title *
            </label>
            <input
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Quarterly Tax Filing Audit & Reconciliation"
              required
              className="w-full h-11 px-3.5 text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              Description & Instructions
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed guidelines, objectives, or instructions for the doer..."
              className="w-full p-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92] focus:ring-2 focus:ring-[#1E4C92]/20 resize-none"
            />
          </div>

          {/* Assignee & In-Loop Stakeholders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Assign To (Doer) *
              </label>
              <select
                value={doerId}
                onChange={(e) => setDoerId(e.target.value)}
                required
                className="w-full h-11 px-3 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              >
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.user || u.email} ({u.role || 'Member'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-11 px-3 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* In Loop Collaborators */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              In-Loop Stakeholders (Cc)
            </label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl min-h-[44px]">
              {users
                .filter((u) => u._id !== doerId)
                .map((u) => {
                  const selected = inLoopIds.includes(u._id);
                  return (
                    <button
                      key={u._id}
                      type="button"
                      onClick={() => {
                        if (selected) {
                          setInLoopIds(inLoopIds.filter((id) => id !== u._id));
                        } else {
                          setInLoopIds([...inLoopIds, u._id]);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        selected
                          ? 'bg-[#1E4C92] text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {u.user || u.email}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Priority Picker */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
              Priority Level
            </label>
            <div className="grid grid-cols-4 gap-2">
              {priorities.map((p) => {
                const active = priority === p.label;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPriority(p.label)}
                    className={`py-2 px-1 text-center rounded-xl border text-xs font-black transition-all ${
                      active
                        ? 'bg-[#1E4C92] text-white border-[#1E4C92] shadow-sm'
                        : `${p.color} bg-white hover:bg-slate-50`
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scheduling & Recurrence */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-11 px-3 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Due Date *
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full h-11 px-3 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Recurrence
              </label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className="w-full h-11 px-3 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              >
                <option value="none">One Time</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Fortnightly">Fortnightly</option>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Yearly">Yearly</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              Tags
            </label>
            <div className="space-y-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="Type tag and press Enter..."
                className="w-full h-10 px-3 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#1E4C92]"
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t.name}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white shadow-xs"
                      style={{ backgroundColor: t.color }}
                    >
                      <span>{t.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t.name)}
                        className="hover:opacity-80"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                Subtasks / Action Checklist
              </label>
              <button
                type="button"
                onClick={handleAddSubtask}
                className="text-xs font-bold text-[#1E4C92] hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            <div className="space-y-2">
              {subtasks.map((st, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={st}
                    onChange={(e) => handleSubtaskChange(index, e.target.value)}
                    placeholder={`Step ${index + 1}...`}
                    className="flex-1 h-9 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg outline-none focus:border-[#1E4C92]"
                  />
                  {subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSubtask(index)}
                      className="p-2 text-slate-400 hover:text-red-500 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Verification & Evidence Toggles */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1E4C92]" />
                <div>
                  <span className="text-xs font-black text-slate-800 block">
                    Delegator Verification Required
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    Task moves to 'Awaiting Verification' upon doer completion for your sign-off
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={verificationRequired}
                onChange={(e) => setVerificationRequired(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
              />
            </label>

            <div className="border-t border-slate-200/80 pt-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <div>
                    <span className="text-xs font-black text-slate-800 block">
                      Evidence / Attachment Proof Required
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      Doer must upload file link or document before submitting
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={evidenceRequired}
                  onChange={(e) => setEvidenceRequired(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 accent-[#1E4C92] cursor-pointer"
                />
              </label>
            </div>
          </div>
        </form>

        {/* Drawer Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !taskTitle.trim() || !dueDate}
            className="px-6 py-2.5 bg-[#1E4C92] hover:bg-[#163a6a] text-white text-xs font-black rounded-xl shadow-sm flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckSquare className="w-4 h-4" />
            )}
            <span>Assign Task</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskCreationDrawer;
