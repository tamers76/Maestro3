import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { readFileSync } from 'fs';

// Extract text from PDF file
export async function extractTextFromPDF(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

// Extract text from PDF buffer
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

// Extract text from DOCX file
export async function extractTextFromDOCX(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Extract text from DOCX buffer
export async function extractTextFromDOCXBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Detect file type and extract text
export async function extractText(filePath: string): Promise<string> {
  const extension = filePath.toLowerCase().split('.').pop();
  
  switch (extension) {
    case 'pdf':
      return extractTextFromPDF(filePath);
    case 'docx':
    case 'doc':
      return extractTextFromDOCX(filePath);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

// Extract text from buffer with mime type
export async function extractTextFromBuffer(
  buffer: Buffer, 
  mimeType: string,
  fileName?: string
): Promise<string> {
  // Browsers may report an empty or generic MIME type (e.g. application/octet-stream)
  // for DOCX files, so fall back to the file extension when available.
  const extension = fileName ? fileName.toLowerCase().split('.').pop() : '';

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return extractTextFromPDFBuffer(buffer);
  }
  
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    extension === 'docx'
  ) {
    return extractTextFromDOCXBuffer(buffer);
  }
  
  throw new Error(`Unsupported file type: ${fileName || mimeType}`);
}
