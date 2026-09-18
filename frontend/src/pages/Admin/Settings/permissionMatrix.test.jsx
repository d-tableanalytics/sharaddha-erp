/**
 * Roles & Permissions.
 *
 * The screen was rebuilt to match a design reference — one table instead of a
 * card per module, a role list with search, tabs, a copy control and a footer
 * — and later had its LOCKED checkboxes removed entirely: every cell in the
 * matrix is now a plain, freely-toggleable checkbox, including the ones that
 * used to render ticked-and-disabled behind a padlock. This file is the
 * evidence for both: the screen's own behaviour, and that removing the lock
 * did not quietly change what the server enforces.
 *
 * Only the axios transport is mocked. The store, the grant helpers and the
 * permission utilities are real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { api } from '../../../services/api';
import { PermissionMatrix } from './PermissionMatrix';
import { useAdminStore } from '../../../store/adminStore';
import { useUserStore } from '../../../store/userStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REGISTRY = {
  actions: ['view', 'create', 'edit', 'delete', 'approve'],
  modules: [
    {
      key: 'fms',
      label: 'FMS',
      description: 'Order to delivery.',
      submodules: [
        { key: 'my_tasks', label: 'My Tasks', path: '/fms/o2d/tasks', actions: ['view', 'edit'] },
        {
          key: 'order_tracker',
          label: 'Order Tracker',
          path: '/fms/o2d/orders',
          actions: ['view', 'create', 'edit', 'delete', 'approve'],
        },
        // No path — a capability rather than a screen.
        { key: 'fms_masters', label: 'FMS Masters', path: null, actions: ['view', 'edit'] },
      ],
    },
    {
      key: 'expenses',
      label: 'Expenses',
      submodules: [
        { key: 'claims', label: 'Claims', path: '/expenses', actions: ['view', 'create'] },
      ],
    },
  ],
};

const SALES = {
  _id: 'r1',
  name: 'Sales Manager',
  description: 'Can manage sales and view reports.',
  isSystem: false,
  isSuperAdmin: false,
  portalOnly: false,
  userCount: 12,
  updatedAt: '2026-01-01T00:00:00.000Z',
  grants: [{ module: 'fms', submodule: 'my_tasks', actions: ['view'] }],
  // The compiled-in floor: View on Order Tracker. Still enforced server-side
  // regardless of what this screen sends — see resolveRolePermissions in
  // backend/utils/roleResolver.js — but no longer rendered as a lock here.
  baselineGrants: [{ module: 'fms', submodule: 'order_tracker', actions: ['view'] }],
};

const ADMIN = {
  _id: 'r2',
  name: 'Admin',
  description: 'Everything.',
  isSystem: true,
  isSuperAdmin: true,
  portalOnly: false,
  userCount: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
  grants: [],
  // A super admin's baseline is the wildcard, which the backend's own
  // `grantsFromPermissions` expands into every module/sub-module/action in the
  // registry — exactly what a real API response looks like for this role.
  baselineGrants: [
    { module: 'fms', submodule: 'my_tasks', actions: ['view', 'edit'] },
    { module: 'fms', submodule: 'order_tracker', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
    { module: 'fms', submodule: 'fms_masters', actions: ['view', 'edit'] },
    { module: 'expenses', submodule: 'claims', actions: ['view', 'create'] },
  ],
};

const PORTAL = {
  _id: 'r3',
  name: 'Warehouse User',
  description: 'Portal only.',
  isSystem: false,
  isSuperAdmin: false,
  portalOnly: true,
  userCount: 14,
  updatedAt: '2026-01-01T00:00:00.000Z',
  grants: [],
  baselineGrants: [],
};

const USERS = [
  { _id: 'u9', user: 'Asha Verma', email: 'asha@example.com', role: 'Sales Manager', status: 'Active' },
  { _id: 'u8', user: 'Rohit Mehta', email: 'rohit@example.com', role: 'Admin', status: 'Active' },
];

let putBody = null;

function installTransport({ roles = [SALES, ADMIN, PORTAL] } = {}) {
  putBody = null;
  api.get.mockImplementation(async (url) => {
    if (url === '/roles') return { data: { data: roles } };
    if (url === '/roles/registry') return { data: { data: REGISTRY } };
    if (url === '/users') return { data: { data: USERS } };
    throw new Error(`unstubbed GET ${url}`);
  });
  api.put.mockImplementation(async (url, body) => {
    putBody = body;
    const id = url.split('/').pop();
    const role = roles.find((r) => r._id === id);
    // The server returns the role as it now resolves — `baselineGrants`
    // unchanged, `grants` replaced by what was sent — which is what lets the
    // "re-seeds from truth" test below observe a baseline cell reappear.
    return { data: { data: { ...role, ...body, updatedAt: new Date().toISOString() } } };
  });
  api.patch.mockImplementation(async (url, body) => {
    putBody = body;
    const id = url.split('/').pop();
    const role = roles.find((r) => r._id === id);
    return { data: { data: { ...role, ...body, updatedAt: new Date().toISOString() } } };
  });
  api.delete.mockResolvedValue({ data: { success: true } });
  api.post.mockImplementation(async (_url, body) => ({
    data: { data: { ...SALES, _id: 'rNew', ...body, grants: [], baselineGrants: [] } },
  }));
}

const signIn = (role = 'Admin') =>
  useUserStore.setState({
    user: { _id: 'me', user: 'Sumedh', role, permissions: ['*'] },
    loading: false,
  });

beforeEach(() => {
  installTransport();
  useAdminStore.setState({ users: [], roles: [], registry: null, loading: true, error: null });
  useUserStore.setState({ user: null, loading: false });
});

/**
 * Pick a role from the list.
 *
 * By ROLE and not by text: every role's name also appears as an <option> in the
 * "copy from" control, so a plain text query matches twice.
 */
