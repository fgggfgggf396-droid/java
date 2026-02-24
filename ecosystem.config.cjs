// PM2 Ecosystem Config — Sovereign X 24/7 Trading Bot
module.exports = {
  apps: [
    {
      name: "sovereign-x",
      script: "dist/index.js",
      interpreter: "node",
      args: [],

      // ---- 24/7 Auto-Restart ----
      autorestart: true,         // Restart if it crashes
      watch: false,              // Don't watch files (production)
      max_restarts: 100,         // Max restart attempts
      restart_delay: 5000,       // Wait 5s before restarting
      min_uptime: "10s",         // Min uptime before considered "started"

      // ---- Startup on Server Boot ----
      // Run: pm2 startup && pm2 save  (after first launch)

      // ---- Log Files ----
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_log_size: "10M",
      rotate_logs: true,

      // ---- Environment ----
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // ---- Node.js flags ----
      node_args: "--max-old-space-size=512",

      // ---- Instance ----
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
