# Deploying the Employee Portal — Render (API) + Vercel (SPA)

Backend to Render, frontend to Vercel. Both halves talk to the **same MongoDB as
the Customer Portal**, which is the constraint that shapes most of what follows.

---

## Before you touch either platform

Four values must be **byte-identical** to the Customer Portal's. They are not
"should match" — each fails in its own quiet way if it does not.

| Variable | What a mismatch does |
|---|---|
| `MONGODB_URI` | A second database. The portals stop seeing each other's users. |
| `JWT_SECRET` | A session minted by one portal is rejected by the other. Crossing between them signs the user out. |
| `HRMS_BLIND_INDEX_KEY` | Existing employee PII stops being findable. Duplicate-PAN checks silently pass. |
| `HRMS_LOCAL_ENCRYPTION_KEY` | Existing PAN / Aadhaar / bank rows decrypt to garbage. **No error is raised.** |

None of these throw on mismatch. Copy them across before the first deploy; do
not rotate them by editing a dashboard — use `npm run hrms:migrate-keys`, which
re-encrypts the existing rows.

---

## 1. Backend → Render

`render.yaml` at the repo root is a Blueprint. Either point Render at it, or
create a Web Service by hand with the same settings:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/health` |
| Instances | **1** — see *Scheduled jobs* below |

Then set every `sync: false` variable in the Render dashboard.
`backend/.env.example` documents all 65, with the reasoning for each.

**Do not set `PORT`.** Render injects it. A fixed value means the app listens
where the health check is not looking, and the deploy fails as "unhealthy".

### Two settings that are not optional on Render

**`STORAGE_DRIVER=s3`.** Render's filesystem is ephemeral — wiped on every
deploy and restart. The `local` driver would lose every uploaded document,
payslip and résumé without reporting an error. The driver already refuses to run
in production for exactly this reason, so a misconfiguration fails at boot
rather than silently. You need `AWS_REGION`, `AWS_S3_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `HRMS_S3_KMS_KEY_ID`
(SSE-KMS is required; the driver refuses to fall back to SSE-S3).

**`HRMS_BLIND_INDEX_KEY`.** Production refuses to start without it. That is
deliberate: a production blind index computed from the development default would
make uniqueness checks meaningless.

---

## 2. Frontend → Vercel

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Vite (detected) |
| Environment | `VITE_API_URL` = your Render URL, e.g. `https://shraddha-employee-portal-api.onrender.com` |

`VITE_API_URL` is the **only** variable the SPA reads. `services/api.js` appends
`/api/v1` itself, so give the bare origin with **no trailing slash and no
path**.

`vercel.json` handles the rest: SPA rewrites so a deep link like
`/fms/o2d/stages` does not 404 on refresh, immutable caching for hashed assets,
`no-cache` for `index.html` so a deploy is picked up immediately, and baseline
security headers.

`Permissions-Policy` allows `geolocation` and `camera` for the same origin —
HRMS attendance needs both for selfie punch-in. Tightening those breaks it.

---

## 3. The one that will bite you: cross-site cookies

**Set `CROSS_SITE_COOKIES=true` on Render.**

`app.vercel.app` and `api.onrender.com` are different registrable domains, so
every request between them is cross-site. The refresh token is an httpOnly
cookie that ships `SameSite=Strict` by default — and a `Strict` cookie is simply
**not sent** on a cross-site request.

The failure is not an error. Login works. The app works for one access-token
lifetime. Then every refresh 401s and the user is signed out. From the outside it
looks like "it logs me out every fifteen minutes"; in the Render logs it is
`No refresh token`.

This flag switches the cookie to `SameSite=None; Secure` and forces `Secure` on,
because browsers reject `None` without it — half-right means the cookie is never
stored at all.

> **Better, if you own a domain:** serve the SPA from `app.example.com` and the
> API from `api.example.com`. Those are same-site, `Strict` keeps working, and
> the CSRF surface stays closed. Then delete this flag. What `None` actually
> costs is written out above `refreshCookieOptions()` in `utils/tokens.js` — it
> is a nuisance, not a session takeover, but it is not nothing.

### CORS

`FRONTEND_URL` is allowed automatically. Add `CORS_ORIGINS` (comma-separated)
for anything else — a custom domain, or Vercel **preview** deployments, whose
URL changes per branch.

A refused origin is logged as `[CORS] refused origin: <url>`. Check the Render
logs first when the browser reports a CORS error; the answer is almost always a
trailing slash or a preview URL nobody added.

---

## 4. Scheduled jobs — read before scaling

The FMS SLA sweep, daily summary and invoice retry run **in-process** via
node-cron, gated on `O2D_CRON=enabled`.

**Two instances run them twice.** Every escalation fires twice and the daily
summary is mailed twice. Nothing errors — the recipients just stop trusting the
alerts. So: `numInstances: 1`, and turn `O2D_CRON` off before scaling up, moving
the jobs to a Render Cron Job or an external scheduler.

**On Render's free tier the service sleeps when idle, and sleeping crons do not
fire.** Overdue escalations and the daily summary are simply missed. The
blueprint uses `starter`, which does not spin down. If you must use `free`,
treat FMS notifications as unreliable and drive them from outside.

### The retention sweep — leave it off at first

`HRMS_RETENTION_CRON` **deletes** audit rows, attendance selfies and documents
past their window. Both portals point at one database and the Customer Portal
still schedules it. Enabling it here first means two deleters racing.

Order: deploy with it unset → remove `runHrmsRetentionSweep` from the Customer
Portal's cron → *only then* set `enabled` here.

---

## 5. After the first deploy

```bash
curl https://<your-api>.onrender.com/health
# {"success":true,"message":"Employee Portal (HRMS) backend is running."}
```

Then, in the browser:

1. Sign in. Open DevTools → Application → Cookies and confirm the refresh cookie
   shows `SameSite=None` and `Secure`. If it is absent, `CROSS_SITE_COOKIES` is
   not set.
2. **Wait out one access-token lifetime and keep using the app.** This is the
   step people skip, and it is the only one that proves the cookie fix works.
3. Open **FMS → O2D → Stages** and confirm the twelve stage tabs load.
4. Check Render logs for `[CORS] refused origin` and `[O2D] Escalation sweep
   scheduled`.

### Zoho webhook

Point Zoho at `https://<your-api>.onrender.com/api/v1/o2d/webhooks/zoho` and set
`ZOHO_WEBHOOK_SECRET` to the same value on both sides. That route has no session
by design — Zoho holds no JWT — and authenticates by an HMAC over the raw body.
**Without the secret it refuses every request**, which is the safe default, not
a bug.

---

## Verification before you deploy

```bash
cd backend  && npm test && npm run verify:rbac && npm run verify:contract
cd frontend && npx vitest run && npx vite build
```

`verify:contract` must pass in **both** repositories. `utils/tokens.js`,
`config/moduleRegistry.js` and `config/permissions.js` are shared-contract files:
a change to one that is not propagated makes one portal strip grants the other
wrote.
