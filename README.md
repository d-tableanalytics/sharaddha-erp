# Shraddha Impex — Employee Portal (HRMS)

The employee-facing half of the Shraddha Impex system: employee master, org
structure, attendance, leave, payroll, expenses, assets, documents, helpdesk,
hiring, onboarding, performance, engagement, planning, reports and the audit
trail — plus the public careers site.

Split out of the Customer Portal repository. **It shares that system's
database.** Read [`SHARED-CONTRACT.md`](./SHARED-CONTRACT.md) before changing
anything under `config/`, `middlewares/rbac.js`, `middlewares/auth.js`,
`utils/roleResolver.js`, `utils/hrms*Guard/Bridge.js`, `models/User.js`,
`models/Role.js` or `shared/permissions/` — those files are a contract with the
Customer Portal, and breaking it destroys data silently.

```
                     ONE DATABASE
                          │
             ┌────────────┴────────────┐
             │                         │
      Customer Portal            Employee Portal
   (separate repository)          (this repository)
             │                         │
   orders · products         employees · attendance · leave
   inventory · bookings      payroll · hiring · onboarding
   indents · sales           expenses · assets · documents
             │                         │
             └──── users · roles ──────┘
                   (shared, one copy)
```

---

## Layout

```
backend/                Express 4 + Mongoose 8, ESM
  app.js                /auth, /users, /roles, /hrms — and nothing else
  server.js             boot, HRMS bootstrap, the one (guarded) cron
  config/               database, permission vocabulary, module registry
  middlewares/          auth, rbac (portal), hrmsAuth (HRMS), validate, limits
  models/               User, Role, AuditLog, ArchivedUser, Order (read-only)
    hrms/               29 HRMS models + the sensitive-field plugin
  modules/
    auth/ users/ roles/ shared identity surface (see SHARED-CONTRACT §2)
    hrms/               27 HRMS sub-modules, mounted by hrms.routes.js
  shared/               permissions matrix, Zod schemas, payroll engine,
                        constants — imported by BOTH halves via `@shared`
  utils/                mailer, audit, crypto (PII), storage (S3/local), tokens
  scripts/              verify:rbac, verify:contract, HRMS import & key rotation
  tests/                39 files, 1,344 assertions, node:test

frontend/               React 19 + Vite + Tailwind 4
  src/pages/Hrms/       136 files — every HRMS screen
  src/pages/Careers/    the public careers site (no session)
  src/pages/Admin/      user management, permission matrix
  src/components/hrms/  HRMS-specific UI, nav items, permission gate
  src/components/ui/    the shared UI kit
  src/routes/index.jsx  /hrms/* — the prefix is unchanged, see below
```

---

## Running it

```bash
cd backend  && cp .env.example .env   # then fill it in
npm install && npm run dev            # :5001

cd ../frontend
cp .env.example .env                  # VITE_API_URL=http://localhost:5001
npm install && npm run dev            # :5174
```

Ports differ from the Customer Portal's (`:5000` / `:5173`) so both can run
against the same database at once.

### Three values must match the Customer Portal's `.env`

`MONGODB_URI`, `JWT_SECRET`, and the HRMS encryption keys. The consequences of
each mismatch are in [`SHARED-CONTRACT.md §1`](./SHARED-CONTRACT.md). The
encryption one is the dangerous one: it fails **silently**, by making existing
employee PII unreadable rather than by raising an error.

---

## Checks

```bash
cd backend
npm test                # 1,344 assertions
npm run verify:rbac     # no role lost a permission — no database needed
npm run verify:contract # the 16 shared files match the recorded manifest

cd ../frontend
npm test                # 738 assertions
npm run build
npm run lint
```

`verify:rbac` and `verify:contract` both run without a database or a network,
so they belong in CI and in a pre-deploy check.

---

## Routes keep the `/hrms` prefix

It is tempting to drop it — this app is nothing but HRMS. It is kept because
`HRMS_ROUTE_PREFIX` (in `shared/constants/hrms.js`) is what every nav item,
in-app link and inbox notification is built from, and those rows are already in
the database. Renaming would mean editing ~150 files and invalidating links
people have already been sent.

So `/hrms/leave`, `/api/v1/hrms/leave` and every bookmark still resolve.

---

## Two unauthenticated surfaces, both deliberate

Everything else sits behind `protect → attachHrmsActor → requireHrmsAccess`,
applied once on the HRMS router so an endpoint cannot be added without it.

- **`/api/v1/hrms/attendance/biometric`** — a punch clock holds no session. It
  authenticates with an HMAC-SHA256 signature over the **raw** request body,
  which is why `app.js` keeps those bytes with a `verify` hook on that route
  alone. Without `HRMS_BIOMETRIC_WEBHOOK_SECRET` it refuses everything.
- **`/api/v1/hrms/careers`** — a job applicant has no account. Offers are
  addressed by a 256-bit token stored hashed and compared in constant time;
  the listing exposes only published adverts; everything is rate limited and
  every refusal is audited.

---

## The one background job

`runHrmsRetentionSweep` deletes expired audit rows, attendance selfies,
employee documents and inbox items. It is **off** until
`HRMS_RETENTION_CRON=enabled`, because the Customer Portal still schedules it
and both point at the same database. See
[`SHARED-CONTRACT.md §4`](./SHARED-CONTRACT.md) for the handover order.

---

## Design records

`documentation/` carries the AD-1…AD-16 architecture decisions the HRMS code
cites by number, plus the module inventory, API map, component map and
dependency map. They moved with the module they document.
