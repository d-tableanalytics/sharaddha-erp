# Build Spec — Settings ▸ Roles & Permissions

Rebuild specification for the RBAC subsystem of D-Table HRMS: the `Settings ▸ Roles & Permissions`
tab, the custom-role builder behind it, and the enforcement machinery that makes a granted
permission actually mean something at runtime.

This document is self-contained. An engineer with an empty repo, the stack from `CLAUDE.md §3`,
and this file should be able to reproduce the feature to behavioural parity.

Related spec sections: `CLAUDE.md §4` (roles & permission matrix), `§5.18` (Settings), `§7` (API).

---

## 1. What the feature is

A Super Admin opens `Settings ▸ Roles & Permissions` and sees every role in the organization —
the nine seeded **system roles** plus any **custom roles** they have built. They can create a
custom role, tick exactly which `(module, action, scope)` triples it grants via an expandable
matrix, rename it, and delete it when no users are attached.

The permission rows a role carries are not decorative. They are the same rows the NestJS
`PermissionsGuard` evaluates on every request and the same rows the React nav filter reads to
decide which menu items exist. One evaluator function, shared by both sides, is the core design
constraint: **the frontend must never be able to disagree with the backend about what a user can
do.**

### 1.1 The three-axis model

A permission is a triple, never a flat string:

| Axis | Meaning | Values |
|---|---|---|
| `module` | Which feature area | `employees`, `payroll`, `leave`, … (§3.1) |
| `action` | What verb | `view`, `create`, `edit`, `delete`, `approve`, `run`, `submit`, `assign`, `resolve`, `export` |
| `scope` | How far the reach extends | `self` < `team` < `department` < `org` |

Scope is what makes this model worth the complexity. `leave/approve/team` and `leave/approve/org`
are the same capability at different blast radii — a Reporting Manager and an HR Admin differ in
scope, not in verb list. Encoding reach as a third axis avoids a combinatorial explosion of role
names (`leave_approver_for_own_team`, `leave_approver_for_everyone`, …).

---

## 2. Architecture

Three layers, deliberately separated so the rules live in exactly one place.

```
packages/rbac/                 ← shared, dependency-free, isomorphic
  types.ts                     Module | Action | Scope | Permission | Actor | ResourceContext | RoleKey
  matrix.ts                    PERMISSION_MATRIX, ROLE_LABELS, ALL_ROLES  (single source of truth)
  has-permission.ts            hasPermission(), canAccessModule()        (the only evaluator)

apps/api/                      ← enforcement + administration
  src/common/decorators/permissions.decorator.ts   @Permissions({module, action, scope})
  src/common/guards/permissions.guard.ts           reads metadata → calls hasPermission()
  src/modules/auth/actor-loader.ts                 DB rows → Actor
  src/modules/rbac/{controller,service,module}.ts  CRUD for roles
  prisma/seed.ts                                   matrix → Role/Permission/RolePermission rows
  scripts/sync-role-permissions.ts                 re-sync a live DB after a matrix edit

apps/web/                      ← administration UI + client-side gating
  src/api/settings.ts                              TanStack Query hooks for /roles
  src/pages/settings/RolesTab.tsx                  the tab + permission matrix widget
  src/hooks/use-permissions.ts                     /auth/me payload → Actor → can()
```

**Why `packages/rbac` is a workspace package and not duplicated code:** both the Nest guard and
the React nav import the identical `hasPermission`. If the evaluator were reimplemented on the
client, the two would drift and the UI would start offering buttons the API rejects. The package
must have zero runtime dependencies so it is importable from both a Node server and a browser
bundle, and must be pure (no I/O) so it is trivially unit-testable.

---

## 3. Shared package: `@dtable/rbac`

### 3.1 `types.ts`

```ts
export type Module =
  | 'employees' | 'employees:compensation'
  | 'org-structure' | 'onboarding' | 'exits'
  | 'attendance' | 'leave'
  | 'payroll' | 'payroll:structure'
  | 'expenses' | 'documents' | 'engage' | 'performance' | 'hiring' | 'assets'
  | 'helpdesk' | 'helpdesk:hr' | 'helpdesk:payroll' | 'helpdesk:it'
  | 'reports' | 'reports:payroll' | 'reports:team' | 'reports:hiring' | 'reports:assets'
  | 'settings' | 'settings:integrations'
  | 'audit-logs' | 'dashboard' | 'inbox' | 'projects' | 'operations' | 'planning';

export type Action =
  | 'view' | 'create' | 'edit' | 'delete'
  | 'approve' | 'run' | 'submit' | 'assign' | 'resolve' | 'export';

export type Scope = 'self' | 'team' | 'department' | 'org';

export interface Permission { module: Module; action: Action; scope: Scope }

export type RoleKey =
  | 'super_admin' | 'hr_admin' | 'payroll_admin' | 'recruiter'
  | 'manager' | 'project_manager' | 'employee' | 'it_admin' | 'auditor';

export interface Actor {
  userId: string;
  employeeId: string | null;
  organizationId: string;
  departmentId: string | null;
  /** Ancestor manager ids, nearest-first: [directManager, skipLevel, …]. */
  managerChain: string[];
  roleKeys: RoleKey[];
  permissions: Permission[];
}

export interface ResourceContext {
  ownerUserId?: string;
  ownerEmployeeId?: string;
  ownerManagerChain?: string[];
  ownerDepartmentId?: string;
}
```

