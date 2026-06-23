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
      max_memory_restart: '500M',
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
