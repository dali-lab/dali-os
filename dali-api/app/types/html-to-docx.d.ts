// Minimal ambient types for html-to-docx (the package ships no types). We use
// only the default export: HTMLtoDOCX(htmlString, headerHtml?, options?,
// footerHtml?) → Promise<Buffer | Blob | ArrayBuffer>.
declare module "html-to-docx" {
  interface DocxOptions {
    orientation?: "portrait" | "landscape";
    margins?: Partial<{ top: number; right: number; bottom: number; left: number }>;
    title?: string;
    font?: string;
    fontSize?: number;
    [key: string]: unknown;
  }

  export default function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocxOptions,
    footerHTMLString?: string | null,
  ): Promise<Buffer | ArrayBuffer | Blob>;
}
