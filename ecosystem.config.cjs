// PM2 process config for the D Magazine Content Intelligence dashboard.
// Usage on the server:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'dmag-dashboard',
      script: 'server/index.js',
      // Load secrets/config from .env (must include NODE_ENV=production)
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: true,
      // Was 500M — too tight against the content.db working set (nearing 1GB) plus
      // Node/V8 + in-flight sync-loop overhead. A kill mid-sync (SIGKILL, uncatchable)
      // left `last_wp_sync` stuck without ever writing an error, silently freezing
      // WordPress sync for 6+ weeks. Raised so the sync loop has headroom to finish.
      max_memory_restart: '1.5G',
      // Fallback envs in case .env doesn't set them
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
      // Keep logs in ./logs
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
