import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Info, Pencil, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Drawer } from "../../../components/ui/Drawer";
import { Input } from "../../../components/ui/Input";
import { Textarea } from "../../../components/ui/Textarea";
import { ConfirmationDialog } from "../../../components/ui/ConfirmationDialog";
import { ErrorState } from "../../../components/hrms/ErrorState";
import { useHrmsPermissions } from "../../../hooks/useHrmsPermissions";
import { settingsApi } from "../../../services/hrms/settings";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from "@shared/permissions/constants.js";
import { PermissionMatrixGrid } from "./PermissionMatrixGrid";
import { applyToggle, parsePermKey, permKey } from "./permissionKeys";

/**
 * Roles & Permissions.
 *
 * ---------------------------------------------------------------------------
 * EVERY ROLE IS A ROW NOW
 * ---------------------------------------------------------------------------
 * All eight built-in roles are seeded as `hrms_roles` documents (never
 * overwritten on restart) alongside any custom roles built on top of them, so
 * every row here is editable the same way: Edit, Deactivate and Delete all
 * work against a real database row and take effect on the next request. The
 * one exception is `hrms_super_admin`, which comes back `protected: true` —
 * it cannot be deleted or deactivated, and the server refuses an edit that
 * would strip its `settings:edit:org` grant, so nobody can lock every admin
 * out of this screen with no way back in.
 *

 * ---------------------------------------------------------------------------
 * WHY THE GRID IS DRIVEN BY SERVER DATA
 * ---------------------------------------------------------------------------
 * `modules`, `actions` and `scopes` all arrive in the same response as the
 * roles. The reference hardcodes them in its component and has drifted from
 * its own union — 19 of 33 modules, 7 of 10 actions — so its builder silently
 * cannot express `payroll/run` or any sub-module. Iterating what the server
 * sends means a module added to the backend appears here with no frontend
 * change, and the two can never disagree about what is grantable.
 */

const EMPTY_FORM = { key: "", label: "", description: "" };

