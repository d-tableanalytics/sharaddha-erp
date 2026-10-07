/**
 * Buddy System panel — who holds a buddy task today, why, the backup order,
 * and the assignment history. Shared by the Delegation drawer and the
 * Checklist history modal, which pass the same fields (the two models name
 * them the same way).
 *
 * `onOverride` (optional) adds the manager's manual override: pick anybody to
 * pin the task to, or resume the automatic rotation. It receives
 * `{ doerId, reason }` or `{ resume: true }`.
 */

import { useState } from 'react';
import { Users, AlertTriangle, History, ChevronDown, ChevronRight, RotateCcw, UserCheck } from 'lucide-react';

const SOURCE_LABELS = {
  primary: 'Primary assignee',
  automatic: 'Automatically activated',
  manual: 'Assigned manually',
};

const EVENT_LABELS = {
  buddy_activated: 'Automatic buddy assignment',
  primary_restored: 'Primary assignee active again',
  no_assignee: 'No available assignee',
  manual_override: 'Manual assignment',
  resumed: 'Automatic rotation resumed',
  chain_changed: 'Buddy chain changed',
};

const formatDay = (day) => {
  if (!day) return '';
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (at) => (at ? new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

const todayKey = () => {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

/**
 * The one-word marker for a list row: a buddy task, a backup holding it
 * today, a manual pin, or nobody available. The reason is in the tooltip.
 */
export function BuddyBadge({ task, onClick }) {
  if (!task || task.assignmentType !== 'buddy') return null;
  const nobody = task.noAssigneeDay && task.noAssigneeDay === todayKey();
  const [label, tone] = nobody
    ? ['No available assignee', 'bg-warning-50 text-warning-600 border-warning-100']
    : task.assignmentSource === 'automatic'
      ? ['Buddy active', 'bg-primary-50 text-primary-700 border-primary-200']
      : task.assignmentSource === 'manual'
        ? ['Buddy · manual', 'bg-slate-100 text-slate-600 border-slate-200']
        : ['Buddy', 'bg-slate-50 text-slate-500 border-slate-200'];
  const title = task.assignmentReason || 'Buddy System enabled';
  const className = `inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold ${tone}`;
  const content = (<><Users className="w-2.5 h-2.5" /> {label}</>);
  return onClick ? (
    <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }} className={`${className} hover:opacity-80`}>
      {content}
    </button>
  ) : (
    <span title={title} className={className}>{content}</span>
  );
}

export function BuddyAssignmentPanel({ task, doerId, doerName, onOverride, loadUsers }) {
  const [showHistory, setShowHistory] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [users, setUsers] = useState([]);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!task || task.assignmentType !== 'buddy') return null;

  const chain = task.buddyChain || [];
  const source = task.assignmentSource || 'primary';
  const history = [...(task.assignmentHistory || [])].reverse();
  const nobodyToday = task.noAssigneeDay && task.noAssigneeDay === todayKey();
  const holderId = String(doerId ?? '');

  const openOverride = async () => {
    setOverriding(true);
    if (users.length === 0 && loadUsers) {
      try {
        setUsers((await loadUsers()) || []);
      } catch {
        setUsers([]);
      }
    }
  };

  const submit = async (payload) => {
    setBusy(true);
    try {
      await onOverride(payload);
      setOverriding(false);
      setTarget('');
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p-4 rounded-xl border border-slate-200 bg-white space-y-3" aria-label="Buddy System">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Users className="w-4 h-4 text-primary-600" /> Buddy System
          <span className="ml-1 px-1.5 py-0.5 rounded bg-success-50 text-success-600 border border-success-100 text-[10px] font-bold">
            ✓ Enabled
          </span>
        </h3>
        {onOverride && !overriding && (
          <button type="button" onClick={openOverride} className="text-xs font-bold text-primary-700 hover:text-primary-800">
            Assign manually
          </button>
        )}
      </div>

      {nobodyToday && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning-50 border border-warning-100 text-xs text-warning-600">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>No available assignee today.</strong> {task.assignmentReason}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current assignee</p>
          <p className="font-bold text-slate-900">{doerName || '—'}</p>
          <p className="text-slate-500">{SOURCE_LABELS[source] || source}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Backup order</p>
          <ol className="space-y-0.5">
            {chain.map((m, i) => {
              const active = String(m.userId) === holderId;
              return (
                <li key={String(m.userId)} className={active ? 'font-bold text-primary-700' : 'text-slate-700'}>
                  {i + 1}. {m.name}
                  {i === 0 && <span className="text-slate-400 font-normal"> (primary)</span>}
                  {active && <span className="font-normal"> — active</span>}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {task.assignmentReason && !nobodyToday && source !== 'primary' && (
        <p className="text-xs text-slate-600">
          <span className="font-bold text-slate-700">Reason: </span>
          {task.assignmentReason}
        </p>
      )}

      {overriding && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
          <label className="block text-xs font-semibold text-slate-700" htmlFor="buddy-override-target">
            Assign this task to
          </label>
          <select
            id="buddy-override-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          >
            <option value="">Select employee…</option>
            {chain.map((m) => (
              <option key={`c-${m.userId}`} value={String(m.userId)}>{m.name} (in buddy chain)</option>
            ))}
            {users
              .filter((u) => !chain.some((m) => String(m.userId) === u._id))
              .map((u) => (
                <option key={u._id} value={u._id}>{u.user || u.email}</option>
              ))}
          </select>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          />
          <p className="text-[11px] text-slate-500">
            A manual assignment stays in place — the automatic rotation stops for this task until you resume it.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!target || busy}
              onClick={() => submit({ doerId: target, reason: note.trim() })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-primary-600 hover:bg-primary-800 disabled:opacity-50"
            >
              <UserCheck className="w-3.5 h-3.5" /> Assign
            </button>
            <button
              type="button"
              onClick={() => setOverriding(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {onOverride && source === 'manual' && !overriding && (
        <button
          type="button"
          disabled={busy}
          onClick={() => submit({ resume: true })}
          className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:text-primary-800 disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Resume automatic buddy rotation
        </button>
      )}

      {history.length > 0 && (
        <div className="pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800"
          >
            {showHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <History className="w-3.5 h-3.5" /> Assignment history ({history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-2">
              {history.map((e) => (
                <li key={e._id || `${e.day}-${e.at}`} className="text-xs border-l-2 border-slate-200 pl-2.5">
                  <p className="font-bold text-slate-800">
                    {formatDay(e.day)}
                    <span className="font-normal text-slate-400"> · {formatTime(e.at)}</span>
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      e.source === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-primary-50 text-primary-700'
                    }`}
                    >
                      {e.source === 'manual' ? 'Manual' : 'Automatic'}
                    </span>
                  </p>
                  <p className="text-slate-700">{EVENT_LABELS[e.event] || e.event}</p>
                  {(e.fromName || e.toName) && e.event !== 'chain_changed' && e.event !== 'resumed' && (
                    <p className="text-slate-600">
                      {e.fromName || '—'} → {e.toName || 'nobody available'}
                    </p>
                  )}
                  {e.reason && <p className="text-slate-500">{e.reason}</p>}
                  {e.byName && <p className="text-slate-400">by {e.byName}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default BuddyAssignmentPanel;
