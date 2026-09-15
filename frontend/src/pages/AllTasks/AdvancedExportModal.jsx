import { useState, useMemo } from 'react';
import {
  X,
  Calendar as CalendarIcon,
  Download,
  Users,
  UserCheck,
  RotateCcw,
  CheckSquare,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

export function AdvancedExportModal({
  isOpen,
  onClose,
  tasks = [],
  users = [],
}) {
  // Date Range state
  const [dateRange, setDateRange] = useState('All Time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Assignee multi-select state
  const [selectedDoerIds, setSelectedDoerIds] = useState(() => users.map((u) => u._id));
  // Assigner multi-select state
  const uniqueAssignerIds = useMemo(() => {
    const set = new Set();
    tasks.forEach((t) => {
      if (t.assignerId) set.add(String(t.assignerId));
    });
    return Array.from(set);
  }, [tasks]);

  const [selectedAssignerIds, setSelectedAssignerIds] = useState(() => [...uniqueAssignerIds]);

  // Task types state
  const [includeRepetitive, setIncludeRepetitive] = useState(true);
  const [includeOneTime, setIncludeOneTime] = useState(true);

  // Reporting Manager (HOD) state
  const [selectedHodId, setSelectedHodId] = useState('ALL');

  // Derive managers who have reportees
  const reportingManagers = useMemo(() => {
    const mgrCounts = new Map();
    users.forEach((u) => {
      if (u.reportingManagerId || u.reportingManager) {
        const mId = String(u.reportingManagerId || u.reportingManager?._id || u.reportingManager);
        mgrCounts.set(mId, (mgrCounts.get(mId) || 0) + 1);
      }
    });

    const mgrs = [];
    users.forEach((u) => {
      const count = mgrCounts.get(String(u._id)) || 0;
      if (count > 0 || u.role === 'Admin' || u.role === 'Super Admin' || u.role === 'Management') {
        mgrs.push({
          id: String(u._id),
          name: u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
          reporteeCount: count,
        });
      }
    });
    return mgrs;
  }, [users]);

  // Map of HOD to subordinate IDs
  const hodSubordinateIds = useMemo(() => {
    if (selectedHodId === 'ALL') return null;
    const subIds = new Set();
    users.forEach((u) => {
      const mId = String(u.reportingManagerId || u.reportingManager?._id || u.reportingManager);
      if (mId === selectedHodId) {
        subIds.add(String(u._id));
      }
    });
    return subIds;
  }, [users, selectedHodId]);

  // Evaluates matching tasks for real-time count
  const matchingTasks = useMemo(() => {
    return tasks.filter((t) => {
      // 1. Date range filter
      if (dateRange !== 'All Time') {
        const targetDate = t.dueDate ? new Date(t.dueDate) : (t.createdAt ? new Date(t.createdAt) : null);
        if (targetDate && !isNaN(targetDate.getTime())) {
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

          if (dateRange === 'Today') {
            if (targetDate < startOfToday || targetDate > endOfToday) return false;
          } else if (dateRange === 'Yesterday') {
            const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
            const endOfYesterday = new Date(endOfToday.getTime() - 24 * 60 * 60 * 1000);
            if (targetDate < startOfYesterday || targetDate > endOfYesterday) return false;
          } else if (dateRange === 'This Week') {
            const day = startOfToday.getDay();
            const diff = startOfToday.getDate() - day + (day === 0 ? -6 : 1);
            const startOfWeek = new Date(startOfToday);
            startOfWeek.setDate(diff);
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
            if (targetDate < startOfWeek || targetDate > endOfWeek) return false;
          } else if (dateRange === 'Last Week') {
            const day = startOfToday.getDay();
            const diff = startOfToday.getDate() - day + (day === 0 ? -6 : 1) - 7;
            const startOfLastWeek = new Date(startOfToday);
            startOfLastWeek.setDate(diff);
            startOfLastWeek.setHours(0, 0, 0, 0);
            const endOfLastWeek = new Date(startOfLastWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
            if (targetDate < startOfLastWeek || targetDate > endOfLastWeek) return false;
          } else if (dateRange === 'This Month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            if (targetDate < startOfMonth || targetDate > endOfMonth) return false;
          } else if (dateRange === 'Last Month') {
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            if (targetDate < startOfLastMonth || targetDate > endOfLastMonth) return false;
          } else if (dateRange === 'This Year') {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            if (targetDate < startOfYear || targetDate > endOfYear) return false;
          } else if (dateRange === 'Custom') {
            if (customStartDate && targetDate < new Date(customStartDate)) return false;
            if (customEndDate && targetDate > new Date(`${customEndDate}T23:59:59.999`)) return false;
          }
        }
      }

      // 2. Assigned To filter
      if (selectedDoerIds.length > 0 && t.doerId) {
        if (!selectedDoerIds.includes(String(t.doerId))) return false;
      }

      // 3. Assigned By filter
      if (selectedAssignerIds.length > 0 && t.assignerId) {
        if (!selectedAssignerIds.includes(String(t.assignerId))) return false;
      }

      // 4. Task Type filter
      const isRepetitive = Boolean(t.frequency || (t.recurrence && t.recurrence !== 'none'));
      if (!includeRepetitive && isRepetitive) return false;
      if (!includeOneTime && !isRepetitive) return false;

      // 5. Reporting Manager (HOD) filter
      if (hodSubordinateIds && hodSubordinateIds.size > 0) {
        if (!hodSubordinateIds.has(String(t.doerId))) return false;
      }

      return true;
    });
  }, [
    tasks,
    dateRange,
    customStartDate,
    customEndDate,
    selectedDoerIds,
    selectedAssignerIds,
    includeRepetitive,
    includeOneTime,
    hodSubordinateIds,
  ]);

  if (!isOpen) return null;

  // Handlers
  const toggleSelectAllDoers = () => {
    if (selectedDoerIds.length === users.length) {
      setSelectedDoerIds([]);
    } else {
      setSelectedDoerIds(users.map((u) => String(u._id)));
    }
  };

  const toggleDoer = (id) => {
    setSelectedDoerIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAllAssigners = () => {
    if (selectedAssignerIds.length === uniqueAssignerIds.length) {
      setSelectedAssignerIds([]);
    } else {
      setSelectedAssignerIds([...uniqueAssignerIds]);
    }
  };

  const toggleAssigner = (id) => {
    setSelectedAssignerIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleExport = () => {
    if (matchingTasks.length === 0) {
      toast.error('No tasks match your export criteria');
      return;
    }

    const headers = [
      'Task Title',
      'Assigned By',
      'Assigned To',
      'Assignee Hierarchy',
      'Status',
      'Priority',
      'Category',
      'Tags',
      'Recurrence / Frequency',
      'Due Date',
      'Completed Date',
      'Verification Required',
      'Created Date',
      'Description',
    ];

    const rows = matchingTasks.map((t) => {
      const assigner = (t.assignerName || `${t.assignerFirstName || ''} ${t.assignerLastName || ''}`).trim() || 'Admin';
      const doer = `${t.doerFirstName || ''} ${t.doerLastName || ''}`.trim() || 'Unassigned';
      const tagsStr = (t.tags || []).map((tg) => tg.name || tg).join(', ');
      const cleanDesc = (t.description || '').replace(/<[^>]*>?/gm, '').replace(/"/g, '""');

      return [
        `"${(t.taskTitle || '').replace(/"/g, '""')}"`,
        `"${assigner.replace(/"/g, '""')}"`,
        `"${doer.replace(/"/g, '""')}"`,
        `"${(t.assigneeHierarchy || '').replace(/"/g, '""')}"`,
        `"${t.status || ''}"`,
        `"${t.priority || ''}"`,
        `"${t.category || ''}"`,
        `"${tagsStr.replace(/"/g, '""')}"`,
        `"${t.frequency || t.recurrence || 'One Time'}"`,
        t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
        t.completedAt ? new Date(t.completedAt).toISOString().split('T')[0] : '',
        t.verificationRequired ? 'Yes' : 'No',
        t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
        `"${cleanDesc}"`,
      ];
    });

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `All_Tasks_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${matchingTasks.length} tasks successfully!`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative bg-white rounded-xl w-full max-w-lg p-6 shadow-enterprise-lg z-10 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center font-bold">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Export Tasks</h2>
              <p className="text-xs font-semibold text-slate-400">Configure export filters and fields</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
          {/* 1. Date Range */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Date Range
            </label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              <option value="All Time">All Time</option>
              <option value="Today">Today</option>
              <option value="Yesterday">Yesterday</option>
              <option value="This Week">This Week</option>
              <option value="Last Week">Last Week</option>
              <option value="This Month">This Month</option>
              <option value="Last Month">Last Month</option>
              <option value="This Year">This Year</option>
              <option value="Custom">Custom Date Range</option>
            </select>

            {dateRange === 'Custom' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 mb-1 block">Start Date</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 mb-1 block">End Date</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 2. Assigned To */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">
                Assigned To ({selectedDoerIds.length}/{users.length})
              </label>
              <button
                type="button"
                onClick={toggleSelectAllDoers}
                className="text-[11px] font-bold text-primary-700 hover:underline cursor-pointer"
              >
                {selectedDoerIds.length === users.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50 space-y-1.5">
              {users.map((u) => {
                const uName = u.user || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                const isChecked = selectedDoerIds.includes(String(u._id));
                return (
                  <label
                    key={u._id}
                    className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-100/80 p-1 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleDoer(String(u._id))}
                      className="rounded text-primary-700 focus:ring-primary-500"
                    />
                    <span className="truncate">{uName}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 3. Assigned By */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">
                Assigned By ({selectedAssignerIds.length}/{uniqueAssignerIds.length})
              </label>
              <button
                type="button"
                onClick={toggleSelectAllAssigners}
                className="text-[11px] font-bold text-primary-700 hover:underline cursor-pointer"
              >
                {selectedAssignerIds.length === uniqueAssignerIds.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50 space-y-1.5">
              {uniqueAssignerIds.map((id) => {
                const foundUser = users.find((u) => String(u._id) === id);
                const name = foundUser
                  ? foundUser.user || foundUser.name || `${foundUser.firstName || ''} ${foundUser.lastName || ''}`.trim()
                  : `Assigner (${id.substring(0, 6)}...)`;
                const isChecked = selectedAssignerIds.includes(id);
                return (
                  <label
                    key={id}
                    className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-100/80 p-1 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleAssigner(id)}
                      className="rounded text-primary-700 focus:ring-primary-500"
                    />
                    <span className="truncate">{name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 4. Task Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Task Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg bg-slate-50/50 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeRepetitive}
                  onChange={(e) => setIncludeRepetitive(e.target.checked)}
                  className="rounded text-primary-700 focus:ring-primary-500"
                />
                <span>Repetitive Tasks</span>
              </label>
              <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg bg-slate-50/50 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOneTime}
                  onChange={(e) => setIncludeOneTime(e.target.checked)}
                  className="rounded text-primary-700 focus:ring-primary-500"
                />
                <span>One-Time Tasks</span>
              </label>
            </div>
          </div>

          {/* 5. Reporting Manager (HOD) Scoping */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Reporting Manager (HOD)
            </label>
            <select
              value={selectedHodId}
              onChange={(e) => setSelectedHodId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all placeholder-slate-400 text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            >
              <option value="ALL">All Managers & Departments</option>
              {reportingManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.reporteeCount > 0 ? `(${m.reporteeCount} reportees)` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">
              Scopes exported records to tasks assigned to members reporting to this manager.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={matchingTasks.length === 0}
            className="inline-flex items-center justify-center font-medium rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none bg-primary-600 hover:bg-primary-700 text-white shadow-enterprise px-4 py-2 text-sm gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Tasks ({matchingTasks.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdvancedExportModal;
