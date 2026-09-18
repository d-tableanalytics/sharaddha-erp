import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Save, Loader2, ShieldCheck, Plus, Trash2, Users, Store, X,
  Search, ChevronRight, ChevronDown, Folder, Copy, Pencil, Mail, MoreVertical,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useAdminStore } from '../../../store/adminStore';
import { useUserStore } from '../../../store/userStore';
import { Card, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import { canManageRoles } from '../../../utils/permissions';
import {
  ACTION_LABELS, mapToGrants, sameGrants, toggleCell, mergeGrantLists,
} from '../../../utils/grants';

/**
 * The Super Admin's control panel for access - requirement 3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES, AND WHY THE OLD ONE COULD NOT BE PATCHED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The previous screen listed seven hardcoded permission names down the side and
 * every role across the top, and saving it wrote to a `Role` collection that
 * NOTHING consulted. Enforcement read a compiled-in map keyed by User.role,
 * whose values ('Admin', 'Sales') did not even match the role names this screen
 * displayed ('Administrator', 'Sales Manager'). Every tick here was a no-op,
 * and the screen gave no sign of it.
 *
 * So this is not a redesign of that screen; it is the first version of it that
 * is connected to anything.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE ROLE AT A TIME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The old layout put roles on the X axis. That works for seven permissions and
 * collapses at forty-odd sub-modules times five actions times a growing number
 * of roles - it becomes a horizontally scrolling grid where the row label is
 * off-screen by the time you reach the column you wanted.
 *
 * Picking a role and showing its whole matrix keeps every cell next to the
 * thing it describes, and matches how the job is actually done: you sit down to
 * configure a role, not to compare a permission across roles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE TABLE, NOT A CARD PER MODULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every module used to be its own card with its own five-column table and its
 * own header row. Ten modules meant ten repetitions of "View Create Edit Delete
 * Approve" down the page, and the columns did not line up between them, so the
 * one thing a matrix is for - running your eye down a column - did not work.
 *
 * Now it is a single table with one header. A module is a ROW that expands to
 * its sub-modules, which also gives the module row somewhere to put a bulk
 * control: ticking View on the FMS row grants View on everything inside it.
 */

/**
 * The role's CURRENT effective grants, seeded for the matrix.
 *
 * ---------------------------------------------------------------------------
 * NO LOCKED CELLS — EVERY CHECKBOX SHOWS WHAT IS TRUE, AND CAN BE CHANGED
 * ---------------------------------------------------------------------------
 * The floor a role starts from — its BASELINE, see BASELINE_ROLE_PERMISSIONS in
 * backend/config/permissions.js — is still enforced server-side:
 * `resolveRolePermissions` unions baseline with whatever is stored, one
 * directionally, and nothing sent from this screen can change that. What
 * changed is how the screen ADMITS it.
 *
 * The previous version rendered a baseline cell ticked-and-disabled behind a
 * padlock, so an admin could see it but never touch it, and a super-admin
 * role's whole matrix the same way. This renders every cell as an ordinary
 * checkbox, seeded from baseline UNION the role's own grants — so a box starts
 * by telling the truth about what the role can do today, and can be freely
 * unchecked and rechecked from there like any other.
 *
 * Unchecking a baseline cell and saving does exactly what it looks like: the
 * tick clears, and the role's stored grants no longer list it. It does not
 * remove the role's actual access, because the compiled floor still unions
 * back in at authorization time — the same "no existing access is lost"
 * guarantee this system has always made. The visible effect is that the cell
 * is ticked again the next time this role is opened, because the seed always
 * re-reads the true current state rather than remembering a click that did
 * not change anything real. Nothing here pretends otherwise with a lock icon;
 * the box just shows what is actually granted, every time.
 */
const mergedInitialGrants = (role) => mergeGrantLists(role?.baselineGrants, role?.grants);

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const AVATAR_TONES = [
  'bg-rose-100 text-rose-700',
  'bg-primary-100 text-primary-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
];

/**
 * A role's initials.
 *
 * Derived from the name and not stored: a role is identified by its name, and
 * an avatar colour somebody has to choose is one more field to keep in sync for
 * no gain. The tint is a function of the name, so a role looks the same in the
 * list and in the panel beside it.
 */
function RoleAvatar({ name = '', size = 36 }) {
  const text = String(name).trim();
  const words = text.split(/\s+/).filter(Boolean);
  /**
   * Two initials, however the name is shaped.
   *
   * "Sales Manager" gives SM; "Admin", a single word, gives AD rather than a
   * lonely A. One letter in a 36px tile reads as a bullet, not as a name.
   */
  const initials =
    (words.length > 1
      ? words.slice(0, 2).map((w) => w[0]).join('')
      : (words[0] || '').slice(0, 2)
    ).toUpperCase() || '?';

  // Summed char codes rather than length: "HR" and "IT" are both 2 characters
  // and would otherwise always collide.
  const seed = [...text].reduce((n, c) => n + c.charCodeAt(0), 0);

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`shrink-0 inline-flex items-center justify-center rounded-xl font-bold ${
        AVATAR_TONES[seed % AVATAR_TONES.length]
      }`}
    >
      {initials}
    </span>
  );
}

