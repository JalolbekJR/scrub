// Imported by the browser tests through Vite, so package imports and worker
// URLs use the same resolution as the application.
import { GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
export { getDocument } from 'pdfjs-dist';
export { jsPDF } from 'jspdf';
