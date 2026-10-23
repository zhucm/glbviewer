import { defineConfig } from 'vite';
import { createGlbPreviewMiddleware } from './tools/glb-preview-server.js';

const localFiles = {
  name: 'local-glb-files',
  configureServer(server) { server.middlewares.use(createGlbPreviewMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createGlbPreviewMiddleware()); },
};

export default defineConfig({
  plugins: [localFiles],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});