**Colon-suffixed sub-modules** (`employees:compensation`, `helpdesk:it`, `reports:payroll`) exist
because `CLAUDE.md §4.2` grants asymmetric access *within* a module: a Payroll Admin sees
salary-linked employee data but not the full employee record; an IT Admin resolves only IT-category
tickets. Modelling these as distinct module strings is simpler than adding a fourth "category" axis.
They are **not** hierarchical — granting `helpdesk/resolve/org` does **not** imply
`helpdesk:it/resolve/org`. Grant both explicitly.

`managerChain` is a denormalized array on the `Employee` row (ancestor employee ids, nearest
first). It exists so a `team` scope check is an array membership test rather than a recursive CTE
on every request. Whatever writes `reporting_manager_id` must rewrite the chain for the moved
employee **and all of its descendants**.

### 3.2 `has-permission.ts` — the evaluator

The whole contract:

```ts
const SCOPE_RANK: Record<Scope, number> = { self: 0, team: 1, department: 2, org: 3 };

export function hasPermission(
  actor: Actor,
  module: Module,
  action: Action,
  requiredScope: Scope,
  resource?: ResourceContext,
): boolean
```

Algorithm:

1. Filter the actor's permissions to those matching `module` **and** `action` exactly. None → `false`.
2. For each candidate, if `SCOPE_RANK[granted] < SCOPE_RANK[required]` → reject that candidate.
   **Wider scope satisfies a narrower requirement**: `leave/approve/org` passes a `team` check.
3. For surviving candidates, confirm the concrete resource falls inside the actor's reach
   (`scopeCovers`). Return `true` if **any** candidate passes.

`scopeCovers(actor, grantedScope, requiredScope, resource)`:

| Granted | Rule |
|---|---|
| `org` | Always `true`. Postgres RLS already guarantees cross-tenant isolation, so org scope needs no resource check. |
| `department` | `false` if required is `org`. Else if `resource.ownerDepartmentId` is absent → `true` (an org-wide *list* request; the repository must filter rows downstream). Else `ownerDepartmentId === actor.departmentId`. |
| `team` | `false` if required is `org` or `department`. Else `isInTeamOf` — `true` when no resource (list request, repo filters by `managerChain`), when the resource is the actor themselves, or when `resource.ownerManagerChain` contains `actor.employeeId`. |
| `self` | `false` unless required is `self`. Then `isSelf` — `true` when no resource, or when `ownerUserId === actor.userId`, or `ownerEmployeeId === actor.employeeId`. |

> **The absent-resource convention is the sharpest edge in this design.** When `resource` is
> `undefined`, a narrower-than-org grant returns `true` and the comment reads
> *"org-level list — filter downstream"*. The guard is deciding **"may you call this endpoint at
> all"**, not **"which rows may you see"**. Row filtering is the service layer's job, always. If you
> rebuild this, carry the convention *and* the discipline: every list endpoint behind a `team` or
> `department` grant **must** apply its own `where` clause. A list service that trusts the guard for
> row filtering leaks the entire org.

```ts
export function canAccessModule(actor: Actor, module: Module): boolean {
  return actor.permissions.some((perm) => perm.module === module);
}
```

Used only by the frontend to decide whether a nav item renders at all. Any action, any scope counts.

### 3.3 `matrix.ts` — the seeded defaults

Exports:

- `PERMISSION_MATRIX: Record<RoleKey, Permission[]>` — the canonical §4.2 grid as data.
- `ROLE_LABELS: Record<RoleKey, string>` — display names (`super_admin` → `'Super Admin'`,
  `manager` → `'Reporting Manager'`, `it_admin` → `'IT / Asset Admin'`,
  `auditor` → `'Auditor (read-only)'`, …).
- `ALL_ROLES: RoleKey[]` — `Object.keys(PERMISSION_MATRIX)`.

Use a terse local helper so the matrix stays readable at ~270 lines:

```ts
const p = (module: Module, action: Action, scope: Scope): Permission => ({ module, action, scope });
```

**`SELF_BASELINE`** is spread into every role **except `auditor`** (see the note after the matrix).
It is the floor of self-service a normal employee gets, and it is larger than instinct suggests —
reproduce it deliberately:

