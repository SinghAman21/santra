// @ts-nocheck
import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
async function fixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++)
    pdf
      .addPage([200 + i * 10, 300])
      .drawText(`Secret page ${i + 1}`, { x: 20, y: 150, font, size: 12 });
  pdf.setTitle("Original");
  return Buffer.from(await pdf.save());
}
async function mount(page: any, operation: string) {
  await page.goto("/");
  await page.evaluate(async (op: string) => {
    const { default: React } =
      await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: Editor } = await import("/src/tools/pdf/PdfWorkspace.tsx");
    document.getElementById("root")!.remove();
    const root = document.createElement("div");
    document.body.append(root);
    createRoot(root).render(
      React.createElement(Editor, {
        files: [],
        capability: {
          id: `pdf:${op}`,
          operation: op,
          label: op,
          available: true,
          outputs: ["pdf"],
        },
        format: "pdf",
        initialOptions: {},
        onApply: () => {},
        onClose: () => {},
        loadPreview: async () => ({ url: "" }),
      }),
    );
  }, operation);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: await fixture(),
    });
  await expect(page.getByRole("status")).toContainText("Ready.");
}
async function output(page: any) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /Download output|Save Metadata/ })
    .click();
  return readFile((await (await event).path())!);
}
test("organize saves displayed order and rotation, undo restores pages", async ({
  page,
}) => {
  await mount(page, "pdf-organize");
  await page
    .getByRole("button", { name: "Select page 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Rotate selected" }).click();
  let doc = await PDFDocument.load(await output(page));
  expect(doc.getPage(0).getRotation().angle).toBe(90);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Select page 1", exact: true })
    .click();
  await page.getByLabel("Move selected page to position").fill("3");
  await page.getByRole("button", { name: "Move page", exact: true }).click();
  doc = await PDFDocument.load(await output(page));
  expect(doc.getPages().map((p) => p.getWidth())).toEqual([210, 220, 200]);
});
test("extract and metadata produce edited documents", async ({ page }) => {
  await mount(page, "pdf-extract");
  await page
    .getByRole("button", { name: "Select page 2", exact: true })
    .click();
  expect((await PDFDocument.load(await output(page))).getPageCount()).toBe(1);
  await mount(page, "metadata");
  await page.getByLabel("Title", { exact: true }).fill("Changed");
  expect((await PDFDocument.load(await output(page))).getTitle()).toBe(
    "Changed",
  );
});
test("split and export create ZIP outputs", async ({ page }) => {
  for (const op of ["pdf-split", "render"]) {
    await mount(page, op);
    if (op === "pdf-split")
      await page.getByLabel("Split mode").selectOption("individual");
    else {
      await page
        .getByRole("button", { name: "Select All", exact: true })
        .click();
      await page.getByLabel("Resolution").selectOption("72");
    }
    const bytes = await output(page);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  }
});
test("secure redaction requires confirmation and discards text", async ({
  page,
}) => {
  await mount(page, "redact");
  await page
    .getByRole("button", { name: "Select page 1", exact: true })
    .dblclick();
  await expect(page.locator(".pdf-redaction canvas")).toHaveAttribute(
    "width",
    "278",
  );
  const box = await page.locator(".pdf-redaction").boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y + 100);
  await page.mouse.up();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Download output" }).click();
  await expect(page.getByRole("alert")).toContainText("confirm");
  await page.getByRole("checkbox").check();
  const bytes = await output(page);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getTitle()).toBeUndefined();
  const text = await page.evaluate(async (data: number[]) => {
    const { load } = await import("/src/tools/pdf/engine.ts");
    const s = await load(new File([new Uint8Array(data)], "redacted.pdf"));
    let text = "";
    for (let i = 1; i <= s.preview.numPages; i++)
      text += (await (await s.preview.getPage(i)).getTextContent()).items
        .map((x: any) => x.str || "")
        .join("");
    await s.preview.destroy();
    return text;
  }, Array.from(bytes));
  expect(text).toBe("");
});
test("merge uses card order and insert preserves source dimensions", async ({
  page,
}) => {
  await mount(page, "pdf-merge");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "second.pdf",
      mimeType: "application/pdf",
      buffer: await fixture(),
    });
  await expect(page.locator(".pdf-grid article")).toHaveCount(2);
  await page
    .locator(".pdf-grid article")
    .nth(1)
    .dragTo(page.locator(".pdf-grid article").nth(0));
  expect((await PDFDocument.load(await output(page))).getPageCount()).toBe(6);
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .first()
    .click();
  expect((await PDFDocument.load(await output(page))).getPageCount()).toBe(3);
  await mount(page, "pdf-insert");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "insert.pdf",
      mimeType: "application/pdf",
      buffer: await fixture(),
    });
  await page
    .getByRole("button", { name: "Select page 2", exact: true })
    .click();
  await page.getByLabel("Insert position").selectOption("beginning");
  const doc = await PDFDocument.load(await output(page));
  expect(doc.getPages().map((p) => p.getWidth())).toEqual([210, 200, 210, 220]);
});
test("compression reports measured size and image export preserves page number", async ({
  page,
}) => {
  await mount(page, "compress");
  const bytes = await output(page);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  await expect(page.getByRole("status")).toContainText("No savings");
  await mount(page, "render");
  await page
    .getByRole("button", { name: "Select page 2", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download output" }).click();
  expect((await pending).suggestedFilename()).toBe("sample-page-2.png");
  await page.screenshot({ path: "/tmp/santra-pdf-tools.png" });
});
