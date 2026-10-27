import eslintConfigPrettier from 'eslint-config-prettier';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat();

const eslintConfig = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'next-env.d.ts', 'scripts/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // Prettier 负责格式，关闭与之冲突的 ESLint 格式规则
  eslintConfigPrettier,
];

export default eslintConfig;
