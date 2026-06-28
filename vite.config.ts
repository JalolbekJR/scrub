import { defineConfig } from 'vite';

export default defineConfig({
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Keep ML-heavy chunks separate so the main bundle stays small.
        manualChunks(id) {
          if (id.includes('tesseract')) return 'tesseract';
          if (id.includes('pdfjs-dist')) return 'pdf';
          if (id.includes('jspdf')) return 'jspdf';
          if (id.includes('@mediapipe')) return 'mediapipe';
        },
      },
    },
  },
});