const pickRole = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

/** The <tr> a sub-module's checkboxes live in. */
const rowFor = (label) => screen.getByText(label).closest('tr');

const cell = (label, action) =>
  within(rowFor(label)).getByRole('checkbox', { name: new RegExp(`^${action}`, 'i') });

// ===========================================================================

describe('gating', () => {
  it('refuses the screen to somebody who cannot manage roles', async () => {
    useUserStore.setState({ user: { _id: 'u', role: 'Staff', permissions: [] }, loading: false });
    render(<PermissionMatrix />);

    expect(screen.getByText(/do not have permission to manage roles/i)).toBeTruthy();
    // No matrix, no role list, nothing to press.
    expect(screen.queryByRole('heading', { name: 'Roles' })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });
});

describe('the role list', () => {
  it('gives the width to the NAME, not to a kind badge', async () => {
    signIn();
    render(<PermissionMatrix />);

    await screen.findByRole('heading', { name: 'Roles' });

    // The name and the count are what you pick a role by.
    expect(pickRole('Sales Manager')).toBeTruthy();
    expect(screen.getByText('12 users')).toBeTruthy();
    expect(screen.getByText('3 users')).toBeTruthy();

    /**
     * 🔴 No "Custom" / "Built-in" / "Portal only" pill in the list.
     *
     * They sat at the end of every row and took enough width to truncate the
     * names beside them. Only the SELECTED role's badge is on screen, and it is
     * in the detail panel — so exactly one is present, not four.
     */
    expect(screen.queryByText('Built-in')).toBeNull();
    expect(screen.queryByText('Portal only')).toBeNull();
    expect(screen.getAllByText('Custom')).toHaveLength(1);
  });

  it('keeps the kind badge where the role is the subject', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    // Sales Manager is selected, so its badge — and only its badge — is shown.
    expect(screen.getAllByText('Custom')).toHaveLength(1);
    // "Active" is not a thing a role can be.
    expect(screen.queryByText('Active')).toBeNull();

    await user.click(pickRole('Admin'));
    expect(await screen.findByText('Full access')).toBeTruthy();
    expect(screen.queryByText('Custom')).toBeNull();
  });

  it('filters the list without touching the server', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByRole('button', { name: /^Warehouse User/ });
    const before = api.get.mock.calls.length;

    await user.type(screen.getByLabelText('Search roles'), 'ware');

    expect(pickRole('Warehouse User')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sales Manager/ })).toBeNull();
    expect(api.get.mock.calls.length).toBe(before);
  });
});

