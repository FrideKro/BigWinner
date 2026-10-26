import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        // 矮屏（手机横屏等）专用断点
        short: { raw: '(max-height: 640px)' },
      },
      colors: {
        gold: {
          50: '#fbf8eb',
          100: '#f5edcb',
          200: '#edd99a',
          300: '#e2bf60',
          400: '#d9a736',
          500: '#c98e22',
          600: '#ad6f1a',
          700: '#8a5218',
          800: '#73421a',
          900: '#62371b',
        },
      },
    },
  },
  plugins: [],
};

export default config;
