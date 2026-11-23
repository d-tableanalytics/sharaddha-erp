# Employee Portal ↔ HRMS — automatic employee synchronisation

HR never creates the same person twice. An account made anywhere in the
Employee Portal gets its HRMS employee record automatically, and the two stay in
step afterwards.

This document is the map: what is connected, what the rules are, what it
deliberately will not do, and what to run when something goes wrong.

---

## 1. What was wrong before

HRMS could already create a portal login — `createEmployee` writes a `User` and
an `Employee` in one transaction, and the bulk import does the same through
`linkOrCreateUser`. **The other direction did not exist.**

An administrator adding a salesperson in *Admin → User Management* got an
account that could sign in, hold permissions and raise a PO, with no employee
record at all. HR then typed the same person in again from the HRMS side, and
the two records agreed only until somebody edited either one.

---

## 2. The one mapping

```
User._id  ←→  Employee.userId
```

That is the whole of it, and it is enforced **in the database** by the partial
unique index on `Employee.userId` (`models/hrms/Employee.js`). Duplicate
prevention is therefore not a fuzzy search for look-alike names — it is a lookup
on `userId`, and two syncs racing each other end in a duplicate-key error rather
than in two employees.

`employeeCode` stays HRMS's own natural key (AD-11). Records the portal creates
get a generated `EMP0001`-style code; imported records keep whatever code the
business already uses, and the generator never touches them.

### Who owns which field

| Field | Owner | Notes |
|---|---|---|
| Login / work email | `User.email`, held **once** | `Employee` does not copy it, so there is nothing to keep in step. Changing it is `PATCH /employees/:id/email`. |
| Name | both | HRMS → portal already existed (`updateEmployee` writes `User.user`); portal → HRMS is new. Last write wins — they are two screens editing one person's name. |
| Status | both, through the mapping tables below | Deliberately **not** total inverses. |
| Everything else | HRMS | Date of birth, addresses, department, location, manager, employment type, compensation. Seeded at creation only; the portal never overwrites them, because it does not collect them and an empty portal field must not erase an HR one. |

---

## 3. Where it is wired in

Every portal path that creates or changes a **staff** account calls
`syncUserSafely` (`modules/hrms/employees/employeeSync.service.js`):

| Path | Trigger label |
|---|---|
| `POST /api/v1/users` | `user.created` |
| `PATCH /api/v1/users/:id` | `user.updated` |
| `PATCH /api/v1/users/:id` on an archived account | `user.updated.archived` |
| `PATCH /api/v1/users/:id` → `Suspended` | `user.suspended` |
| `PATCH /api/v1/users/:id` → back to Active | `user.restored` |
| `PUT /api/v1/users/:id/roles` | `user.role_changed` |
| `PATCH /api/v1/auth/me` (own display name) | `profile.updated` |
| retry sweep | `sync.retry` |
| reconciliation sweep | `sync.reconcile` |

The call is **awaited** on the request path, so an administrator sees the
outcome in the same response (`POST /users` answers `{ success, data, hrms }`).
It can never fail the request: `syncUserSafely` reports instead of throwing.

---

## 4. The rules

### Who gets a record

Every account whose portal role is **not portal-only**. AD-4 makes Customer and
Employee mutually exclusive, so a Customer never gets one; Admin, Sales,
Management, Inventory Manager and any role a Super Admin invents all do. The
question is asked of `isPortalOnlyRole`, which reads the compiled-in list *and*
the `portalOnly` flag on the live `Role` document — so a role fenced after this
was written is excluded without a code change.

Staff accounts also get `hrms_employee` added to `User.roles`. Without it the
employee record exists and nobody can open it: `requireHrmsAccess` refuses the
whole module. The portal role is untouched, so every existing permission check
is unaffected.

### Status, portal → HRMS

**On create:**

| Portal | Employee |
|---|---|
| `Active` | `active` |
| `Inactive` | `invited` — the exact inverse of `createEmployee`, so a record round-tripping through both directions does not drift |
| `Suspended` | `suspended` |

**On update** — a different, deliberately partial table. The employee status
carries distinctions the portal has no words for, so the rule is: *the portal
may say whether someone has access, never what stage of employment they are at.*

| Portal | Employee now | Result |
|---|---|---|
| Active | `suspended` or `invited` | → `active` |
| Active | anything else | left alone (`probation` and `notice` survive) |
| Inactive / Suspended | `invited` or `exited` | left alone |
| Inactive / Suspended | anything else | → `suspended` |

### Status, HRMS → portal

`updateEmployee` maps the employee status back onto the login:

| Employee | Portal |
|---|---|
| `suspended`, `exited` | `Suspended`, open sessions revoked |
| `invited` | `Inactive` |
| `active`, `probation`, `notice` | `Active`, sessions left alone |

