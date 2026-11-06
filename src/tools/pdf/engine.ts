import { PDFDocument, degrees } from "pdf-lib";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { zip } from "fflate";
GlobalWorkerOptions.workerSrc = worker;
export type Source = {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocument;
  preview: PDFDocumentProxy;
};
export type Page = { source: string; index: number; rotation: number };
export type Region = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export const metadataKeys = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
] as const;
export async function load(file: File): Promise<Source> {
  if (file.size > 100 * 1024 * 1024)
    throw Error("PDF exceeds the 100 MB safety limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw Error("Select a valid PDF document.");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getPageCount() > 2000)
    throw Error("PDF exceeds the 2,000 page safety limit.");
  const preview = await getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  }).promise;
  return { id: crypto.randomUUID(), name: file.name, bytes, pdf, preview };
}
export async function canvas(source: Source, index: number, dpi: number) {
  const page = await source.preview.getPage(index + 1),
    viewport = page.getViewport({ scale: dpi / 72 });
  if (viewport.width * viewport.height > 32_000_000)
    throw Error(
      "Page exceeds the 32 megapixel limit. Choose a lower resolution.",
    );
  const result = document.createElement("canvas");
  result.width = Math.ceil(viewport.width);
  result.height = Math.ceil(viewport.height);
  await page.render({
    canvas: result,
    canvasContext: result.getContext("2d")!,
    viewport,
    background: "white",
  }).promise;
  return result;
}
export function imageBytes(
  c: HTMLCanvasElement,
  type: string,
  quality = 0.85,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      async (blob) => {
        if (!blob || blob.type !== type) {
          reject(Error("This image format is unsupported."));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      type,
      quality,
    ),
  );
}
export async function assemble(sources: Source[], pages: Page[]) {
  if (!pages.length) throw Error("Select at least one page.");
  const output = await PDFDocument.create();
  for (const entry of pages) {
    const source = sources.find((s) => s.id === entry.source)!;
    const [page] = await output.copyPages(source.pdf, [entry.index]);
    page.setRotation(degrees(page.getRotation().angle + entry.rotation));
    output.addPage(page);
  }
  return output.save();
}
export function ranges(value: string, count: number): number[] {
  const pages: number[] = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw Error("Use ranges such as 1-3,5.");
    const a = Number(match[1]),
      b = Number(match[2] || a);
    if (a < 1 || b < a || b > count)
      throw Error(`Page ranges must be between 1 and ${count}.`);
    for (let i = a; i <= b; i++) pages.push(i - 1);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}
export async function bundle(files: Record<string, Uint8Array>) {
  return new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 0 }, (error, data) =>
      error ? reject(error) : resolve(data),
    ),
  );
}
export function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
