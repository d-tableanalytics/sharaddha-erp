# The shared contract

Two repositories. **One database.** This file is the list of things that must
stay true across both, and what breaks when one of them stops being true.

- `shraddha-impex-customer-portal` — Customer Portal / ERP
- this repository — Employee Portal / HRMS

The separation is at the **application** level. There is no second database, no
copied data, and no synchronisation job. Both processes open the same
`MONGODB_URI` and read and write the same documents.

---

## 1. The three environment values that must match

| Variable | Why |
|---|---|
| `MONGODB_URI` | The whole point. Same cluster, same database name. |
| `JWT_SECRET` | Both portals mint and verify access tokens for the same accounts. A different secret does not create a second login — it creates a session one portal cannot read, so an employee moving between the two is silently signed out. |
| `HRMS_LOCAL_ENCRYPTION_KEY` / `HRMS_BLIND_INDEX_KEY` | Employee PAN, Aadhaar and bank details are encrypted at rest and searched through a blind index. A different key does **not** raise an error — it produces unreadable ciphertext and blind indexes that never match, so duplicate-PAN detection quietly stops working. |

At the time of the split neither HRMS key was set in the Customer Portal's
`.env`, so existing rows were written with the compiled-in development
defaults. Leaving both unset in this repository reproduces exactly that.
`backend/.env.example` spells out the defaults and the rotation path
(`npm run hrms:migrate-keys`, which re-encrypts rows rather than orphaning them).

`NODE_ENV=production` refuses to start without `HRMS_BLIND_INDEX_KEY`. That is
deliberate.

---

## 2. The code contract — 16 files that must be byte-identical

```
config/permissions.js          config/moduleRegistry.js
utils/roleResolver.js          utils/hrmsRoleGuard.js
utils/hrmsAccessBridge.js      middlewares/rbac.js
middlewares/auth.js            middlewares/hrmsAuth.js
models/User.js                 models/Role.js
shared/permissions/{assignment,constants,has-permission,index,legacy,matrix}.js
```

Check them in either repository, independently, with no network:

```bash
cd backend && npm run verify:contract
```

`backend/shared-contract.manifest.json` records a SHA-256 per file and is
committed to **both** repositories with identical contents. A deliberate change
to the contract means editing both repositories and running
`node scripts/verify-shared-contract.js --update` in both.

### Why these files and not others

They decide how the shared `users` and `roles` documents are *interpreted*, and
the failure mode when they disagree is silent data loss, not an error.

The concrete case, worth reading once:

> `Role.grants` stores the permission matrix as rows like
> `{ module: 'hrms', submodule: 'people', actions: ['view'] }`. When a role is
> saved through **either** portal's Roles & Permissions screen, the controller
> recompiles the whole grants array from `config/moduleRegistry.js`.
>
> Delete the `hrms` module block from the Customer Portal's registry — a
> reasonable-looking cleanup, since the Customer Portal no longer serves HRMS —
> and the next role save from the Customer Portal writes back a grants array
> with every HRMS cell missing. No error. HRMS access simply disappears for
> every account on that role, and the only way back is a database restore.

So the HRMS permission keys (`access_hrms`, `manage_hrms_team`,
`manage_hrms_people`, `manage_hrms_payroll`, `manage_hrms_hiring`,
`manage_hrms_assets`, `audit_hrms`, `administer_hrms`) and the `hrms` module
block **stay in the Customer Portal**. They are a grant, not a feature. Holding
one grants nothing inside the Customer Portal; it is read by
`utils/hrmsAccessBridge.js` in *this* repository, which translates it into an
HRMS role key.

`utils/hrmsRoleGuard.js` is the same argument in the other direction: it stops
either portal writing an `hrms_*` key onto a portal-only account. Remove it from
the Customer Portal and that portal's user editor becomes a way to give a
customer payroll access.

### The one deliberate change since the split: `academy`

SI Academy added the module key `academy` to `shared/permissions/constants.js`
and its grants to `shared/permissions/matrix.js`. Both files were edited
**identically in both repositories** and both manifests re-recorded, which is
the procedure this section prescribes.

Two things make that safe, and they are worth knowing before the next such
change:

1. **It is additive.** No existing key, action, scope or role grant moved. The
   failure this section warns about is a key being REMOVED, because
   `Role.grants` is recompiled from `config/moduleRegistry.js` on every role
   save. Nothing in `shared/permissions/` is ever written back to the `roles`
   collection.

2. **`config/moduleRegistry.js` needed no edit at all.** The `hrms` block there
   is grant-only (`path: null`) because HRMS draws its own menu, so the eight
   `*_hrms` portal permissions already open Academy to the accounts entitled to
   it. The Customer Portal therefore needs no matching behaviour — it simply
   never evaluates the key. It carries the same bytes regardless, because
   identical-or-drifted is the only state `verify:contract` can check.

The manifests were updated **surgically**, for the two changed files only,
rather than by running `--update`. There was pre-existing drift in
`middlewares/auth.js` and `utils/tokens.js` at the time; a blanket `--update`
would have re-recorded those too and silently blessed a divergence nobody had
propagated. If you are making a contract change and `verify:contract` is
already reporting drift you did not cause, do the same.

---

## 3. How RBAC actually resolves

Nothing about this changed in the split. It is written down here because the
answer spans both repositories.