```ts
const SELF_BASELINE: Permission[] = [
  p('dashboard', 'view', 'self'), p('inbox', 'view', 'self'),
  p('attendance', 'submit', 'self'), p('attendance', 'view', 'self'),
  p('leave', 'submit', 'self'), p('leave', 'view', 'self'),
  p('expenses', 'submit', 'self'), p('expenses', 'view', 'self'),
  p('helpdesk', 'submit', 'self'), p('helpdesk', 'view', 'self'),
  p('documents', 'view', 'self'),
  p('performance', 'view', 'self'), p('performance', 'submit', 'self'),
  p('employees', 'view', 'self'), p('employees', 'edit', 'self'),
  p('org-structure', 'view', 'self'),   // dept/location labels appear on every profile
  p('payroll', 'view', 'self'),         // own payslip
  p('onboarding', 'view', 'self'),
  p('exits', 'submit', 'self'), p('exits', 'view', 'self'),
  p('engage', 'view', 'self'),
  p('projects', 'view', 'self'), p('projects', 'submit', 'self'),
  p('operations', 'view', 'self'), p('operations', 'edit', 'self'), p('operations', 'submit', 'self'),
];

Two non-obvious reasons the baseline is this wide:

- **`submit` without `view` is a trap.** Someone who can clock in must see their own attendance
  history; same for leave, expenses and tickets. Pair them always.
- **Reference-data reads.** `org-structure/view/self` is granted to everyone because department
  and location names render on every profile card and org chart — without it, any authenticated
  user gets 403s resolving UUIDs to labels.

### 3.4 The full matrix

The grants on top of the baseline, verbatim. `employee` is exactly `SELF_BASELINE`.

**`super_admin`** — `org` scope on everything:

```
employees          view create edit delete      employees:compensation  view edit
org-structure      view edit                    onboarding              view edit
exits              view edit                    attendance              view approve edit
leave              view approve edit            payroll                 view run
payroll:structure  view edit                    expenses                view approve
performance        view approve                 hiring                  view edit
assets             view assign                  engage                  edit
helpdesk           view resolve                 reports                 view export
settings           view edit                    settings:integrations   edit
audit-logs         view                         projects                view edit approve
operations         view edit                    planning                view edit
```

**`hr_admin`** — org-wide people operations, but **not** payroll execution and **not** settings:

```
employees  view create edit   (no delete, no :compensation)
org-structure view edit · onboarding view edit · exits view edit
attendance view approve edit · leave view approve edit
payroll    view      — sees payslips, cannot run (§4.2)
payroll    approve   — approves/rejects Advance Salary requests
expenses   view approve (policy-level) · performance view approve
hiring     view edit · assets view assign · engage edit · documents view
helpdesk   view · helpdesk:hr resolve
reports    view · audit-logs view · operations view (read-only) · planning view edit
```

**`payroll_admin`** — narrow and deep. Note it gets `employees:compensation` but **never**
`employees`, so it sees salary-linked data without the full employee record:

```
employees:compensation view · payroll view run · payroll:structure view edit
expenses view approve (finance-level)
reports:payroll view export · helpdesk:payroll resolve
```

**`manager`** — `team` scope is the whole point of this role:

```
employees view:team · attendance view approve :team · leave view approve :team
expenses view approve :team · performance view approve :team
onboarding view:team · exits approve:team · hiring view:team (interviewer)
reports:team view:team · projects view approve :team
org-structure view:org      — needs the full chart to see its own branch
operations view edit :org   — Operations membership crosses reporting lines
```

**`project_manager`**:

```
projects view edit approve :org
operations edit:org         — deliberately NO operations:view:org
employees view:org          — populates the "add member" picker
org-structure view:org · reports:team view:team
```

The missing `operations/view/org` is intentional: the list endpoint falls back to owner/member
scope, so a PM sees exactly their own projects rather than every PM's.

**`recruiter`**:

```
hiring view edit :org · reports:hiring view:org
employees view edit :org    — personal + job details; compensation stays HR/payroll
attendance view approve :org — shares the correction queue with HR/super_admin
payroll approve:org         — Advance Salary requests
operations view:org (read-only)
```

**`it_admin`**:

```
assets view assign :org · helpdesk view:org · helpdesk:it resolve:org
exits view:org (asset clearance step) · reports:assets view:org
```

**`auditor`** — the one role that does **not** spread `SELF_BASELINE`:

```
dashboard view:self · inbox view:self
employees attendance leave payroll expenses performance hiring assets reports audit-logs
   → view:org, and nothing else
```

Omitting the baseline is the point. A read-only auditor must not be able to `submit` leave, file
expenses or raise tickets — spreading the baseline would have handed them those write verbs on
their own records and quietly broken the "no write access anywhere" guarantee in `CLAUDE.md §4.1`.
Note also that `auditor` gets no `export` anywhere, only `reports/view/org`; if auditors need to
pull data out, add `reports/export/org` explicitly.

> **`hr_admin` has no `settings` grant at all**, and the `/roles` endpoints all require
> `settings:view:org` / `settings:edit:org`. So `Settings ▸ Roles & Permissions` is reachable by
> **`super_admin` only** — matching §4.2, where "System settings/integrations" is a lone ✅ in the
> Super Admin column. If you want HR to see roles read-only, grant `hr_admin` `settings/view/org`
> and nothing more; `listRoles` is the only route gated on `view`.

---

## 4. Data model

```prisma
model Role {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  key            String   // 'super_admin' | … | 'regional_manager'
  label          String
  isSystem       Boolean  @default(false) @map("is_system")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  rolePermissions RolePermission[]
  userRoles       UserRole[]

  @@unique([organizationId, key])
  @@index([organizationId])
  @@map("role")
}

model Permission {
  id     String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  module String
  action String
  scope  String

  rolePermissions RolePermission[]

  @@unique([module, action, scope])
  @@map("permission")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@map("role_permission")
}

