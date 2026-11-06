import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formats, type Format } from "./config";
export { formats, lossWarning, type Format } from "./config";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function validateZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error("Invalid workbook archive.");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (count > 10000 || offset >= end)
    throw Error("Workbook archive exceeds safety limits.");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw Error("Invalid workbook archive directory.");
    total += view.getUint32(cursor + 24, true);
    if (total > 128 * 1024 * 1024)
      throw Error("Expanded workbook exceeds the 128 MB safety limit.");
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
}
export function read(bytes: Uint8Array, ext: string) {
  if (!formats.includes(ext as Format))
    throw Error("Unsupported spreadsheet format.");
  if (bytes.length > 32 * 1024 * 1024)
    throw Error("Spreadsheet exceeds the 32 MB limit.");
  if (["xlsx", "ods"].includes(ext) && !(bytes[0] === 80 && bytes[1] === 75))
    throw Error("Workbook signature does not match its format.");
  if (
    ext === "xls" &&
    !(
      (bytes[0] === 208 && bytes[1] === 207) ||
      bytes[0] === 9 ||
      new TextDecoder().decode(bytes.slice(0, 256)).includes("<?xml")
    )
  )
    throw Error("Unsupported XLS signature.");
  if (["xlsx", "ods"].includes(ext)) validateZip(bytes);
  const book = XLSX.read(bytes, {
    type: "array",
    cellStyles: true,
    bookVBA: false,
    FS: ext === "tsv" ? "\t" : undefined,
  });
  if (!book.SheetNames.length || book.SheetNames.length > 256)
    throw Error("Select a workbook with 1–256 worksheets.");
  for (const name of book.SheetNames) {
    const ref = book.Sheets[name]["!ref"];
    if (ref) {
      const r = XLSX.utils.decode_range(ref);
      if ((r.e.r + 1) * (r.e.c + 1) > 2_000_000)
        throw Error("Worksheet exceeds the two million cell safety limit.");
    }
  }
  return book;
}
function selected(book: XLSX.WorkBook, names: string[]) {
  if (
    !names.length ||
    names.some((n) => !book.SheetNames.includes(n)) ||
    new Set(names).size !== names.length
  )
    throw Error("Select valid worksheets.");
}
export async function rewrite(
  book: XLSX.WorkBook,
  format: Format | "pdf",
  names: string[],
  strip = false,
) {
  selected(book, names);
  if (format === "pdf") {
    if (names.length !== 1)
      throw Error("PDF export requires one worksheet at a time.");
    return pdf(book, names[0]);
  }
  if (!formats.includes(format as Format))
    throw Error("Unsupported output format.");
  if (["csv", "tsv"].includes(format) && names.length !== 1)
    throw Error(
      "CSV and TSV require exactly one explicitly selected worksheet.",
    );
  for (const name of names) {
    const reference = book.Sheets[name]["!ref"];
    if (!reference) continue;
    const range = XLSX.utils.decode_range(reference);
    if (format === "xls" && (range.e.r >= 65536 || range.e.c >= 256))
      throw Error(
        "XLS supports at most 65,536 rows and 256 columns. Choose XLSX or ODS to avoid truncation.",
      );
    if (format === "xlsx" && (range.e.r >= 1048576 || range.e.c >= 16384))
      throw Error("Worksheet exceeds XLSX row or column limits.");
  }
  // Build a fresh workbook: no workbook properties, custom properties, VBA blob or external-link parts are copied when stripping.
  const output = XLSX.utils.book_new();
  for (const name of names) {
    const sheet = structuredClone(book.Sheets[name]);
    if (strip) {
      for (const key of Object.keys(sheet)) {
        if (key[0] === "!") continue;
        const cell = sheet[key];
        if (cell && typeof cell === "object") {
          delete cell.c;
          delete cell.l;
        }
      }
    }
    XLSX.utils.book_append_sheet(output, sheet, name);
  }
  if (!strip) {
    output.Props = book.Props;
    output.Custprops = book.Custprops;
  }
  if (format === "csv" || format === "tsv")
    return new TextEncoder().encode(
      XLSX.utils.sheet_to_csv(output.Sheets[names[0]], {
        FS: format === "tsv" ? "\t" : ",",
        blankrows: true,
      }),
    );
  return new Uint8Array(
    XLSX.write(output, {
      type: "array",
      bookType: format === "xls" ? "biff8" : format,
      cellStyles: true,
      compression: true,
    }),
  );
}
export function html(book: XLSX.WorkBook, name: string, limit = 2000) {
  selected(book, [name]);
  const sheet = book.Sheets[name],
    range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
  if (cells > limit)
    throw Error(
      `Sheet exceeds the ${limit.toLocaleString()} cell HTML limit. Select a smaller sheet.`,
    );
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  return `<table><caption>${escape(name)}</caption><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function activeSheet(book: XLSX.WorkBook) {
  const view = book.Workbook?.Views?.[0] as { activeTab?: number } | undefined;
  const index = view?.activeTab;
  if (Number.isInteger(index) && index! >= 0 && index! < book.SheetNames.length)
    return book.SheetNames[index!];
  if (book.SheetNames.length === 1) return book.SheetNames[0];
  throw Error(
    "This workbook has no active worksheet. Select a sheet in a spreadsheet editor and save the workbook before Shift CSV/TSV conversion.",
  );
}

export async function pdf(book: XLSX.WorkBook, name: string) {
  selected(book, [name]);
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const count = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
  if (count > 100_000)
    throw Error("PDF export is limited to 100,000 cells per worksheet.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  const columns = Math.max(1, ...rows.map((row) => row.length));
  if (columns > 64)
    throw Error("PDF export supports up to 64 columns per worksheet.");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 792,
    pageHeight = 612,
    margin = 28,
    fontSize = 8,
    lineHeight = 10,
    available = pageWidth - margin * 2;
  const natural = Array.from({ length: columns }, (_, col) =>
    Math.min(
      170,
      Math.max(
        42,
        ...rows
          .slice(0, 20)
          .map((row) => Math.min(34, String(row[col] ?? "").length) * 4 + 12),
      ),
    ),
  );
  const scale = Math.min(1, available / natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((width) => width * scale);
  const encode = (value: unknown) => {
    const text = String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    try {
      font.encodeText(text);
      return text;
    } catch {
      throw Error(
        "PDF export supports text encodable by standard PDF fonts. Choose XLSX to preserve this worksheet text.",
      );
    }
  };
  let page = document.addPage([pageWidth, pageHeight]),
    y = pageHeight - margin;
  const heading = `${name} · layout-limited worksheet export`;
  page.drawText(encode(heading), {
    x: margin,
    y,
    size: 10,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 18;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const wrapped = row.map((value, col) => {
      const text = encode(value),
        maxChars = Math.max(
          1,
          Math.floor((widths[col] - 8) / (fontSize * 0.52)),
        ),
        parts: string[] = [];
      for (let i = 0; i < text.length; i += maxChars)
        parts.push(text.slice(i, i + maxChars));
      return parts.length ? parts : [""];
    });
    const lines = Math.max(1, ...wrapped.map((parts) => parts.length)),
      height = Math.max(16, lines * lineHeight + 6);
    if (y - height < margin) {
      page = document.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    let x = margin;
    for (let col = 0; col < columns; col++) {
      const w = widths[col];
      page.drawRectangle({
        x,
        y: y - height,
        width: w,
        height,
        color: rowIndex === 0 ? rgb(0.94, 0.95, 0.96) : rgb(1, 1, 1),
        borderColor: rgb(0.8, 0.81, 0.83),
        borderWidth: 0.35,
      });
      for (let line = 0; line < wrapped[col].length; line++)
        page.drawText(wrapped[col][line], {
          x: x + 4,
          y: y - 10 - line * lineHeight,
          size: fontSize,
          font: rowIndex === 0 ? bold : font,
          color: rgb(0.18, 0.18, 0.18),
        });
      x += w;
    }
    y -= height;
  }
  return document.save();
}
