import AuditLog from '../models/AuditLog.js';

export const auditLogger = (actionDescription) => {
  return async (req, res, next) => {
    // We want to log AFTER the request finishes successfully to ensure the action actually happened.
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          await AuditLog.create({
            user: req.user?._id || null,
            action: actionDescription,
            method: req.method,
            endpoint: req.originalUrl,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent']
          });
        } catch (error) {
          console.error('[Audit Logger Error]', error);
        }
      }
    });
    next();
  };
};