/**
 * What KIND of role this is.
 *
 * The design reference shows an "Active" pill on every role. Nothing in the
 * model is active or inactive - a role exists or it does not - so a pill saying
 * "Active" on all six would be decoration that teaches a reader to ignore that
 * position.
 *
 * The slot carries the distinction that IS real and that an admin acts on:
 * whether the role is built in (cannot be renamed or deleted), unrestricted, or
 * confined to the Customer Portal.
 */
function RoleBadge({ role, className = '' }) {
  const [label, tone] = role.isSuperAdmin
    ? ['Full access', 'bg-amber-50 text-amber-700 border-amber-200']
    : role.portalOnly
      ? ['Portal only', 'bg-sky-50 text-sky-700 border-sky-200']
      : role.isSystem
        ? ['Built-in', 'bg-slate-100 text-slate-600 border-slate-200']
        : ['Custom', 'bg-success-50 text-success-600 border-success-200'];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${tone} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * A checkbox with a third state.
 *
 * `indeterminate` is a DOM property and cannot be set from JSX, so it is
 * written through a ref. The module rows need it: "some of the sub-modules
 * below have this" is neither ticked nor clear, and showing it as clear would
 * invite an admin to tick it and silently widen access they had deliberately
 * narrowed. It is always interactive — there is no locked or disabled state
 * anywhere in this matrix.
 */
function TriCheckbox({ state, onChange, title, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      onChange={onChange}
      title={title}
      className={`w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export const PermissionMatrix = () => {
  const { roles, registry, users, loading, fetchRoleMatrix, fetchUsers, updateRole, createRole, deleteRole } =
    useAdminStore();
  const { user, fetchUser } = useUserStore();

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(new Map());
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');

  // ---- presentation only -------------------------------------------------
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('permissions');
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(false);
  const [menuFor, setMenuFor] = useState(null);

  useEffect(() => {
    fetchRoleMatrix();
  }, [fetchRoleMatrix]);

  const selected = useMemo(
    () => roles.find((r) => r._id === selectedId) || roles[0] || null,
    [roles, selectedId],
  );

  // Reset the draft whenever the selected role changes or the server sends a
  // newer copy of it. Keyed on id and updatedAt rather than on the role object,
  // which is a fresh reference on every store update and would throw away an
  // in-progress edit on each render.
  const selectedId_ = selected?._id;
  const selectedUpdatedAt = selected?.updatedAt;
  const selectedGrants = selected?.grants;
  useEffect(() => {
    if (!selectedId_) return;
    setDraft(mergedInitialGrants(selected));
    setTab('permissions');

    /**
     * Open the modules this role actually has EXPLICIT grants in.
     *
     * Baseline is deliberately excluded from this decision: a super-admin role
     * whose baseline expands to every module would otherwise open all of them
     * on first click, which is a wall of pre-ticked rows rather than a useful
     * default. The modules with an explicit grant are the answer to "what was
     * this role specifically set up to do", which is the question somebody had
     * when they clicked it.
     */
    const granted = new Set((selectedGrants || []).map((g) => g.module));
    setExpanded(granted.size > 0 ? granted : new Set());
    // selectedGrants and the role's baselineGrants (read inside
    // mergedInitialGrants) are intentionally not depended on: a save returns
    // new array references every time, and depending on them would reset the
    // draft mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId_, selectedUpdatedAt]);

  /** The Users tab reads the account list, which this screen does not load. */
  useEffect(() => {
    if (tab === 'users' && users.length === 0) fetchUsers();
  }, [tab, users.length, fetchUsers]);

  /**
   * Every cell in the matrix is an ordinary, freely-toggleable checkbox — see
   * `mergedInitialGrants` for what seeds it and why unchecking a cell that
   * came from the role's baseline is honest rather than disabled.
   */
  const isChecked = (moduleKey, subKey, action) =>
    draft.get(`${moduleKey}.${subKey}`)?.has(action) || false;

  const toggle = (moduleKey, subKey, action) => {
    setDraft((prev) => toggleCell(prev, moduleKey, subKey, action));
  };

  /** Tick or clear every available action on one sub-module. */
  const toggleRow = (moduleKey, sub) => {
    const id = `${moduleKey}.${sub.key}`;
    const current = draft.get(id) || new Set();
    const allOn = sub.actions.every((a) => current.has(a));
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(id, allOn ? new Set() : new Set(sub.actions));
      return next;
    });
  };

  // ---- module-level bulk control -----------------------------------------

  /** The sub-modules of `mod` that offer `action` at all. */
  const cellsFor = (mod, action) => mod.submodules.filter((s) => s.actions.includes(action));

  /** 'none' when the action does not apply anywhere in the module. */
  const moduleState = (mod, action) => {
    const cells = cellsFor(mod, action);
    if (cells.length === 0) return 'none';
    const on = cells.filter((s) => isChecked(mod.key, s.key, action)).length;
    return on === 0 ? 'off' : on === cells.length ? 'all' : 'some';
  };

  /** Grant or clear one action across every sub-module in a whole module. */
  const toggleModuleAction = (mod, action) => {
    const cells = cellsFor(mod, action);
    if (cells.length === 0) return;
    const allOn = cells.every((s) => isChecked(mod.key, s.key, action));

    setDraft((prev) => {
      const next = new Map(prev);
      for (const sub of cells) {
        const id = `${mod.key}.${sub.key}`;
        const actions = new Set(next.get(id) || []);
        if (allOn) actions.delete(action);
        else actions.add(action);
        next.set(id, actions);
      }
      return next;
    });
  };

  const toggleExpanded = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * "Unsaved changes" compares against the SEEDED state (baseline union
   * grants), not against `selected.grants` alone — otherwise every role would
   * open already "dirty" the moment a baseline cell's tick appeared in the
   * draft but not in the stored grants list.
   */
  const dirty = selected
    ? !sameGrants(mapToGrants(draft), mapToGrants(mergedInitialGrants(selected)))
    : false;

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await updateRole(selected._id, { grants: mapToGrants(draft) });
    setSaving(false);

    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`Saved permissions for ${selected.name}.`);

    // The signed-in admin may have just changed their OWN role. Re-reading the
    // profile refreshes their sidebar and their own permission set, rather than
    // leaving them on a menu that no longer matches what the server will allow.
    if (user?.role === selected.name) fetchUser();
  };

  const handleCreate = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    const res = await createRole({ name, description: '', grants: [] });
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`Role "${name}" created. It starts with no access.`);
    setNewRoleName('');
    setCreating(false);
    setSelectedId(res.role._id);
  };

  const handleDelete = async () => {
    if (!selected) return;
    const res = await deleteRole(selected._id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`Role "${selected.name}" deleted.`);
    setSelectedId(null);
  };

  /**
   * Start from another role's permissions.
   *
   * Loads them into the DRAFT only — nothing is written until Save, so a copy
   * taken by mistake is undone by Cancel. The source role is untouched.
   */
  const copyFrom = (sourceId) => {
    const source = roles.find((r) => r._id === sourceId);
    if (!source) return;
    // The source's EFFECTIVE permissions, baseline included — copying only its
    // explicit grants would miss whatever it holds through its own baseline,
    // which does not travel with the name and so must be copied explicitly.
    setDraft(mergedInitialGrants(source));
    toast.success(`Copied ${source.name}'s permissions. Nothing is saved until you press Save.`);
  };

  const shownRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q),
    );
  }, [roles, search]);

  /** Accounts holding this role. Matched by NAME, which is how a User stores it. */
  const roleUsers = useMemo(
    () => (selected ? users.filter((u) => u.role === selected.name) : []),
    [users, selected],
  );

  if (!canManageRoles(user)) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <ShieldCheck className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-sm font-semibold text-slate-700">
            You do not have permission to manage roles.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && !registry) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  const actions = registry?.actions || [];

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Heading ----------------------------------------------------- */}
      <div>
        <nav aria-label="Breadcrumb" className="text-[11px] font-semibold text-slate-400 mb-1.5">
          Administration <span className="mx-1 text-slate-300">/</span>
          <span className="text-slate-600">Roles &amp; Permissions</span>
        </nav>
        <h2 className="text-xl font-bold text-slate-900">Roles &amp; Permissions</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Create and manage roles, and set access to modules and sub-modules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        {/* ---- Roles ----------------------------------------------------- */}
        <Card>
          <CardContent className="p-0">
            <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Roles</h3>
              <Button size="xs" variant="primary" onClick={() => setCreating(true)}>
                <Plus size={13} className="mr-1" /> New Role
              </Button>
            </header>

            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-slate-400 pointer-events-none"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search roles..."
                  aria-label="Search roles"
                  className="pl-8 py-1.5 text-xs"
                />
              </div>
            </div>

            {creating && (
              <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-col gap-2">
                <Input
                  autoFocus
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Role name, e.g. Dispatch Supervisor"
                  aria-label="New role name"
                  className="text-xs"
                />
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="primary" onClick={handleCreate} disabled={!newRoleName.trim()}>
                    Create
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => { setCreating(false); setNewRoleName(''); }}
                  >
                    <X size={13} />
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  A new role starts with no access at all. Grant it what it needs on the right.
                </p>
              </div>
            )}

            <div className="p-2 flex flex-col gap-1 max-h-[32rem] overflow-y-auto">
              {shownRoles.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-slate-400">
                  No role matches “{search}”.
                </p>
              ) : (
                shownRoles.map((role) => {
                  const active = selected?._id === role._id;
                  return (
                    <div key={role._id} className="relative">
                      <button
                        type="button"
                        onClick={() => setSelectedId(role._id)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full text-left flex items-center gap-2.5 pl-3 pr-8 py-2.5 rounded-lg border transition-colors ${
                          active
                            ? 'bg-primary-50 border-primary-200'
                            : 'border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <RoleAvatar name={role.name} size={34} />

                        {/*
                          NO KIND BADGE IN THE LIST.

                          "Custom" / "Built-in" / "Full access" sat at the end of
                          every row and took enough width that the names it sat
                          beside were truncated — a list of "Sales Mana…" and
                          "Super…" where the one thing you pick a role by was the
                          thing being cut.

                          The badge is worth its space in the panel on the right,
                          where the role is the subject and there is room for it.
                          Here the compact icons carry the only two kinds that
                          change what you can do, and the NAME gets the width.
                        */}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`text-[13px] font-bold truncate ${
                                active ? 'text-primary-800' : 'text-slate-800'
                              }`}
                            >
                              {role.name}
                            </span>
                            {role.isSuperAdmin && (
                              <ShieldCheck
                                size={12}
                                className="shrink-0 text-amber-500"
                                aria-label="Full access"
                              />
                            )}
                            {role.portalOnly && (
                              <Store size={12} className="shrink-0 text-sky-500" aria-label="Portal only" />
                            )}
                          </span>
                          <span className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-400 font-semibold">
                            <Users size={10} />
                            {role.userCount ?? 0} {role.userCount === 1 ? 'user' : 'users'}
                          </span>
                        </span>
                      </button>

                      {/* The overflow sits OUTSIDE the button — a button inside
                          a button is invalid and the inner one stops working. */}
                      {!role.isSystem && (
                        <button
                          type="button"
                          onClick={() => setMenuFor(menuFor === role._id ? null : role._id)}
                          aria-label={`Actions for ${role.name}`}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                        >
                          <MoreVertical size={14} />
                        </button>
                      )}

                      {menuFor === role._id && (
                        <div className="absolute right-1 top-full z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white shadow-enterprise-lg py-1">
                          <button
                            type="button"
                            onClick={() => { setSelectedId(role._id); setEditing(true); setMenuFor(null); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Edit role
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSelectedId(role._id); setMenuFor(null); handleDelete(); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-error-600 hover:bg-error-50"
                          >
                            Delete role
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---- The role --------------------------------------------------- */}
        {!selected ? (
          <Card>
            <CardContent className="p-8 text-center text-slate-500">No roles found.</CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 flex flex-col">
              {/* Role header */}
              <header className="flex flex-wrap items-start gap-3 px-5 py-4 border-b border-slate-100">
                <RoleAvatar name={selected.name} size={44} />

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{selected.name}</h3>
                    <RoleBadge role={selected} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selected.description || 'No description yet.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil size={13} className="mr-1.5" />
                    Edit Role
                  </Button>
                  {!selected.isSystem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDelete}
                      aria-label={`Delete ${selected.name}`}
                    >
                      <Trash2 size={15} className="text-error-600" />
                    </Button>
                  )}
                </div>
              </header>

              {/* Tabs + copy */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 border-b border-slate-100">
                <div role="tablist" className="flex items-center gap-1 -mb-px">
                  {[
                    { key: 'permissions', label: 'Permissions' },
                    { key: 'users', label: `Users (${selected.userCount ?? 0})` },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.key}
                      onClick={() => setTab(t.key)}
                      className={`px-3 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                        tab === t.key
                          ? 'text-primary-700 border-primary-600'
                          : 'text-slate-500 border-transparent hover:text-slate-800'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'permissions' && roles.length > 1 && (
                  <label className="flex items-center gap-1.5 py-2 text-[11px] font-bold text-primary-700">
                    <Copy size={12} />
                    <span className="sr-only sm:not-sr-only">Copy from role</span>
                    <select
                      value=""
                      onChange={(e) => { copyFrom(e.target.value); e.target.value = ''; }}
                      aria-label="Copy permissions from another role"
                      className="text-[11px] font-semibold text-slate-600 bg-transparent border border-slate-200 rounded-md px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Choose…</option>
                      {roles
                        .filter((r) => r._id !== selected._id)
                        .map((r) => (
                          <option key={r._id} value={r._id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>

              {tab === 'users' ? (
                <UsersTab role={selected} rows={roleUsers} loading={loading} />
              ) : (
                <>
                  {/* Notices */}
                  <div className="flex flex-col gap-2 px-5 pt-4 empty:hidden">
                    {selected.isSuperAdmin && (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                        <p className="text-xs font-semibold">
                          This role has full access to the entire ERP, including modules added in
                          the future. That cannot be narrowed here - build a role with the specific
                          access you want instead.
                        </p>
                      </div>
                    )}

                    {selected.portalOnly && (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-800">
                        <Store size={16} className="mt-0.5 shrink-0" />
                        <p className="text-xs font-semibold">
                          This role is confined to the Customer Portal. Anything granted outside it
                          is ignored by the server, so those cells are shown but never take effect.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* The matrix */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-5 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                            Module / Sub-module
                          </th>
                          {actions.map((action) => (
                            <th
                              key={action}
                              className="px-3 py-2.5 w-20 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wide"
                            >
                              {ACTION_LABELS[action] || action}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {(registry?.modules || []).map((mod) => {
                          const portalFenced = selected.portalOnly && mod.key !== 'customer_portal';
                          const open = expanded.has(mod.key);

                          return (
                            <ModuleRows
                              key={mod.key}
                              mod={mod}
                              actions={actions}
                              open={open}
                              onToggleOpen={() => toggleExpanded(mod.key)}
                              portalFenced={portalFenced}
                              moduleState={moduleState}
                              toggleModuleAction={toggleModuleAction}
                              isChecked={isChecked}
                              toggle={toggle}
                              toggleRow={toggleRow}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <footer className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50/60">
                    {dirty && (
                      <span className="mr-auto text-[11px] font-semibold text-warning-600">
                        Unsaved changes
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDraft(mergedInitialGrants(selected))}
                      disabled={!dirty || saving}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" onClick={handleSave} disabled={saving || !dirty}>
                      {saving ? (
                        <Loader2 className="animate-spin mr-2" size={15} />
                      ) : (
                        <Save size={15} className="mr-2" />
                      )}
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </footer>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {editing && selected && (
        <EditRoleModal
          role={selected}
          onClose={() => setEditing(false)}
          onSave={async (updates) => {
            const res = await updateRole(selected._id, updates);
            if (!res.success) {
              toast.error(res.error);
              return false;
            }
            toast.success('Role updated.');
            setEditing(false);
            return true;
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One module and its sub-modules
// ---------------------------------------------------------------------------

/**
 * A module row, and its sub-module rows when open.
 *
 * Returns a fragment of `<tr>`s rather than a nested table, so every cell in
 * the screen sits in ONE column grid — which is the entire point of a matrix
 * and the thing a card-per-module layout cannot give.
 */
function ModuleRows({
  mod, actions, open, onToggleOpen, portalFenced,
  moduleState, toggleModuleAction, isChecked, toggle, toggleRow,
}) {
  // `portalFenced` is informational, not a restriction — a portal-only role's
  // grants outside the Customer Portal are simply ignored at authorization
  // time (see the banner above the matrix), so the row is dimmed to say so but
  // every checkbox in it still works like any other.
  const muted = portalFenced ? 'opacity-50' : '';

  return (
    <>
      <tr className={`bg-slate-50/40 hover:bg-slate-50 transition-colors ${muted}`}>
        <td className="px-5 py-2.5">
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            className="flex items-center gap-2 text-left"
          >
            <span className="text-slate-400">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <Folder size={14} className="shrink-0 text-slate-400" />
            <span className="text-[13px] font-bold text-slate-800">{mod.label}</span>
            <span className="text-[11px] text-slate-400">({mod.submodules.length})</span>
          </button>
          {mod.description && (
            <p className="ml-[52px] text-[11px] text-slate-400">{mod.description}</p>
          )}
        </td>

        {actions.map((action) => {
          const state = moduleState(mod, action);
          if (state === 'none') {
            return (
              <td key={action} className="px-3 py-2.5 text-center text-slate-200 select-none">
                &mdash;
              </td>
            );
          }
          return (
            <td key={action} className="px-3 py-2.5 text-center">
              <TriCheckbox
                state={state}
                onChange={() => toggleModuleAction(mod, action)}
                title={`${ACTION_LABELS[action] || action} across all of ${mod.label}`}
              />
            </td>
          );
        })}
      </tr>

      {open &&
        mod.submodules.map((sub) => (
          <tr key={sub.key} className={`hover:bg-slate-50/70 transition-colors ${muted}`}>
            <td className="px-5 py-2">
              <button
                type="button"
                onClick={() => toggleRow(mod.key, sub)}
                className="ml-[30px] text-left text-[13px] font-semibold text-slate-600 hover:text-primary-700"
              >
                {sub.label}
              </button>
              {!sub.path && (
                // Says plainly why there is no menu entry for this row, so its
                // absence from the sidebar does not read as a bug.
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                  Capability
                </span>
              )}
            </td>

            {actions.map((action) => {
              const available = sub.actions.includes(action);
              if (!available) {
                return (
                  <td key={action} className="px-3 py-2 text-center text-slate-200 select-none">
                    &mdash;
                  </td>
                );
              }

              return (
                <td key={action} className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={isChecked(mod.key, sub.key, action)}
                    onChange={() => toggle(mod.key, sub.key, action)}
                    aria-label={`${ACTION_LABELS[action] || action} — ${mod.label} / ${sub.label}`}
                    className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer"
                  />
                </td>
              );
            })}
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

/** Who holds this role. Read-only — accounts are managed in User Management. */
function UsersTab({ role, rows, loading }) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin text-slate-400" size={26} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-10 text-center">
        <Users className="mx-auto mb-3 text-slate-300" size={28} />
        <p className="text-sm font-semibold text-slate-600">
          No account holds the {role.name} role.
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Assign it to somebody from User Management.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 max-h-[32rem] overflow-y-auto">
      {rows.map((u) => (
        <li key={u._id} className="flex items-center gap-3 px-5 py-3">
          <RoleAvatar name={u.user || u.email || '?'} size={32} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-slate-900 truncate">
              {u.user || u.email}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-slate-400 truncate">
              <Mail size={10} />
              {u.email}
            </span>
          </span>
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${
              (u.status || 'Active') === 'Active'
                ? 'bg-success-50 text-success-600 border-success-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
          >
            {u.status || 'Active'}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Edit role
// ---------------------------------------------------------------------------

/**
 * Rename a role and describe it.
 *
 * The name field is disabled for a built-in role and says why. The server
 * refuses that rename anyway - see `updateRole` in role.controller.js - so this
 * is the same rule stated before the attempt rather than after it.
 */
function EditRoleModal({ role, onClose, onSave }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [saving, setSaving] = useState(false);

  const changed = name.trim() !== role.name || description !== (role.description || '');

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const updates = { description };
    if (!role.isSystem && name.trim() !== role.name) updates.name = name.trim();
    await onSave(updates);
    setSaving(false);
  };

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${role.name}`} size="md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Role name"
          value={name}
          maxLength={60}
          disabled={role.isSystem}
          onChange={(e) => setName(e.target.value)}
          helperText={
            role.isSystem
              ? 'Built-in roles cannot be renamed. Their permissions can be changed freely.'
              : undefined
          }
        />

        <Textarea
          label="Description"
          rows={3}
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this role is for, e.g. Can manage sales and view reports."
          helperText="Shown beside the role wherever it appears."
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!changed}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PermissionMatrix;
