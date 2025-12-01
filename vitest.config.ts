import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.{test,spec}.ts',
      'src/**/*.{test,spec}.ts'
    ],
    exclude: [
      'tests/e2e/**',
      '**/*.d.ts',
      '**/*.js',
      'dist/**',
      'node_modules/**'
    ],
    environment: 'node',
    globals: true,
    coverage: {
      reporter: ['text', 'html']
    }
  }
});