module.exports = {
  apps: [
    {
      name: 'avishifo-api',
      cwd: '/home/ubuntu/avishifo/apps/api',
      script: 'dist/main.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
    {
      name: 'avishifo-web',
      cwd: '/home/ubuntu/avishifo/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
    },
    {
      name: 'avishifo-display',
      cwd: '/home/ubuntu/avishifo/apps/display',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
    {
      name: 'avishifo-portal',
      cwd: '/home/ubuntu/avishifo/apps/portal',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3003',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