model UserRole {
  userId String @map("user_id") @db.Uuid
  roleId String @map("role_id") @db.Uuid

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@index([roleId])
  @@map("user_role")
}
```

Four deliberate choices:

1. **`Role` is tenant-scoped, `Permission` is global.** A permission row is just a
   `(module, action, scope)` vocabulary entry with no tenant meaning, so it is a shared catalog
   de-duplicated by its unique constraint. Roles belong to an organization and are uniqued on
   `[organizationId, key]`, so two tenants can each own a role keyed `regional_manager`.
2. **`isSystem` protects the nine seeded roles.** System roles are readable and assignable but
   never editable or deletable through the API — their grants come from `matrix.ts`, and letting an
   admin hand-edit `super_admin` is how an org locks itself out of its own Settings page.
3. **`UserRole` is many-to-many.** A person can hold `manager` *and* `payroll_admin`; the
   `ActorLoader` unions their permission sets. There is no "primary role".
4. **`RolePermission` is a bare join with a composite PK** — no surrogate id, no audit columns.
   Role grants are rewritten wholesale on every save (§5.2), so per-row history would be noise; the
   `AuditLog` entry for `role.update` is the traceability record.

Both `Role → RolePermission` and `Role → UserRole` cascade on delete, so a role delete cleans up
after itself — but the service still refuses to delete an assigned role rather than silently
stripping users' access (§5.2).

---

## 5. Backend

### 5.1 Enforcement

**Decorator** — `apps/api/src/common/decorators/permissions.decorator.ts`:

```ts
export const PERMISSIONS_KEY = 'requiredPermissions';

export interface PermissionSpec {
  module: Module;
  action: Action;
  scope: Scope;
  /** Route param (e.g. 'employeeId') resolved to a resource owner before the scope check. */
  resourceParam?: string;
}

export const Permissions = (spec: PermissionSpec | PermissionSpec[]) =>
  SetMetadata(PERMISSIONS_KEY, Array.isArray(spec) ? spec : [spec]);
```

**Registration** — both guards and both interceptors are global, and the order in the providers
array is the execution order:

```ts
// apps/api/src/app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },        // every route needs JWT unless @Public()
  { provide: APP_GUARD, useClass: PermissionsGuard },    // then @Permissions() vs @dtable/rbac
  // TenancyInterceptor MUST run before AuditInterceptor so audit writes have tenancy context.
  { provide: APP_INTERCEPTOR, useClass: TenancyInterceptor },
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
]
```

**Guard** — runs after the JWT guard has populated `req.user: Actor`:

1. `@Public()` route → allow.
2. Collect specs with `reflector.getAllAndMerge(PERMISSIONS_KEY, [handler, class])`. **No specs →
   allow** (the route needs authentication only). This default matters: forgetting a `@Permissions`
   decorator fails *open*. Compensate with the route-coverage test in §8.
3. No `req.user` → `ForbiddenException('Not authenticated')`.
4. Group specs by `resourceParam` and resolve each distinct param **once** into a
   `ResourceContext`, caching in a `Map`. Three specs on one handler sharing `:id` cost one query.
5. **ANY-OF across all specs** — the actor satisfying one is enough. On failure throw
   `ForbiddenException` naming the specs:
   `Missing permission on ${specs.map(s => `${s.module}:${s.action}:${s.scope}`).join(', ')}`.

ANY-OF is what lets a single `GET /employees/:id` serve three audiences:

```ts
@Permissions([
  { module: 'employees', action: 'view', scope: 'self', resourceParam: 'id' },
  { module: 'employees', action: 'view', scope: 'team', resourceParam: 'id' },
  { module: 'employees', action: 'view', scope: 'org' },
])
```

An employee viewing themselves matches spec 1, a manager viewing a report matches spec 2, HR
matches spec 3. Note the decorator's own docblock claims multiple *decorators* mean AND while
array syntax means OR — the implementation is ANY-OF in both cases, because `getAllAndMerge`
flattens stacked decorators into one array. **Treat everything as ANY-OF**, and if you need AND,
check the second condition in the service.

**Resource resolution** — `resolveResource(param, id, actor)` switches on the param *name*:

- `'employeeId' | 'id'` → load the `Employee`, return
  `{ ownerUserId, ownerEmployeeId, ownerDepartmentId, ownerManagerChain }`.
- `'leaveRequestId'` → load the `LeaveRequest`, return its **employee's** ownership context.
- default → `undefined` (no resource; the absent-resource convention in §3.2 applies).

Queries here use `prisma.withOrg(actor.organizationId, …)`, **not** the ambient-tenant `tx()`
helper, because guards run *before* the tenancy interceptor populates AsyncLocalStorage — the RLS
session variable is not set yet. The JWT's verified `orgId` claim is the trust boundary. Extending
the switch with a new param is the normal way to add a scoped route; a missing case silently
degrades to the permissive absent-resource path, so add the case *and* a test together.

**Actor loading** — `ActorLoader.load(userId, organizationId)`:

```
withOrg(organizationId) → user.findFirst({ id, status: { not: 'suspended' } })
  include employee { id, departmentId, managerChain }
  include userRoles → role → rolePermissions → permission { module, action, scope }
