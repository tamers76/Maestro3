declare module 'html-to-docx' {
  interface DocxOptions {
    table?: { row?: { cantSplit?: boolean } };
    footer?: boolean;
    pageNumber?: boolean;
    font?: string;
    fontSize?: number;
    margins?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
  }

  function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    options?: DocxOptions,
    footerHTMLString?: string | null
  ): Promise<Buffer>;

  export default HTMLtoDOCX;
}
