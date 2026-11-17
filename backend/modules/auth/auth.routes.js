import express from 'express';
import { login, refresh, logout, getMe, getAccessVersion, updateMe, changePassword } from './auth.controller.js';
import { protect } from '../../middlewares/auth.js';
import { loginLimiter, refreshLimiter, passwordLimiter } from '../../middlewares/rateLimiters.js';

const router = express.Router();

// AD-8: the limiters are targeted at authentication only. Every other portal
// route stays unthrottled, as it was.
router.post('/login', loginLimiter, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', logout);

router.get('/me', protect, getMe);
// Polled by the browser to notice access changes without a re-login.
router.get('/access-version', protect, getAccessVersion);
router.patch('/me', protect, updateMe);
router.put('/me/password', protect, passwordLimiter, changePassword);

export default router;