```

Missing user → `UnauthorizedException('Session no longer valid')`. Union the permissions of all
roles through a `Map` keyed `module:action:scope` to de-duplicate overlapping grants, collect
`roleKeys`, and return the `Actor`. Suspension is enforced here rather than at login, so
suspending a user invalidates their next request, not just their next sign-in.

### 5.2 Administration — `/api/v1/roles`

Controller `@Controller('roles')`, every mutating route also `@Audited`:

| Method | Path | Permission | Audit | Returns |
|---|---|---|---|---|
| `GET` | `/roles` | `settings:view:org` | — | `RoleDto[]` |
| `POST` | `/roles` | `settings:edit:org` | `role.create` | `RoleDto` |
| `PATCH` | `/roles/:id` | `settings:edit:org` | `role.update` | `RoleDto` |
| `DELETE` | `/roles/:id` | `settings:edit:org` | `role.delete` | `204 No Content` |

`:id` is validated with `new ParseUUIDPipe()`. DTOs:

```ts
export interface RoleDto {
  id: string; key: string; label: string;
  isSystem: boolean; userCount: number;
  permissions: Array<{ module: string; action: string; scope: string }>;
}
export interface UpsertRoleDto {
  key: string; label: string;
  permissions: Array<{ module: string; action: string; scope: string }>;
}
```

Service rules — **note the service re-checks `hasPermission` even though the guard already did.**
Defence in depth: the service is also reachable from seeds, scripts and other modules where no
guard ran.

- **`listRoles`** — requires `settings/view/org`, else `ForbiddenException('Cannot view roles')`.
  `role.findMany` including `rolePermissions.permission` and `_count.userRoles`, ordered
  `createdAt: 'asc'` so the seeded system roles stay at the top in a stable order. Map to `RoleDto`
  with `userCount` from `_count`.
- **`createRole`** — requires `settings/edit/org`. In one transaction: create the `Role` with
  `organizationId: actor.organizationId` and `isSystem: false` (a custom role can never be born
  a system role), then for each submitted permission `upsert` the global `Permission` on the
  `module_action_scope` compound unique and `create` the `RolePermission`. Re-read with includes
  and return.
- **`updateRole`** — requires `settings/edit/org`. Load the role; missing → `NotFoundException`;
  `isSystem` → `ForbiddenException('System roles cannot be edited')`. Update **`label` only** —
  `key` is immutable because it is what `matrix.ts`, seeds and any `roleKeys.includes('…')` check
  refer to. Then `rolePermission.deleteMany({ roleId })` and reinsert the submitted set. The
  wipe-and-reinsert is intentional: a diff would have to handle unticks, and a full replace makes
  the submitted payload authoritative.
- **`deleteRole`** — requires `settings/edit/org`. Missing → `NotFoundException`. `isSystem` →
  `ForbiddenException('System roles cannot be deleted')`. `_count.userRoles > 0` →
  `ForbiddenException('Cannot delete role — N user(s) still assigned to it')`. Otherwise delete
  the `RolePermission` rows then the `Role`.

### 5.3 Assigning roles to users

Role **assignment** deliberately lives in the Employees module, not here — an admin assigns a role
while looking at a person, not while editing the role. On `apps/api/src/modules/employees`:

| Method | Path | Guard |
|---|---|---|
| `GET` | `/employees/:id/roles` | `employees:edit:org` |
| `PATCH` | `/employees/:id/roles` | `employees:edit:org`, audited `employee.roles.update` |

Both return `{ roleKeys: string[] }`. `assignRoles` rejects an empty array
(`BadRequestException('At least one role must be assigned')`), resolves every key against
`role.findMany({ organizationId: actor.organizationId, key: { in: roleKeys } })` and reports any
unmatched keys as `Unknown role key(s): …`, then **replaces** all assignments atomically
(`userRole.deleteMany({ userId })` + `createMany`). Scoping the lookup to the actor's org is what
stops a crafted key from attaching another tenant's role.

Note the guard is `employees:edit:org`, not `settings:edit:org` — granting someone the ability to
edit employee records org-wide also grants them the ability to hand out roles, including
`super_admin`. Treat `employees/edit/org` as a privileged grant when designing custom roles.

`createEmployee` assigns `dto.initialRoleKeys`, defaulting to `['employee']`, and throws
`BadRequestException('Unknown role: …')` on a bad key.

### 5.4 Seeding and re-syncing

**`prisma/seed.ts`** imports `{ ALL_ROLES, PERMISSION_MATRIX, ROLE_LABELS }` from `@dtable/rbac` —
never redeclare the matrix in the seed. Per organization, for each `RoleKey`:
`role.upsert` on the `organizationId_key` unique with `{ label: ROLE_LABELS[key], isSystem: true }`,
then wipe and reinsert its `RolePermission` rows from `PERMISSION_MATRIX[key]`. Upsert the global
`Permission` catalog first, since a matrix edit may reference triples no row exists for yet.

**`scripts/sync-role-permissions.ts`** — run after editing `matrix.ts` so a live database picks up
new grants without a destructive reseed:

```
pnpm exec tsx scripts/sync-role-permissions.ts
```

It upserts the `Permission` catalog, builds a `module:action:scope → id` map, then for every
organization × every `RoleKey` wipes and reinserts `RolePermission` rows, logging
`key → N permissions` and skipping (with a message) any role row that does not exist. It touches
`role_permission` only — users, employees and custom roles are untouched — which makes it safe to
run against production. It does **not** delete stale `Permission` catalog rows; harmless, since an
orphaned vocabulary entry grants nothing.

---

## 6. Frontend

### 6.1 Placement

`apps/web/src/pages/settings/SettingsPage.tsx` renders an AntD `<Tabs>`; Roles is the second item:

```ts
const items = [
  { key: 'company',      label: 'Company Profile',     children: <CompanyProfileTab /> },
  { key: 'roles',        label: 'Roles & Permissions', children: <RolesTab /> },
  { key: 'sso',          label: 'Single Sign-On',      children: <SsoTab /> },
  { key: 'integrations', label: 'Integrations',        children: <IntegrationsTab /> },
];
```

### 6.2 Data layer — `src/api/settings.ts`

TanStack Query hooks over a shared `apiFetch`, all keyed `['settings', 'roles']` so every mutation
invalidates one cache entry:

```ts
const ROLES_KEY = ['settings', 'roles'] as const;

