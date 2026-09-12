import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/errorHandler.js';

// Route imports
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import roleRoutes from './modules/roles/role.routes.js';
import hrmsRoutes from './modules/hrms/hrms.routes.js';
import o2dRoutes from './modules/o2d/o2d.routes.js';
import checklistRoutes from './modules/checklist/checklist.routes.js';
import delegationRoutes from './modules/delegation/delegation.routes.js';
import { captureBiometricRawBody } from './modules/hrms/attendance/rawBody.js';
import { captureZohoRawBody } from './modules/o2d/zoho-webhook.js';

const app = express();

// Behind a hosting proxy/load balancer, req.ip is the proxy's address unless we
// trust the X-Forwarded-For header. Without this every user shares one identity,
// so anything keyed on IP (the login brute-force guard, the biometric and
// careers rate limiters) would count the whole userbase as a single client.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());

const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:5174'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(compression());
// `verify` keeps the RAW bytes of the biometric webhook's body, and only that
// route's. Its HMAC signature is computed over the exact bytes the device sent,
// and this parser consumes the stream before any router runs — so without this
// hook there would be nothing left to verify against. See
// modules/hrms/attendance/rawBody.js. Every other request is unaffected.
/**
 * Two signed webhooks need their raw bytes, so both capture hooks run.
 *
 * Each is scoped to its own path and ignores everything else, so this is not
 * "buffer every request" — it is two URL tests per request, and a second copy
 * of the body only for the two endpoints that must verify a signature over it.
 */
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf, encoding) => {
      captureBiometricRawBody(req, res, buf, encoding);
      captureZohoRawBody(req, res, buf, encoding);
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

/*
 * Routes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY auth / users / roles ARE HERE AND NOT ONLY IN THE CUSTOMER PORTAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The two portals share ONE database, and therefore one `users` collection and
 * one `roles` collection. This repository does not own a second identity
 * system — it authenticates the same accounts against the same documents with
 * the same JWT secret, using a copy of the same code.
 *
 * The Employee Portal needs all three:
 *
 *   /auth   an employee has to be able to sign in here without bouncing
 *           through the Customer Portal;
 *   /users  HR and Admin assign the portal role that the HRMS access bridge
 *           reads (utils/hrmsAccessBridge.js), and the per-user extra grants;
 *   /roles  the permission matrix is where `access_hrms`, `manage_hrms_*` and
 *           `administer_hrms` are granted in the first place.
 *
 * Both repositories keep these routes and both write the same documents. The
 * files under config/, middlewares/rbac.js, utils/roleResolver.js,
 * utils/hrmsRoleGuard.js and shared/permissions/ are therefore a CONTRACT, not
 * merely shared convenience code: they must stay byte-identical across the two
 * repositories or one portal will strip grants the other wrote. See
 * SHARED-CONTRACT.md.
 */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/roles', roleRoutes);

// HRMS. Its router owns its own auth chain: protect -> attachHrmsActor ->
// requireHrmsAccess, so no HRMS endpoint can be reached without HRMS
// authorization.
//
// The path is unchanged from the Customer Portal (/api/v1/hrms) on purpose:
// every service module under frontend/src/services/hrms/ already addresses it,
// and an employee's bookmarked deep link keeps resolving.
app.use('/api/v1/hrms', hrmsRoutes);

// Order-to-Dispatch. Employee-domain only, and its router says so itself: the
// first middleware is `requirePortalModule('o2d')`, which 404s anywhere the
// registry does not list this portal as serving the module. Mounting it here
// unconditionally is therefore safe — the fence travels with the routes rather
// than depending on this line being written correctly in each repository.
app.use('/api/v1/o2d', o2dRoutes);

// Checklist — compliance task tracking, part of the Work Queue group.
// Gated on view_o2d like the rest of the Work Queue.
app.use('/api/v1/checklist', checklistRoutes);

// Delegation — task delegation & verification, part of the Work Queue group.
// Gated on view_o2d like the rest of the Work Queue.
app.use('/api/v1/delegation', delegationRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Employee Portal (HRMS) backend is running.' });
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: 'API Route Not Found' });
});

// Global Error Handler
app.use(errorHandler);

export default app;
