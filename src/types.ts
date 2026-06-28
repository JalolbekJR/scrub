export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DetectionType = 'face' | 'email' | 'phone' | 'card' | 'name';

export interface Detection {
  type: DetectionType;
  bbox: BoundingBox;
  label?: string;
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