useRoles()       → useQuery<RoleDto[]>({ queryKey: ROLES_KEY, queryFn: () => apiFetch('/roles') })
useCreateRole()  → POST   /roles        , onSuccess: invalidate(ROLES_KEY)
useUpdateRole()  → PATCH  /roles/:id    , onSuccess: invalidate(ROLES_KEY)   // arg: { id, dto }
useDeleteRole()  → DELETE /roles/:id    , onSuccess: invalidate(ROLES_KEY)
```

`RoleDto` / `UpsertRoleDto` mirror §5.2 exactly.

### 6.3 `RolesTab.tsx` — the role list

Local constants drive the builder grid (see the §10 gap about these drifting from the `Module` and
`Action` unions):

```ts
const MODULES = ['employees','org-structure','onboarding','exits','attendance','leave','payroll',
  'expenses','documents','engage','performance','hiring','assets','helpdesk','reports','settings',
  'audit-logs','projects','planning'];                                          // 19
const ACTIONS = ['view','create','edit','delete','approve','submit','export'];  // 7
const SCOPES  = ['self','team','department','org'];                             // 4
```

Layout: a primary **New Role** button (`PlusOutlined`, `marginBottom: 16`), then either
`<Empty description="No roles yet" />` or an unpaginated `<Table<RoleDto> rowKey="id">`:

| Column | Width | Render |
|---|---|---|
| Key | 200 | `key` |
| Label | — | `label` |
| Type | 100 | `isSystem` → `<Tag color="blue">System</Tag>` : `<Tag color="green">Custom</Tag>` |
| Users | 80 | `userCount` |
| Permissions | 120 | secondary text `"{n} rules"` |
| Actions | 140 | edit icon button; delete icon button **only when `!isSystem`** |

Delete opens `Modal.confirm`. When `userCount > 0` the body reads
`"{n} user(s) are assigned to this role — you must reassign them first."` and
`okButtonProps: { disabled: true }`; otherwise `"This cannot be undone."` This mirrors the server
rule client-side so the user learns the constraint before spending a round trip — but the server
check in §5.2 remains the enforcement point.

### 6.4 The editor drawer

`<Drawer width={720}>`, titled `Edit "{label}"` or `New Role`. State: `editingRole: RoleDto | null`
and `selectedPerms: Set<string>` where each member is the flat string `${module}|${action}|${scope}`.

A `Set` of delimited strings — rather than nested objects — is what keeps the widget simple: a
checkbox's checked state is one `Set.has` call, bulk operations are set arithmetic, and the save
handler converts back with `key.split('|')`. The `|` delimiter is safe because no module, action or
scope value contains it (module sub-parts use `:`).

A `useEffect` on `[editingRole, form]` hydrates: on edit, `form.setFieldsValue({ key, label })` and
rebuild the `Set` from `editingRole.permissions`; on create, `form.resetFields()` and clear the `Set`.

Form fields, side by side:

- **`key`** — label `"Key (immutable)"`, placeholder `e.g., regional_manager`, required,
  `disabled={!!editingRole}` (matches the server updating `label` only).
- **`label`** — `"Display Label"`, placeholder `e.g., Regional Manager`, required.

Then a `Permissions` heading and the scope legend as inline `<Tag>`s:
*`self` own records · `team` direct + indirect reports · `department` same dept · `org` entire tenant*.

The drawer uses `footer` rather than inline buttons so Save/Cancel stay pinned while the tall
permission area scrolls. Footer left: `"{selectedPerms.size} permissions selected"`. Right: Cancel,
and a primary `loading={isCreating || isUpdating}` button reading `Save Changes` / `Create Role`
that calls `form.submit()`.

`handleSave` maps the `Set` back to `Array<{module, action, scope}>`, builds `UpsertRoleDto`, and
calls `update({ id, dto })` or `create(dto)` with `message.success('Role updated' | 'Role created')`
and `message.error(e.message)` on failure, closing the drawer and clearing `editingRole` on success.

### 6.5 `PermissionMatrix` widget

One collapsible card per module — 19 modules × 7 actions × 4 scopes = 532 checkboxes, far too many
to show flat. Props: `{ modules, actions, scopes, selected, onToggle, onBulkToggle }`. Local state
`expanded: Record<string, boolean>` initialized all-`false`. Outer container
`maxHeight: '52vh', overflowY: 'auto'`.

**Card header** (`padding: '8px 12px'`, `cursor: pointer`, whole header toggles expansion):
module name at weight 500; when the module has any grant, a blue `<Tag>{count} / {total}</Tag>` and
header background `#F5F7FA` (else `#FFFFFF`) — so a collapsed list still shows at a glance where
grants live. Right side: a text button with `e.stopPropagation()` (so it does not also collapse the
card) labelled `Clear all` when `count === total`, `Select all` when `count > 0`, else `Grant all`,
calling `toggleAllForModule(mod, count < total)`; then a `▲`/`▼` caret.

