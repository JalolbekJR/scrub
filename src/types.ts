export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DetectionType = 'face' | 'email' | 'phone' | 'card' | 'name' | 'manual';

export interface Detection {
  type: DetectionType;
  bbox: BoundingBox;
  label?: string;
}

export interface ScanResult {
  file: File;
  faces: number;
  emails: number;
  phones: number;
  cards: number;
  names: number;
  meta: number;
  detections: Detection[];
}

export interface FileLoadedDetail {
  canvas: HTMLCanvasElement;
  cleanImageData: ImageData;
  isPdf: boolean;
  pdfDoc?: import('pdfjs-dist').PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  gen: number;
}
