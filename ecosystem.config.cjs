// PM2 process definition for the Shraddha Impex Employee Portal (HRMS).
//
// Only the backend runs as a process. The frontend is a Vite SPA that compiles
// to static files, which nginx serves directly from frontend/dist — there is no
// node process to keep alive for it.
//
// .cjs, not .js: backend/package.json sets "type": "module", and PM2 loads this
// file with require().
//
// ─────────────────────────────────────────────────────────────────────────────
// A DIFFERENT NAME AND A DIFFERENT PORT FROM THE CUSTOMER PORTAL
// ─────────────────────────────────────────────────────────────────────────────
// The Customer Portal runs as `shraddha-backend` on 4000. Reusing either would
// mean PM2 replacing that process, or two processes fighting over a socket —
// and the two are meant to run side by side against the same database.
module.exports = {
  apps: [
    {
      name: 'shraddha-employee-backend',
      cwd: '/var/www/shraddha-employee-portal/backend',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      // The box runs ~15 other apps on 3.7 GB with no swap. Capping the heap
      // means a leak in this app restarts this app, instead of the OOM killer
      // picking a victim among the neighbours.
      max_memory_restart: '400M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
        // The retention sweep DELETES, and the Customer Portal still schedules
        // it. Left out of this block on purpose: it belongs in the server's
        // .env, where flipping it is a deliberate, reviewed act rather than a
        // side effect of a deploy. See SHARED-CONTRACT.md §4.
      },
      error_file: '/var/log/pm2/shraddha-employee-backend.error.log',
      out_file: '/var/log/pm2/shraddha-employee-backend.out.log',
      merge_logs: true,
      time: true,
      // server.js exits the process on uncaughtException; let PM2 bring it back,
      // but back off so a crash loop does not spin the CPU.
      autorestart: true,
      restart_delay: 4000,
      max_restarts: 10,
    },
  ],
};