**Card body** (shown when expanded, background `#FAFBFC`) is a CSS grid,
`gridTemplateColumns: '110px repeat(4, 1fr) 80px'`:

- Header row: `Action`, the four scope names centered, `Row`.
- One row per action: the action name, a `<Checkbox>` per scope bound to
  `selected.has(`${mod}|${a}|${s}`)` calling `onToggle(mod, a, s)`, and a trailing **row**
  checkbox whose checked state is `scopes.every(s => selected.has(…))` and which bulk-toggles that
  action across all four scopes.

Helpers: `moduleKeyCount`, `allModuleKeys` (`actions.flatMap(a => scopes.map(s => …))`),
`toggleAllForModule`, `toggleRow`. Bulk toggles funnel through `onBulkToggle(keys, checked)`, which
clones the `Set` and adds or deletes en masse. Borders `1px solid #E2E6ED`, row separators
`1px dashed #F0F2F5`, muted text `#5B6472` / `#9AA3B2` — the `--db-*` tokens from `CLAUDE.md §2.1`.

The fixed `repeat(4, …)` and `110px` label column are what let this fit a 720px drawer with **no
horizontal scrolling**, which is the whole reason for the card-per-module shape over a wide table.

### 6.6 Client-side gating — `usePermissions()`

```ts
export function usePermissions() {
  const me = useAuthStore((s) => s.me);
  const actor: Actor | null = useMemo(() => me ? {
    userId: me.user.id,
    employeeId: me.employee?.id ?? null,
    organizationId: me.organization.id,
    departmentId: me.employee?.departmentId ?? null,
    managerChain: me.employee?.managerChain ?? [],
    roleKeys: me.roleKeys,
    permissions: me.permissions.map((p) => ({ module: p.module, action: p.action, scope: p.scope })),
  } : null, [me]);

  const can = (module, action, scope, resource?) =>
    actor ? hasPermission(actor, module, action, scope, resource) : false;
  const seesModule = (module) => actor ? canAccessModule(actor, module) : false;

  return { actor, can, seesModule };
}
```

`/auth/me` returns `{ user, employee, organization, roleKeys, permissions }`, where `roleKeys` and
`permissions` are the loaded `Actor`'s fields verbatim and `employee` carries `departmentId` and
`managerChain` — exactly the four pieces the hook needs to rebuild an `Actor` client-side. Keep
that payload in sync if you change the `Actor` shape, or scoped `can()` checks start silently
returning `false` in the UI while the API still allows the call.

It reconstructs an `Actor` from the persisted `/auth/me` payload and calls the **same**
`hasPermission` the guard uses. Use
`can()` to gate buttons and `seesModule()` to gate nav items. Client gating is cosmetic — it
prevents dead-end clicks, never protects data.

---

## 7. Request lifecycle

```
POST /api/v1/leave-requests/:leaveRequestId/approve
  │
  ├─ JwtAuthGuard          verify access token → { sub, orgId }
  ├─ ActorLoader           withOrg(orgId) → user + employee + roles → Actor  → req.user
  ├─ PermissionsGuard      read @Permissions metadata
  │                        resolveResource('leaveRequestId', id, actor) → ResourceContext
  │                        hasPermission(actor, 'leave', 'approve', 'team', resource)
  │                          ├─ false → 403 "Missing permission on leave:approve:team"
  │                          └─ true  → continue
  ├─ TenancyInterceptor    set RLS session var from actor.organizationId   (ALS populated here)
  ├─ Controller → Service  service re-checks hasPermission + filters rows
  └─ AuditInterceptor      @Audited → AuditLog row (actor, action, entity, before, after)
```

Order matters twice: the guard must run after the actor exists, and it must use `withOrg` because
the tenancy interceptor has not run yet.

---

## 8. Tests to write

`packages/rbac/src/has-permission.test.ts` carries the real weight, because every gate in the
product resolves to this one function:

- Missing `(module, action)` → `false`.
- Exact `(module, action, scope)` → `true`.
- **Wider satisfies narrower**: `approve/org` passes a `team` requirement.
- **Narrower does not satisfy wider**: `approve/team` fails an `org` requirement.
- `self`: matches on `ownerUserId`, matches on `ownerEmployeeId`, rejects a different owner,
  returns `true` when `resource` is absent.
- `team`: `true` when `ownerManagerChain` contains `actor.employeeId`; `true` for the actor's own
  record; `false` for an unrelated employee; `false` when `actor.employeeId` is `null` (the
  `'__none__'` sentinel must not match).
- `department`: matches equal `ownerDepartmentId`, rejects a different one, `true` when absent.
- Multiple grants on one `(module, action)` — the widest wins.
- `canAccessModule` true for any action/scope on that module, false otherwise.
- Colon sub-modules are **not** implied by their parent: `helpdesk/resolve/org` does not satisfy
  `helpdesk:it/resolve/org`.

