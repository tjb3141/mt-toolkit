/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        stage: '#080710',
        violet: '#8b5cf6',
        cyan: '#22d3ee',
        pink: '#f472b6',
        lime: '#a3e635',
        panel: 'rgba(18, 18, 31, 0.82)',
        'panel-strong': 'rgba(27, 25, 44, 0.92)',
        line: 'rgba(255, 255, 255, 0.12)',
      },
    },
  },
  plugins: [],
};
