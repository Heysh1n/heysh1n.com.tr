module.exports = {
  apps: [
    {
      name: 'heysh1n-backend',
      cwd: './backend',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '1G',
      autorestart: true,
      time: true,
    },
    {
      name: 'heysh1n-frontend',
      cwd: './frontend',
      script: 'npx',
      args: 'astro preview --port 4321 --host 0.0.0.0',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
      autorestart: true,
      time: true,
    },
  ],
};
