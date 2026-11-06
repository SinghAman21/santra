/// <reference lib="webworker" />
import { read, rewrite, html, activeSheet, type Format } from "./engine";
import type { WorkBook } from "xlsx";
let book: WorkBook | undefined;
self.onmessage = async (event: MessageEvent) => {
  const { id, action, bytes, ext, names, format, strip, name, limit } =
    event.data;
  try {
    if (action === "load") {
      book = read(new Uint8Array(bytes), ext);
      self.postMessage({ id, result: book.SheetNames });
      return;
    }
    if (!book) throw Error("Load a workbook first.");
    if (action === "active-sheet") {
      self.postMessage({ id, result: activeSheet(book) });
      return;
    }
    if (action === "html") {
      self.postMessage({ id, result: html(book, name, limit ?? 100000) });
      return;
    }
    if (action === "export") {
      const result = await rewrite(book, format as Format | "pdf", names, strip);
      self.postMessage({ id, result }, [result.buffer]);
      return;
    }
    throw Error("Unknown spreadsheet operation.");
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
