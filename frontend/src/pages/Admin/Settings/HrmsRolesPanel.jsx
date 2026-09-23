import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info, Loader2 } from 'lucide-react';

import { Badge } from '../../../components/ui/Badge';
import { Card, CardContent } from '../../../components/ui/Card';

/**
 * HRMS Roles — the same read-only view HRMS Settings shows, surfaced here so
 * an administrator configuring access does not have to leave Roles &
 * Permissions to see it.
 *
 * This is deliberately NOT a second matrix editor. AD-3 fixes eight HRMS
 * roles in code (`shared/permissions/matrix.js`); the data below comes from
 * the same `GET /roles/hrms` call, which the backend answers with the exact
 * function the HRMS settings page itself calls — one implementation, two
 * places to read it. Role MEMBERSHIP is changed on the employee record, not
 * here or there.
 */
export function HrmsRolesPanel({ data, loading, error }) {
  const [openRole, setOpenRole] = useState(null);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center p-12">
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-600">
          HRMS roles could not be loaded: {error}
        </CardContent>
      </Card>
    );
  }

  const roles = data?.roles ?? [];
  const selected = roles.find((r) => r.key === openRole) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-600">
          Eight built-in roles are defined in code (module &times; action &times; scope), so they
          cannot drift between environments and are never edited. Any <strong>custom</strong>{' '}
          roles below were built in{' '}
          <Link to="/hrms/settings/roles" className="font-medium text-primary-700 underline">
            HRMS Settings &rsaquo; Roles &amp; Permissions
          </Link>
          , which is also where they are changed. To change what somebody can do in HRMS, change
          which roles they hold on{' '}
          <Link to="/hrms/employees" className="font-medium text-primary-700 underline">
            their employee record
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Role</th>
                  <th scope="col" className="px-4 py-2 font-medium">Key</th>
                  <th scope="col" className="px-4 py-2 font-medium">Type</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">People</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Permissions</th>
                  <th scope="col" className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {roles.map((role) => (
                  <tr key={role.key}>
                    <td className="px-4 py-2 font-medium text-slate-900">{role.label}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                        {role.key}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={role.isSystem ? 'neutral' : 'primary'}>
                        {role.isSystem ? 'In code' : 'Custom'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{role.userCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{role.permissions.length}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="text-sm font-medium text-primary-700 hover:underline"
                        onClick={() => setOpenRole(openRole === role.key ? null : role.key)}
                      >
                        {openRole === role.key ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              {selected.label} &mdash; {selected.permissions.length} permissions
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Module</th>
                    <th scope="col" className="px-3 py-2 font-medium">Action</th>
                    <th scope="col" className="px-3 py-2 font-medium">Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...selected.permissions]
                    .sort((a, b) => a.module.localeCompare(b.module) || a.action.localeCompare(b.action))
                    .map((p) => (
                      <tr key={`${p.module}|${p.action}|${p.scope}`}>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-700">{p.module}</td>
                        <td className="px-3 py-1.5">{p.action}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant={p.scope === 'org' ? 'primary' : 'neutral'}>{p.scope}</Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              A wider scope satisfies a narrower one &mdash; an <code>org</code> grant also passes a
              <code> team</code> or <code>self</code> check.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default HrmsRolesPanel;
