import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

export default defineConfig(({ command }) => {
  if (command === 'serve') process.umask(0o077);
  return {
    server: { watch: { usePolling: process.env.VITE_USE_POLLING === 'true', interval: 300 } },
    resolve: { dedupe: ['react', 'react-dom'], alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [tailwind(), tanstackStart(), nitro({ preset: 'node-server' }), react()],
  };
});
