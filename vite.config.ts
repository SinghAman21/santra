import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({ plugins: [tailwindcss(), react()], optimizeDeps: { include: ['xlsx'] }, base: './', server: { host: '127.0.0.1' }, build: { rollupOptions: { input: resolve(__dirname, 'index.html') } } });