export function RolesTab() {
  const { can } = useHrmsPermissions();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // -- builder state --------------------------------------------------------
  const [editing, setEditing] = useState(null); // role being edited, or 'new'
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await settingsApi.roles());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roles = useMemo(() => data?.roles ?? [], [data]);

  const openBuilder = (role) => {
    setEditing(role ?? "new");
    setForm(
      role
        ? { key: role.key, label: role.label, description: role.description ?? "" }
        : EMPTY_FORM,
    );
    setSelected(
      new Set((role?.permissions ?? []).map((p) => permKey(p.module, p.action, p.scope))),
    );
    setErrors({});
  };

  const toggleActive = async (role) => {
    try {
      await settingsApi.setRoleActive(role.id, !role.active);
      toast.success(
        role.active
          ? `"${role.label}" deactivated — its permissions no longer apply.`
          : `"${role.label}" reactivated.`,
      );
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const closeBuilder = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setSelected(new Set());
  };

  /*
   * Both paths go through `applyToggle`, which resolves the view dependency —
   * see permissionKeys.js. Doing it in the shared helper rather than in each
   * handler is what stops a single checkbox and a "Grant all" disagreeing
   * about whether `edit` implies `view`.
   */
  const actionList = useMemo(() => data?.actions ?? [], [data]);

  const toggle = (module, action, scope) => {
    const key = permKey(module, action, scope);
    setSelected((prev) => applyToggle(prev, [key], !prev.has(key), actionList));
  };

  const bulkToggle = (keys, checked) => {
    setSelected((prev) => applyToggle(prev, keys, checked, actionList));
  };

  const handleSave = async () => {
    // Required fields, reported where they are wrong. `key` only on create —
    // it is immutable afterwards and the input is disabled.
    const nextErrors = {};
    if (editing === "new" && !form.key.trim()) nextErrors.key = "Key required";
    if (!form.label.trim()) nextErrors.label = "Label required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Back to triples. The flat `module|action|scope` string is what keeps the
    // grid simple — a checkbox's state is one Set.has — and `|` is safe
    // because no module, action or scope contains it (sub-modules use `:`).
    const permissions = [...selected].map(parsePermKey);

    setSaving(true);
    try {
      if (editing === "new") {
        await settingsApi.createRole({
          key: form.key.trim(),
          label: form.label.trim(),
          description: form.description.trim() || undefined,
          permissions,
        });
        toast.success("Role created.");
      } else {
        await settingsApi.updateRole(editing.id, {
          label: form.label.trim(),
          description: form.description.trim(),
          permissions,
        });
        toast.success("Role updated.");
      }
      closeBuilder();
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      await settingsApi.deleteRole(deleting.id);
      toast.success(`Role "${deleting.label}" deleted.`);
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (error) {
    return (
      <ErrorState title="Roles could not be loaded" description={error.message} onRetry={load} />
    );
  }

  if (loading) {
    return <div data-testid="roles-skeleton" className="h-64 animate-pulse rounded-lg bg-slate-100" />;
  }

  /*
   * The page itself only needs `settings:view:org` — one step wider than this —
   * so a principal can legitimately reach this tab and hold no right to change
   * anything on it. Without this check they would see New Role, Edit and
   * Delete and collect a 403 from each: a control that cannot work.
   */
  const canBuild = can(M.SETTINGS, A.EDIT, S.ORG);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-600">
          Every role here — the eight built-in roles and any custom ones — is a row you can
          edit, deactivate or delete. The only exception is <strong>Super Admin</strong>, which
          is protected from deletion, deactivation, and from having its settings-access
          permission removed, so nobody can lock every admin out of this screen. To change what
          somebody can do, change which roles they hold on{" "}
          <Link
            to={`${HRMS_ROUTE_PREFIX}/employees`}
            className="font-medium text-primary-700 underline"
          >
            their employee record
          </Link>
          . Every role here also appears alongside the portal's own roles under{" "}
          <Link to="/admin/permissions" className="font-medium text-primary-700 underline">
            Administration &rsaquo; Roles &amp; Permissions
          </Link>
          , which is where HRMS access is granted to a portal role.
        </p>
      </div>

      {canBuild && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => openBuilder(null)}>
            <Plus size={14} className="mr-1.5" /> New Role
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {/* Column order, headings and tag colours per the spec's §5.2. */}
            <tr>
              <th scope="col" className="w-52 px-4 py-2 font-medium">Key</th>
              <th scope="col" className="px-4 py-2 font-medium">Label</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Users</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Permissions</th>
              <th scope="col" className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {roles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No roles yet
                </td>
              </tr>
            )}
            {roles.map((role) => (
              <tr key={role.key}>
                <td className="w-52 px-4 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    {role.key}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium text-slate-900">
                  {role.label}
                  {role.description ? (
                    <span className="block text-xs font-normal text-slate-500">
                      {role.description}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {/*
                      Badges are shown only when something is TRUE of the row —
                      a role that is neither protected nor inactive gets none,
                      which is the normal case; badging every row would make
                      the one that matters harder to spot, not easier.
                    */}
                    {role.protected && (
                      <Badge
                        variant="primary"
                        title="Cannot be deleted, deactivated, or edited to remove settings access."
                      >
                        Protected
                      </Badge>
                    )}
                    {role.active === false && <Badge variant="warning">Inactive</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{role.userCount}</td>
                <td className="px-4 py-2 text-right text-slate-500">
                  {role.permissions.length} rules
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-3">
                    {canBuild && (
                      <>
                        <button
                          type="button"
                          aria-label={`${role.active === false ? "Activate" : "Deactivate"} ${role.label}`}
                          title={
                            role.protected
                              ? "Protected — cannot be deactivated."
                              : role.active === false
                                ? "Restore this role's permissions"
                                : "Withdraw this role's permissions, keeping its assignments"
                          }
                          onClick={() => toggleActive(role)}
                          disabled={role.protected}
                          className="text-slate-400 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400"
                        >
                          {role.active === false ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${role.label}`}
                          title="Edit this role's permissions"
                          onClick={() => openBuilder(role)}
                          className="text-slate-400 hover:text-primary-700"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${role.label}`}
                          title={role.protected ? "Protected — cannot be deleted." : "Delete this role"}
                          onClick={() => setDeleting(role)}
                          disabled={role.protected}
                          className="text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer
        isOpen={editing !== null}
        onClose={closeBuilder}
        // 720px, as the spec's drawer is — wide enough that the matrix's four
        // scope columns fit without horizontal scrolling.
        maxWidth="max-w-[720px]"
        title={editing && editing !== "new" ? `Edit "${editing.label}"` : "New Role"}
        footer={
          // Pinned, so Save stays reachable while a tall permission grid
          // scrolls behind it.
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {selected.size} permission{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeBuilder} disabled={saving}>
                Cancel
              </Button>
              {/*
                Enabled, and validated on click.

                A disabled Save cannot say WHY it is disabled; the required
                fields report themselves inline instead, which is what the
                spec's `rules={[{required:true, message:'Key required'}]}`
                produces when its form is submitted.
              */}
              <Button variant="primary" onClick={handleSave} loading={saving}>
                {editing === "new" ? "Create Role" : "Save Changes"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="role-key" className="mb-1 block text-xs font-semibold text-slate-600">
                Key {editing !== "new" && "(immutable)"}
              </label>
              <Input
                id="role-key"
                value={form.key}
                placeholder="e.g. hrms_regional_manager"
                // The key is what the assignments point at, so renaming one is
                // a data migration rather than an edit — the server refuses it
                // and the field says so rather than letting someone try.
                disabled={editing !== "new"}
                error={errors.key}
                onChange={(e) => {
                  setForm((f) => ({ ...f, key: e.target.value }));
                  if (errors.key) setErrors((prev) => ({ ...prev, key: undefined }));
                }}
              />
              {editing === "new" && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Must start with <code>hrms_</code>; lower-case, digits and underscores.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="role-label" className="mb-1 block text-xs font-semibold text-slate-600">
                Display Label
              </label>
              <Input
                id="role-label"
                value={form.label}
                placeholder="e.g. Regional Manager"
                error={errors.label}
                onChange={(e) => {
                  setForm((f) => ({ ...f, label: e.target.value }));
                  if (errors.label) setErrors((prev) => ({ ...prev, label: undefined }));
                }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="role-desc" className="mb-1 block text-xs font-semibold text-slate-600">
              Description
            </label>
            <Textarea
              id="role-desc"
              rows={2}
              value={form.description}
              placeholder="What is this role for?"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">Permissions</h4>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">
              <strong>self</strong> own records · <strong>team</strong> direct and indirect
              reports · <strong>department</strong> same department · <strong>org</strong> the
              whole company. A wider scope satisfies a narrower one.
            </p>

            <PermissionMatrixGrid
              modules={data?.modules ?? []}
              actions={data?.actions ?? []}
              scopes={data?.scopes ?? []}
              selected={selected}
              onToggle={toggle}
              onBulkToggle={bulkToggle}
            />
          </div>
        </div>
      </Drawer>

      <ConfirmationDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        variant="danger"
        confirmText="Delete role"
        title={deleting ? `Delete "${deleting.label}"?` : ""}
        /*
         * Blocked, not merely warned about.
         *
         * The server refuses this independently (409, naming the count), and
         * that check stays the enforcement point. Disabling the button is what
         * teaches the rule at the moment it applies instead of after a round
         * trip that was never going to succeed.
         */
        confirmDisabled={deleting?.userCount > 0}
        description={
          deleting?.userCount > 0
            ? `${deleting.userCount} user(s) are assigned to this role — you must reassign them first.`
            : "This cannot be undone. Nobody currently holds this role."
        }
      />
    </div>
  );
}

export default RolesTab;
