/**
 * Extra Access — per-account permissions on top of a role.
 *
 * Every checkbox here, role-derived or not, is an ordinary freely-toggleable
 * checkbox: no locked boxes. What keeps that safe is `grantsBeyond` (see
 * grants.test.js for its own unit coverage) — this file is the evidence that
 * the MODAL actually uses it: a role-derived tick can be seen, unticked and
 * reticked, but never ends up written onto the account's own record, which
 * would otherwise let it survive the account being moved to a different role
 * later.
 *
 * Only the axios transport is mocked. The store and the grant helpers are real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { api } from '../../services/api';
import { UserAccessModal } from './UserAccessModal';
import { useAdminStore } from '../../store/adminStore';

const REGISTRY = {
  actions: ['view', 'create', 'edit', 'delete', 'approve'],
  modules: [
    {
      key: 'fms',
      label: 'FMS',
      submodules: [
        { key: 'my_tasks', label: 'My Tasks', path: '/x', actions: ['view', 'edit'] },
        {
          key: 'order_tracker',
          label: 'Order Tracker',
          path: '/x',
          actions: ['view', 'create', 'edit', 'delete', 'approve'],
        },
      ],
    },
    {
      key: 'expenses',
      label: 'Expenses',
      submodules: [{ key: 'claims', label: 'Claims', path: '/x', actions: ['view', 'create'] }],
    },
  ],
};

const SALES_ROLE = {
  _id: 'r1',
  name: 'Sales Manager',
  isSuperAdmin: false,
  portalOnly: false,
  // What the role RESOLVES to today — baseline plus its own stored grants.
  effectiveGrants: [{ module: 'fms', submodule: 'order_tracker', actions: ['view'] }],
};

const ADMIN_ROLE = {
  _id: 'r2',
  name: 'Admin',
  isSuperAdmin: true,
  portalOnly: false,
  effectiveGrants: [
    { module: 'fms', submodule: 'my_tasks', actions: ['view', 'edit'] },
    { module: 'fms', submodule: 'order_tracker', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
    { module: 'expenses', submodule: 'claims', actions: ['view', 'create'] },
  ],
};

const PORTAL_ROLE = {
  _id: 'r3',
  name: 'Warehouse User',
  isSuperAdmin: false,
  portalOnly: true,
  effectiveGrants: [],
};

const salesUser = (over = {}) => ({
  _id: 'u1',
  user: 'Priya',
  email: 'priya@example.com',
  role: 'Sales Manager',
  extraGrants: [{ module: 'fms', submodule: 'my_tasks', actions: ['edit'] }],
  ...over,
});

let putBody = null;

function installTransport() {
  putBody = null;
  api.get.mockImplementation(async (url) => {
    if (url === '/roles/registry') return { data: { data: REGISTRY } };
    throw new Error(`unstubbed GET ${url}`);
  });
  api.put.mockImplementation(async (url, body) => {
    putBody = body;
    return { data: { data: { extraGrants: body.extraGrants } } };
  });
}

beforeEach(() => {
  installTransport();
  useAdminStore.setState({
    users: [],
    roles: [SALES_ROLE, ADMIN_ROLE, PORTAL_ROLE],
    registry: null,
    loading: false,
    error: null,
  });
});

const rowFor = (label) => screen.getByText(label).closest('tr');
const cell = (label, action) =>
  within(rowFor(label)).getByRole('checkbox', { name: new RegExp(`^${action}`, 'i') });

describe('opening the modal', () => {
  it('ticks what the role already grants, as an ordinary, non-disabled checkbox', async () => {
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('Order Tracker');
    const box = cell('Order Tracker', 'view');

    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  it("also ticks the account's own extra grant, equally ordinary", async () => {
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('My Tasks');
    const box = cell('My Tasks', 'edit');

    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  it('renders an action a sub-module does not offer as a dash', async () => {
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('My Tasks');
    expect(within(rowFor('My Tasks')).queryByRole('checkbox', { name: /^delete/i })).toBeNull();
  });
});

describe('the safety guarantee', () => {
  /**
   * 🔴 The checkbox for a role-derived cell can be unticked and reticked freely
   * — it is not disabled — but doing so never changes what would be saved,
   * because it was never this account's OWN grant to begin with.
   */
  it('unticking a role-derived cell does not mark the form dirty, and Save stays asleep', async () => {
    const user = userEvent.setup();
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('Order Tracker');
    expect(screen.getByRole('button', { name: /Save Access/i }).disabled).toBe(true);

    await user.click(cell('Order Tracker', 'view'));
    expect(cell('Order Tracker', 'view').checked).toBe(false);

    // The click is visible, but nothing about what gets SAVED has changed.
    expect(screen.getByRole('button', { name: /Save Access/i }).disabled).toBe(true);
  });

  it('ticking a genuinely new permission marks the form dirty and saves it as extra', async () => {
    const user = userEvent.setup();
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('Order Tracker');
    await user.click(cell('Order Tracker', 'create'));

    expect(screen.getByRole('button', { name: /Save Access/i }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: /Save Access/i }));

    await waitFor(() => expect(putBody).toBeTruthy());
    const byId = Object.fromEntries(
      putBody.extraGrants.map((g) => [`${g.module}.${g.submodule}`, [...g.actions].sort()]),
    );
    // The pre-existing extra grant survives…
    expect(byId['fms.my_tasks']).toEqual(['edit']);
    // …the new one is recorded…
    expect(byId['fms.order_tracker']).toEqual(['create']);
    // …and the role-derived "view" on Order Tracker — still ticked on screen,
    // untouched — is nowhere in what got saved.
    expect(byId['fms.order_tracker']).not.toContain('view');
  });

  /**
   * The inherited tick and a fresh one can share the very same sub-module row
   * without the inherited half leaking into the saved payload.
   */
  it('re-ticking a role-derived cell after unticking it still saves nothing extra for it', async () => {
    const user = userEvent.setup();
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    await screen.findByText('Order Tracker');
    await user.click(cell('Order Tracker', 'view')); // off
    await user.click(cell('Order Tracker', 'view')); // back on
    expect(cell('Order Tracker', 'view').checked).toBe(true);

    expect(screen.getByRole('button', { name: /Save Access/i }).disabled).toBe(true);
  });
});

describe('a super-admin account', () => {
  it('shows every permission ticked, with nothing disabled, and says there is nothing extra to give', async () => {
    render(<UserAccessModal user={salesUser({ role: 'Admin', extraGrants: [] })} onClose={vi.fn()} />);

    await screen.findByText('My Tasks');
    expect(screen.getByText(/already has full access to the entire ERP/i)).toBeTruthy();

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(false);
    }
  });
});

describe('a portal-only account', () => {
  it('does not disable the cells outside the Customer Portal — they are just ineffective', async () => {
    render(<UserAccessModal user={salesUser({ role: 'Warehouse User', extraGrants: [] })} onClose={vi.fn()} />);

    await screen.findByText('My Tasks');
    expect(screen.getByText(/confined to the Customer Portal/i)).toBeTruthy();

    for (const box of screen.getAllByRole('checkbox')) expect(box.disabled).toBe(false);
  });
});

describe('when the role has not loaded', () => {
  it('says so rather than drawing an empty grid that invites re-granting everything', async () => {
    useAdminStore.setState({ roles: [], registry: null, users: [], loading: false, error: null });
    render(<UserAccessModal user={salesUser()} onClose={vi.fn()} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
  });
});
