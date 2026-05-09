module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'skillbridge-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',

      env_production: {
        NODE_ENV: 'production',
        PORT: 3003,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3004,
      },
    },
  ],
};