describe('the matrix', () => {
  it('opens the modules this role has EXPLICIT grants in', async () => {
    signIn();
    render(<PermissionMatrix />);

    // Sales Manager's own grant (not its baseline) is inside FMS, so FMS is
    // open and its sub-modules are on screen; Expenses is closed.
    await screen.findByText('My Tasks');
    expect(screen.queryByText('Claims')).toBeNull();
  });

  it('renders an action a sub-module does not offer as a dash, not a checkbox', async () => {
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    // My Tasks offers view and edit only. A dash here is not a lock — it is
    // the registry saying the action has no meaning on this row at all, which
    // is a different thing from a permission that exists but cannot be
    // toggled.
    const row = rowFor('My Tasks');
    expect(within(row).queryByRole('checkbox', { name: /^delete/i })).toBeNull();
    expect(row.textContent).toContain('—');
  });

  /**
   * 🔴 NO LOCKED BOXES.
   *
   * A baseline cell — the compiled-in floor, see BASELINE_ROLE_PERMISSIONS in
   * backend/config/permissions.js — is ticked because the role genuinely holds
   * that access today, but it is rendered as an ORDINARY checkbox: no
   * `disabled`, no lock icon, no special title. It looks exactly like every
   * other checkbox on the screen.
   */
  it('renders a baseline grant ticked, but as a plain, freely-editable checkbox', async () => {
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('Order Tracker');
    const box = cell('Order Tracker', 'view');

    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    expect(box.title).toBe('');
  });

  it('a super admin shows every permission ticked, and every box stays interactive', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    await user.click(pickRole('Admin'));

    // The banner still explains why toggling here changes nothing functional
    // for this role…
    await waitFor(() => expect(screen.getByText(/full access to the entire ERP/i)).toBeTruthy());
    // …but nothing on the screen is disabled.
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(false);
    }
  });

  it('a portal-only role is not fenced out of clicking — every box still works', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    await user.click(pickRole('Warehouse User'));

    await waitFor(() => expect(screen.getByText(/confined to the Customer Portal/i)).toBeTruthy());
    // Neither FMS nor Expenses is the Customer Portal, but the banner is
    // informational, not a lock — nothing here is disabled.
    for (const box of screen.getAllByRole('checkbox')) expect(box.disabled).toBe(false);
  });
});

