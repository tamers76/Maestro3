/** Minimal ambient types for `pdf-parse` (no published @types package). */
declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }
  function pdfParse(dataBuffer: Buffer | Uint8Array, options?: unknown): Promise<PdfParseResult>;
  export = pdfParse;
}