API tests: each `/roles` route rejects an actor without `settings:edit:org`; `PATCH`/`DELETE` on a
system role 403 with the exact messages; `DELETE` with assigned users 403; `PATCH` replaces rather
than merges the permission set and ignores a changed `key`; `POST` reuses an existing `Permission`
row rather than duplicating it; `assignRoles` rejects `[]`, rejects an unknown key, and refuses a
role belonging to another organization.

Because a route with no `@Permissions` decorator **fails open** (§5.1), add a coverage test that
enumerates every registered route and asserts each is either `@Public()` or decorated. This is the
single highest-value test in the suite.

Frontend: the `Set`-of-`module|action|scope` round-trip survives edit→save unchanged; the row
checkbox reflects all-four-scopes state; `Grant all` / `Clear all` flip the module's full block;
the delete button is absent for system roles; the confirm's OK is disabled when `userCount > 0`.

---

## 9. Rebuild order

Build it in this sequence; each step is independently verifiable, and the dependency direction
never reverses.

1. **`packages/rbac`** — `types.ts`, then `has-permission.ts`, then the §8 unit tests. Get the
   evaluator green before anything imports it. Zero runtime deps; build both ESM and CJS so Nest
   and Vite can each consume it.
2. **`matrix.ts`** — `SELF_BASELINE`, the nine role blocks from §3.4, `ROLE_LABELS`, `ALL_ROLES`.
   (Add `ALL_MODULES` / `ALL_ACTIONS` now — gap 1 in §10.)
3. **Prisma schema** — the four models from §4, migrate, then the seed: `Permission` catalog first,
   then `Role` upserts with `isSystem: true`, then `RolePermission` from the matrix.
4. **`ActorLoader`** — DB rows → `Actor`. Verify by logging in and inspecting `/auth/me`: a seeded
   `super_admin` should come back with `roleKeys: ['super_admin']` and ~48 permissions.
5. **Decorator + guard**, registered globally per §5.1. Decorate one route (`GET /employees/:id`
   with the three-spec ANY-OF example) and confirm an `employee` actor can fetch itself and 403s on
   a colleague.
6. **`sync-role-permissions.ts`** — needed as soon as step 2 changes again, which it will.
7. **`/roles` CRUD** — `RbacService` then `RbacController`. Testable with curl before any UI exists.
8. **`/employees/:id/roles`** — assignment, per §5.3. Without this, custom roles are unreachable.
9. **Frontend** — `settings.ts` hooks, then the `RolesTab` table, then the drawer, then
   `PermissionMatrix` last (it is the only genuinely fiddly piece, and everything else is
   demonstrable without it).
10. **`usePermissions()`** and nav gating.

The route-coverage test from §8 should land with step 5, not at the end — it is what stops
undecorated routes accumulating.

---

## 10. Known gaps — fix while rebuilding

These are live defects in the current implementation, not design choices. A rebuild should close
them rather than reproduce them.

1. **The builder's `MODULES` and `ACTIONS` are hardcoded and have drifted from the `Module` and
   `Action` unions.** The UI offers 19 modules where the union has 33, and 7 actions where the
   union has 10. Consequences: no custom role can be granted `payroll/run` (so payroll processing
   is unreachable outside the seeded `payroll_admin`), nor `helpdesk/assign`, `helpdesk/resolve`,
   any colon sub-module (`employees:compensation`, `helpdesk:it`, `reports:payroll`, …), nor
   `dashboard`, `inbox` or `operations`. **Fix:** export `ALL_MODULES` and `ALL_ACTIONS` from
   `@dtable/rbac` alongside `ALL_ROLES` and have the UI iterate those, so the union stays the
   single source. Group the colon sub-modules under their parent card in the widget.
2. **System roles get an enabled Edit button that always fails.** The list renders the edit icon
   for every row, the drawer opens and accepts ticks, and the `PATCH` then 403s with
   `'System roles cannot be edited'`. **Fix:** for `isSystem` rows, either hide the button or open
   the drawer read-only (all checkboxes disabled, footer showing a "managed in matrix.ts" note).
3. **`createRole` does not pre-check the key.** A duplicate `key` hits the
   `[organizationId, key]` unique constraint and surfaces a raw Prisma `P2002`. **Fix:** catch
   `P2002` and throw `ConflictException('Role key already in use')`, as `createEmployee` already
   does for employee codes.
4. **Permission triples are not validated server-side.** `UpsertRoleDto` types `module`, `action`
   and `scope` as bare `string`, so a typo (`'empolyees'`) or an invented scope persists into
   `Permission` and silently grants nothing forever. **Fix:** validate against the unions with a
   `class-validator` `@IsIn(...)` or a zod schema on the DTO, and reject unknown triples with a
   `400`.
5. **The decorator's docblock and the guard's behaviour disagree on AND/OR.** The decorator
   documents stacked decorators as AND; `getAllAndMerge` plus the guard's any-match loop make it
   OR. **Fix:** correct the docblock, and if AND is ever genuinely needed, add an explicit
   `@PermissionsAll()` decorator rather than relying on stacking.
6. **`resolveResource` covers only `id`/`employeeId` and `leaveRequestId`.** Any other scoped
   param name falls through to `undefined`, which the absent-resource convention treats as
   permissive. **Fix:** make the default case throw in development (or at least log loudly) so an
   unhandled param is caught at the first request rather than shipping as a silent hole.