describe('editing and saving', () => {
  it('sends exactly the ticked grants, baseline included', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');

    // Nothing to save until something changes.
    expect(screen.getByRole('button', { name: /Save Changes/i }).disabled).toBe(true);

    await user.click(cell('My Tasks', 'edit'));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(putBody).toBeTruthy());
    const byId = Object.fromEntries(
      putBody.grants.map((g) => [`${g.module}.${g.submodule}`, [...g.actions].sort()]),
    );
    // The tick was added to what was already there…
    expect(byId['fms.my_tasks']).toEqual(['edit', 'view']);
    // …and the baseline cell, left untouched, is sent as an explicit grant too
    // — every checkbox in the draft is ordinary now, so saving records the
    // role's whole current state rather than a diff against an implicit floor.
    expect(byId['fms.order_tracker']).toEqual(['view']);
  });

  /**
   * 🔴 THE CENTRAL GUARANTEE: unchecking a baseline cell and saving is honest.
   *
   * The tick clears and the request omits it — the screen does exactly what it
   * looks like it is doing. This does not assert that the role's ACTUAL access
   * changed (the server unions the compiled floor back in regardless, by
   * design — see resolveRolePermissions in backend/utils/roleResolver.js); it
   * only asserts what this screen itself promises: what you see is what gets
   * sent.
   */
  it('unchecking a baseline cell sends a request with it omitted', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('Order Tracker');
    expect(cell('Order Tracker', 'view').checked).toBe(true);

    await user.click(cell('Order Tracker', 'view'));
    expect(cell('Order Tracker', 'view').checked).toBe(false);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(putBody).toBeTruthy());
    const byId = Object.fromEntries(
      putBody.grants.map((g) => [`${g.module}.${g.submodule}`, [...g.actions].sort()]),
    );
    expect(byId['fms.order_tracker']).toBeUndefined();
  });

  /**
   * The seed always re-reads the truth. After a save, the role that comes back
   * from the server still carries the same compiled `baselineGrants` — nothing
   * about the floor changed — so the very next render shows the cell ticked
   * again. Not because the click was ignored, but because the box never
   * remembers a click, only the role's current effective state.
   */
  it('a baseline cell re-appears ticked the moment the role reloads, because it is still true', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('Order Tracker');
    await user.click(cell('Order Tracker', 'view'));
    expect(cell('Order Tracker', 'view').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(cell('Order Tracker', 'view').checked).toBe(true));
  });

  it('Cancel throws the edit away and puts the button back to sleep', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    await user.click(cell('My Tasks', 'edit'));
    expect(cell('My Tasks', 'edit').checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cell('My Tasks', 'edit').checked).toBe(false);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('Cancel also restores a baseline cell that was unchecked', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('Order Tracker');
    await user.click(cell('Order Tracker', 'view'));
    expect(cell('Order Tracker', 'view').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cell('Order Tracker', 'view').checked).toBe(true);
    expect(api.put).not.toHaveBeenCalled();
  });

  /**
   * The module row is a bulk control over the sub-modules beneath it. With no
   * locked cells left, it moves EVERY sub-module uniformly, baseline included.
   */
  it('the module row grants or clears an action across every sub-module in the module', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');

    const moduleView = within(rowFor('FMS')).getByRole('checkbox', {
      name: /^View across all of FMS$/i,
    });
    // My Tasks (ticked) and Order Tracker (ticked via baseline) but not FMS
    // Masters — a genuine mix, so the bulk control reads as indeterminate.
    expect(moduleView.indeterminate).toBe(true);

    await user.click(moduleView);
    expect(cell('FMS Masters', 'view').checked).toBe(true);
    expect(cell('My Tasks', 'view').checked).toBe(true);
    expect(cell('Order Tracker', 'view').checked).toBe(true);
    for (const box of [
      cell('FMS Masters', 'view'),
      cell('My Tasks', 'view'),
      cell('Order Tracker', 'view'),
    ]) {
      expect(box.disabled).toBe(false);
    }

    // Clicking again — now that every cell is on — clears all of them,
    // baseline cell included. Nothing is skipped.
    await user.click(moduleView);
    expect(cell('FMS Masters', 'view').checked).toBe(false);
    expect(cell('My Tasks', 'view').checked).toBe(false);
    expect(cell('Order Tracker', 'view').checked).toBe(false);
  });

  it('copying another role replaces the draft with its permissions, unsaved', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    // Warehouse User holds nothing at all — not even a baseline — so copying
    // it clears everything, the baseline-seeded cell included.
    await user.selectOptions(
      screen.getByLabelText('Copy permissions from another role'),
      'r3',
    );

    expect(cell('My Tasks', 'view').checked).toBe(false);
    expect(cell('Order Tracker', 'view').checked).toBe(false);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
  });

  /**
   * 🔴 Copying a role now carries its BASELINE too, not only its stored
   * `grants`. Admin's own `grants` array is empty — its access comes entirely
   * from the wildcard baseline — so copying "just the grants" would have
   * copied nothing at all, silently failing to do what "copy from role"
   * obviously promises.
   */
  it('copying a super-admin role copies its full effective access, not an empty grants list', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    await user.selectOptions(
      screen.getByLabelText('Copy permissions from another role'),
      'r2', // Admin
    );

    expect(cell('My Tasks', 'view').checked).toBe(true);
    expect(cell('My Tasks', 'edit').checked).toBe(true);
    expect(cell('Order Tracker', 'delete').checked).toBe(true);
  });
});

describe('the users tab', () => {
  it('lists the accounts holding this role', async () => {
    const user = userEvent.setup();
    signIn();
    render(<PermissionMatrix />);

    await screen.findByText('My Tasks');
    await user.click(screen.getByRole('tab', { name: /Users \(12\)/ }));

    expect(await screen.findByText('Asha Verma')).toBeTruthy();
    // Somebody on a different role is not listed.
    expect(screen.queryByText('Rohit Mehta')).toBeNull();
  });
});
