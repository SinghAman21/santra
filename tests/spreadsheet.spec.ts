// @ts-nocheck -- Vite browser module URLs are evaluated in the page.
import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
function fixture() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Count"],
      ["First", 1],
      ["<img src=x onerror=alert(1)>", 2],
    ]),
    "First",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Count"],
      ["Second", 99],
    ]),
    "Second",
  );
  book.Props = { Author: "Private author", Title: "Private title" };
  book.Custprops = { Secret: "private custom" };
  return Buffer.from(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}
async function mount(page, operation, format) {
  await page.goto("/");
  await page.evaluate(
    async ({ operation, format }) => {
      const { default: React } =
        await import("/node_modules/.vite/deps/react.js");
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { default: Editor } =
        await import("/src/tools/spreadsheet/SpreadsheetEditor.tsx");
      document.getElementById("root").remove();
      const root = document.createElement("div");
      document.body.append(root);
      createRoot(root).render(
        React.createElement(Editor, {
          context: {
            id: "test",
            capability: {
              id: `spreadsheet:${operation}`,
              operation,
              category: "spreadsheet",
              available: true,
            },
            files: [],
            format,
          },
          onClose: () => {},
        }),
      );
    },
    { operation, format },
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "source.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture(),
  });
  await expect(page.getByLabel("Preview worksheet")).toContainText("Second");
  await expect(
    page.getByRole("button", { name: "Save new output" }),
  ).toBeEnabled();
}
async function output(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save new output" }).click();
  return readFile(await (await pending).path());
}
test("all supported workbook outputs round trip through SheetJS", async ({
  page,
}) => {
  for (const format of ["xlsx", "xls", "ods"]) {
    await mount(page, "convert", format);
    const bytes = await output(page);
    const book = XLSX.read(bytes);
    expect(book.SheetNames).toEqual(["First", "Second"]);
    expect(book.Sheets.Second.B2.v).toBe(99);
  }
});
test("CSV and TSV require explicit sheet selection and export chosen sheet", async ({
  page,
}) => {
  for (const format of ["csv", "tsv"]) {
    await mount(page, "convert", format);
    await page.getByRole("button", { name: "Save new output" }).click();
    await expect(page.getByRole("alert")).toContainText("exactly one");
    await page.getByRole("radio", { name: "Second", exact: true }).check();
    const bytes = await output(page);
    const text = bytes.toString();
    expect(text).toContain(format === "tsv" ? "Second\t99" : "Second,99");
    expect(text).not.toContain("First,1");
  }
});
test("split emits one workbook per selected sheet", async ({ page }) => {
  await mount(page, "split", "xlsx");
  await page.getByRole("checkbox", { name: "First", exact: true }).check();
  await page.getByRole("checkbox", { name: "Second", exact: true }).check();
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.getByRole("button", { name: "Save new output" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const sheets = [];
  for (const d of downloads) {
    const book = XLSX.read(await readFile(await d.path()));
    expect(book.SheetNames).toHaveLength(1);
    sheets.push(book.SheetNames[0]);
  }
  expect(sheets).toEqual(["First", "Second"]);
});
test("metadata removal requires loss acknowledgement and strips controlled properties", async ({
  page,
}) => {
  await mount(page, "strip-metadata", "xlsx");
  await page.getByRole("button", { name: "Save new output" }).click();
  await expect(page.getByRole("alert")).toContainText("Acknowledge");
  await page.getByRole("checkbox").check();
  const book = XLSX.read(await output(page));
  expect(book.Props?.Author).not.toBe("Private author");
  expect(book.Props?.Title).not.toBe("Private title");
  expect(book.Custprops?.Secret).toBeUndefined();
  expect(XLSX.read(fixture()).Props.Author).toBe("Private author");
});
test("preview escapes HTML and PDF uses selected worksheet print document", async ({
  page,
}) => {
  await mount(page, "convert", "xlsx");
  await expect(page.locator(".sheet-table")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator(".sheet-table img")).toHaveCount(0);
  await page.getByLabel("Output format").selectOption("pdf");
  await page.getByRole("radio", { name: "Second", exact: true }).check();
  await page.getByRole("button", { name: "Print / Save as PDF" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Print dialog requested",
  );
  await expect
    .poll(() => page.locator("iframe").getAttribute("srcdoc"))
    .toContain("Second");
  await page.screenshot({ path: "/tmp/santra-spreadsheet.png" });
});
test("all advertised input formats are parsed locally and oversized archives fail safely", async ({
  page,
}) => {
  await mount(page, "convert", "xlsx");
  for (const ext of ["xls", "ods", "csv", "tsv"]) {
    const source = XLSX.read(fixture());
    const bytes =
      ext === "csv" || ext === "tsv"
        ? Buffer.from(
            XLSX.utils.sheet_to_csv(source.Sheets.Second, {
              FS: ext === "tsv" ? "\t" : ",",
            }),
          )
        : Buffer.from(
            XLSX.write(source, {
              type: "array",
              bookType: ext === "xls" ? "biff8" : ext,
            }),
          );
    await page.locator("input[type=file]").setInputFiles({
      name: `input.${ext}`,
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    await expect(page.getByRole("status")).toContainText(
      "Rewriting with SheetJS",
    );
    await expect(
      page.getByRole("button", { name: "Save new output" }),
    ).toBeEnabled();
    const doc = XLSX.read(await output(page));
    expect(doc.SheetNames.length).toBeGreaterThan(0);
  }
  const bomb = fixture();
  for (let i = 0; i < bomb.length - 46; i++)
    if (bomb.readUInt32LE(i) === 0x02014b50) {
      bomb.writeUInt32LE(200 * 1024 * 1024, i + 24);
      break;
    }
  await page.locator("input[type=file]").setInputFiles({
    name: "oversized.xlsx",
    mimeType: "application/octet-stream",
    buffer: bomb,
  });
  await expect(page.getByRole("alert")).toContainText("128 MB");
});
test("legacy XLS conversion rejects row ranges that would truncate data", async ({
  page,
}) => {
  await mount(page, "convert", "xls");
  const book = XLSX.read(fixture());
  book.Sheets.First.A65537 = { t: "s", v: "Keep this last row" };
  book.Sheets.First["!ref"] = "A1:B65537";
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "long.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        XLSX.write(book, { type: "array", bookType: "xlsx" }),
      ),
    });
  await expect(
    page.getByRole("button", { name: "Save new output" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save new output" }).click();
  await expect(page.getByRole("alert")).toContainText("65,536 rows");
});