> **This fixes a live bug.** The condition used to read
> `dto.status === 'inactive'`, and `inactive` is not an employee status — the
> enum is `invited / active / probation / notice / exited / suspended`, and the
> zod schema refuses anything else. The branch could never be true, so
> suspending somebody from the HRMS side left their login working. The only path
> that actually suspended an account was `deactivateEmployee`.

### Names

`User.user` is one free-text box; `Employee` wants a first and a last name.
First token / the rest, which is the convention `updateEmployee` already uses in
reverse.

- No display name at all → the email local part (`priya.sharma@` → *Priya
  Sharma*).
- One word, **on create** → surname `-`, visibly a placeholder, and the audit
  entry carries `placeholderName: true` so HR knows to finish it.
- One word, **on update** → the HRMS name is left alone. Somebody shortening
  "Priya Sharma" to "Priya" in their own profile must not damage the HR record.

### Date of joining

`User.createdAt`, not today. An account opened a year ago and only reconciled
now did not start today, and `dateOfJoining` feeds probation windows, leave
accrual and tenure reports.

---

## 5. What it will not do

**It never resurrects a deactivated employee.** A soft-deleted record is left
exactly as it is, and the portal stops recreating it. That makes deactivation
the documented way to say *"this login is not a person"* — service accounts and
integration logins live there.

**It never touches a Customer**, in either direction.

**It never overwrites HR data with a blank.** Only the name, the status and the
`hrms_employee` key are written on an update.

### One consequence worth knowing

Because every staff account now holds `hrms_employee`, AD-4 would refuse to
demote any of them to Customer. That is answered properly rather than left as a
409 nobody can act on:

- **a live employee record** → refused, naming the record and the one step that
  settles it ("deactivate the employee record in HRMS first");
- **no record, or a deactivated one** → the HRMS roles are cleared in the same
  write as the role change.

---

## 6. When it fails

A sync that fails leaves a row in `employeesyncjobs` (`EmployeeSyncJob`). One
row per **account**, not per attempt, so the backlog is a count of people rather
than a count of retries. **Nothing is ever dropped:** attempts grow without a
ceiling and the backoff caps at six hours, so a record that cannot be written
stays visible and keeps being retried.

Rows are deleted on success. The permanent trail lives in `AuditLog` under
`hrms.employee.sync.created`, `.updated`, `.failed` and `.sweep`.

### Two sweeps, both in `server.js`

| Sweep | Default | What it is for |
|---|---|---|
| Retry | every 5 min | drains the backlog |
| Reconcile | 02:30 IST, and once ~20 s after boot | every staff account with no record gets one — the backstop for accounts no inline call ever saw |

Both default **ON**, unlike the sweeps that send mail: they are idempotent
writes behind a unique index, so a second process racing a first loses and does
nothing, while the cost of leaving them off is employees silently missing from
the HRMS.

```
HRMS_EMPLOYEE_SYNC_CRON=disabled            # turn both off (inline sync still runs)
HRMS_EMPLOYEE_SYNC_RETRY_SCHEDULE           # default */5 * * * *
HRMS_EMPLOYEE_SYNC_RECONCILE_SCHEDULE       # default 30 2 * * *
HRMS_EMPLOYEE_SYNC_TIMEZONE                 # default Asia/Kolkata
HRMS_EMPLOYEE_SYNC_BOOT_DELAY_MS            # default 20000
HRMS_EMPLOYEE_CODE_PREFIX                   # default EMP
```

### Looking and intervening

```
GET  /api/v1/hrms/employees/sync/status     # the backlog + the error behind each row
POST /api/v1/hrms/employees/sync/run        # drain + reconcile now
POST /api/v1/hrms/employees/sync/run?dryRun=true
```

Reading the backlog needs `employees:edit:org`; running the sweep needs
`employees:create:org` — exactly what creating an employee by hand needs, so
this cannot become a side door around it.

From the command line:

```
npm run hrms:sync-employees              # dry run: lists what would be created
npm run hrms:sync-employees -- --execute
npm run hrms:sync-employees -- --status  # just the backlog
npm run hrms:sync-employees -- --execute --retry
```

---

## 7. Files

| File | Role |
|---|---|
| `modules/hrms/employees/employeeSync.service.js` | the whole integration: mapping, sync, queue, sweeps |
| `models/hrms/EmployeeSyncJob.js` | the outbox |
| `modules/users/user.controller.js` | create / update / suspend / restore / role change hooks |
| `modules/auth/auth.controller.js` | self-service profile hook |
| `modules/hrms/employees/employee.service.js` | HRMS → portal status mapping |
| `modules/hrms/employees/employee.{controller,routes}.js` | the two sync endpoints |
| `server.js` | the retry and reconciliation crons |
| `scripts/hrms/sync-portal-employees.js` | the operator's copy of the sweep |
| `tests/employee-portal-sync.test.js` | 30 tests, against a real MongoDB |
