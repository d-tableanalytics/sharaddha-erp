/**
 * Buddy System inputs, shared by the Delegation and Checklist forms.
 *
 *   AssignmentTypeToggle  Single Assignee | Buddy System
 *   BuddyChainEditor      the ordered list: 1 = primary, the rest are backups
 *
 * The chain is an array of user ids in priority order; '' marks an empty slot.
 * The server re-validates everything (duplicates, inactive people, sizes) —
 * this only keeps the obvious mistakes from being made.
 */

import { ArrowUp, ArrowDown, X, Plus, Users } from 'lucide-react';

export const BUDDY_CHAIN_MIN = 2;
export const BUDDY_CHAIN_MAX = 6;

const defaultSelectClass =
  'w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm outline-none transition-all text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500';

export function AssignmentTypeToggle({ value, onChange, disabled = false }) {
  const options = [
    { id: 'single', label: 'Single Assignee' },
    { id: 'buddy', label: 'Buddy System' },
  ];
  return (
    <div role="radiogroup" aria-label="Assignment type" className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              active ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            } disabled:opacity-50`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** What is wrong with a chain, or null. Mirrors the server's first checks. */
export function buddyChainError(chain) {
  const ids = (chain || []).filter(Boolean);
  if (ids.length !== (chain || []).length) return 'Select an employee for every position in the buddy chain.';
  if (ids.length < BUDDY_CHAIN_MIN) return 'Buddy System needs a primary assignee and at least one backup.';
  if (new Set(ids).size !== ids.length) return 'The same employee cannot appear twice in the buddy chain.';
  return null;
}

export function BuddyChainEditor({ users = [], chain, onChange, selectClassName = defaultSelectClass }) {
  const label = (u) => `${u.user || u.email}${u.role ? ` (${u.role})` : ''}`;

  const setAt = (index, id) => onChange(chain.map((v, i) => (i === index ? id : v)));
  const remove = (index) => onChange(chain.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const next = [...chain];
    const target = index + delta;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Users className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary-600" />
        <span>
          The first person is the <strong className="text-slate-700">primary assignee</strong>. If they are away on a
          day the task is active, it goes to the first available backup below — for that day only.
        </span>
      </p>

      <ol className="space-y-2">
        {chain.map((id, index) => {
          // Somebody already chosen elsewhere in the chain is not offered again.
          const taken = new Set(chain.filter((v, i) => v && i !== index));
          return (
            <li key={index} className="flex items-center gap-2">
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  index === 0 ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                  {index === 0 ? 'Primary assignee' : 'Buddy / backup'}
                </span>
                <select
                  value={id}
                  onChange={(e) => setAt(index, e.target.value)}
                  aria-label={index === 0 ? 'Primary assignee' : `Backup ${index}`}
                  className={selectClassName}
                >
                  <option value="">Select employee…</option>
                  {users
                    .filter((u) => !taken.has(u._id))
                    .map((u) => (
                      <option key={u._id} value={u._id}>{label(u)}</option>
                    ))}
                </select>
              </div>
              <div className="flex items-center gap-0.5 self-end pb-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  title="Move up"
                  aria-label="Move up"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === chain.length - 1}
                  title="Move down"
                  aria-label="Move down"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={chain.length <= BUDDY_CHAIN_MIN}
                  title="Remove"
                  aria-label="Remove"
                  className="p-1 rounded text-slate-400 hover:text-error-600 hover:bg-error-50 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {chain.length < BUDDY_CHAIN_MAX && (
        <button
          type="button"
          onClick={() => onChange([...chain, ''])}
          className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:text-primary-800"
        >
          <Plus className="w-3.5 h-3.5" /> Add another buddy
        </button>
      )}
    </div>
  );
}
