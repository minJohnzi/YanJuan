import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/lucide-react/') ||
            id.includes('\\node_modules\\lucide-react\\') ||
            id.includes('/node_modules/motion/') ||
            id.includes('\\node_modules\\motion\\')
          ) {
            return 'vendor-ui';
          }
          if (
            id.includes('/src/domain/') ||
            id.includes('\\src\\domain\\') ||
            id.includes('/src/pipeline/') ||
            id.includes('\\src\\pipeline\\') ||
            id.includes('/src/shared/') ||
            id.includes('\\src\\shared\\')
          ) {
            return 'domain-core';
          }
        },
      },
    },
  },
});
