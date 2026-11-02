import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    // 统一使用 jsdom：组件测试需要 DOM，纯逻辑测试在 jsdom 下同样可跑
    environment: 'jsdom',
    // vmThreads 池按 worker 复用 jsdom 环境（仍保留每文件隔离），
    // 避免默认 forks 池为每个测试文件重复创建 jsdom 的高额开销
    pool: 'vmThreads',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // 组件测试在并行负载下偶发超时，放宽单测/钩子时限
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
