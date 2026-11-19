import { defineConfig } from 'vite';
export default defineConfig({ root: 'web', server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3001', '/rpc': { target: 'http://127.0.0.1:8545', rewrite: () => '/' } } }, build: { outDir: '../dist', emptyOutDir: true } });