```
User.role  ─┐
            ├─→ resolveUserPermissions()  ─→  flat portal permission strings
Role.grants ┘        (baseline ∪ DB grants, capped for portalOnly roles)
User.extraGrants ┘
                                │
                                ▼
                    utils/hrmsAccessBridge.js
              "which HRMS ROLE KEYS does this portal access imply?"
                                │
        User.roles[]  ──────────┤  (union — the bridge can only ADD)
                                ▼
                        buildHrmsActor()
                                │
                                ▼
              shared/permissions/matrix.js  →  module × action × scope grants
                                │
                                ▼
     middlewares/hrmsAuth.js requirePermission()   (server, authoritative)
     hooks/useHrmsPermissions.js                    (client, cosmetic)
```

- **`Super Admin` / `Admin`** hold `'*'`, satisfy `administer_hrms`, and come
  away with every HRMS role key.
- **`HR`** holds `administer_hrms` in its compiled-in baseline — full HRMS,
  no sales, inventory or user administration.
- **`Customer`** is `portalOnly`. The resolver caps a portal-only role at the
  `customer_portal` module, so it can never resolve `access_hrms` no matter
  what the matrix says. That fence is enforced in `utils/roleResolver.js`, and
  a second time structurally in `buildHrmsActor()`, which only derives grants
  from `hrms_*` keys.

The baseline in `config/permissions.js` is a **floor**: a user's effective
permissions are `baseline(role) ∪ Role.grants ∪ User.extraGrants`. The matrix
can add, never revoke. `npm run verify:rbac` proves the floor still holds,
without a database — run it in either repository.

---

## 4. Who owns which background job

Both processes reach the same collections, so every scheduled writer needs
exactly one owner.

| Job | Owner | Notes |
|---|---|---|
| `runReservationExpiryChecks` | Customer Portal | writes bookings |
| `runPoSettlement` | Customer Portal | settles purchase orders |
| `sweepUploads` | Customer Portal | its own import staging |
| `runWeeklyInventoryReport` | Customer Portal | claims a period in `ReportRun` |
| `runWeeklyHistoryReport` | Customer Portal | claims a period in `ReportRun` |
| `seedDefaultRoles` / `seedInventoryDefaults` / `seedAlertRules` | Customer Portal | one writer for seed data |
| **`runHrmsRetentionSweep`** | **being handed over** | see below |

`tests/retention.test.js` asserts that none of the Customer Portal jobs appear
in this repository's `server.js`, so the table above is enforced rather than
merely documented.

### Handing over the retention sweep

It **deletes** — audit rows, attendance selfies, employee documents, inbox
items. Today the Customer Portal still schedules it at 00:00. This repository
ships it **off**:

```
1.  deploy this portal with HRMS_RETENTION_CRON unset      ← you are here
2.  remove the runHrmsRetentionSweep call from the Customer Portal's
    daily cron in server.js (and its two imports)
3.  set HRMS_RETENTION_CRON=enabled here, and restart
```

Only the exact string `enabled` turns it on. An unset variable, an empty string
and a stray `false` all mean "the Customer Portal still owns this", which is the
safe direction to fail.

---

## 5. What each portal serves

| | Customer Portal | Employee Portal |
|---|---|---|
| `/api/v1/auth` | ✅ | ✅ same controller, same accounts |
| `/api/v1/users` | ✅ | ✅ same controller, same accounts |
| `/api/v1/roles` | ✅ | ✅ same controller, same documents |
| `/api/v1/hrms/**` | — | ✅ |
| `/api/v1/orders`, `/products`, `/inventory`, `/sales`, `/reservations`, `/notifications`, `/product-details` | ✅ | — |
| `/api` legacy catch-all | ✅ | — |
| Socket.io | ✅ inventory alerts | — HRMS polls |

`auth`, `users` and `roles` are served by both on purpose: an employee must be
able to sign in here without bouncing through the Customer Portal, and HR must
be able to grant an HRMS role from the portal where HRMS lives. Both write the
same documents through the same code — which is exactly why §2 exists.

The HRMS namespace is **unchanged** (`/api/v1/hrms`, and `/hrms/*` in the SPA).
`HRMS_ROUTE_PREFIX` in `shared/constants/hrms.js` is compiled into nav items,
in-app links and inbox rows already sitting in the database, so renaming the
routes would have invalidated links people have been sent.

---

## 6. Cross-portal data references

Deliberately few. Nothing was renamed, dropped or re-keyed.

- **`users`** — one collection, both portals. `User.role` is the portal role;
  `User.roles[]` holds `hrms_*` keys; `User.extraGrants` is per-user extra
  access. Customer-specific fields (`brandAccess`, `customerCategory`,
  `gstNumber`, `moq`, …) sit on the same document and are simply not read here.
- **`roles`** — one collection, both portals, recompiled by whichever saves
  last. §2 is what makes that safe.
- **`auditlogs`** — written by both. HRMS reads it through
  `/api/v1/hrms/audit-logs`.
- **`Employee.userId → users._id`** — the link between an employee record and
  a portal login. Unchanged.
- **`orders`** — read-only from here, in exactly one place:
  `scripts/hrms/import-client-workbook.js` counts a linked account's existing
  bookings when attaching an `Employee` to a `User`, and reports the number.
  `models/Order.js` is carried for that read alone; nothing in this repository
  writes it.

---

## 7. Running both at once

| | Customer Portal | Employee Portal |
|---|---|---|
| API | `:5000` (prod `:4000`) | `:5001` (prod `:4001`) |
| SPA dev server | `:5173` | `:5174` |
| PM2 process | `shraddha-backend` | `shraddha-employee-backend` |

```bash
# terminal 1
cd "Customer portal module/backend" && npm run dev
cd "Customer portal module/frontend" && npm run dev

# terminal 2
cd "Employee portal module/backend"  && npm run dev
cd "Employee portal module/frontend" && npm run dev
```

Both log the Mongo host they connected to at boot. They must match.
