#!/usr/bin/env node

/**
 * Simple debug script to run the test app and see console output
 * Run with: node test-app/debug-utility.js
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Electron app with debug output...\n');

// Run electron with the test-app
const electron = spawn(
  'npx',
  ['electron', path.join(__dirname, 'dist', 'main.js')],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      NODE_ENV: 'development'
    }
  }
);

electron.on('close', (code) => {
  console.log(`\nElectron app exited with code ${code}`);
  process.exit(code);
});

electron.on('error', (err) => {
  console.error('Failed to start Electron:', err);
  process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  electron.kill('SIGTERM');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
