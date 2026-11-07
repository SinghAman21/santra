import { Checkbox } from '../../common/ui/checkbox';
import { Slider as ShadcnSlider } from '../../common/ui/slider';
import { Button as UiNativeButton, Input as UiNativeInput, NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import { invoke } from "@tauri-apps/api/core";
import { api, isDesktop } from "../../common/bridge";
import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import ReferenceEditor from "../../common/ReferenceEditor";
import type { Capability, LocalFile } from "../../common/types";
import {
  load,
  canvas,
  imageBytes,
  assemble,
  ranges,
  bundle,
  download,
  metadataKeys,
  type Source,
  type Page,
  type Region,
} from "./engine";
import "./tools.css";
import "./pdf-workspace.css";
export interface PdfWorkspaceProps {
  files: LocalFile[];
  capability: Capability;
  format: string;
  initialOptions: Record<string, string>;
  onApply: (
    format: string,
    values: Record<string, string>,
  ) => void | Promise<void>;
  onClose: () => void;
  loadPreview: (file: LocalFile) => Promise<{ url: string }>;
}
function Thumbnail({
  source,
  index,
  large = false,
}: {
  source: Source;
  index: number;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const target = ref.current;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void canvas(source, index, large ? 100 : 36)
        .then((c) => {
          if (active && target) {
            target.width = c.width;
            target.height = c.height;
            target.getContext("2d")!.drawImage(c, 0, 0);
          }
          c.width = 0;
          c.height = 0;
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    });
    if (target) observer.observe(target);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [source, index, large]);
  return (
    <>
      <canvas ref={ref} aria-label={`Page ${index + 1} preview`} />
      {error && <small role="alert">{error}</small>}
    </>
  );
}
const names: Record<string, string> = {
  "pdf-organize": "Organize",
  "pdf-merge": "Merge",
  "pdf-split": "Split",
  "pdf-extract": "Extract",
  "pdf-insert": "Insert",
  compress: "Compress",
  redact: "Redact",
  metadata: "Metadata",
  render: "Export Pages",
  "pdf-rotate": "Organize",
};
export default function PdfWorkspace({
  capability,
  onClose,
  files,
}: PdfWorkspaceProps) {
  const op = capability.operation || capability.id.split(":").pop()!,
    title = names[op] || capability.label;
  const [sources, setSources] = useState<Source[]>([]),
    [pages, setPages] = useState<Page[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [history, setHistory] = useState<Page[][]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      "Choose a PDF. Processing stays on this device.",
    ),
    [error, setError] = useState(false),
    [expanded, setExpanded] = useState<number | null>(null),
    [regions, setRegions] = useState<Region[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [quality, setQuality] = useState(65),
    [dpi, setDpi] = useState(150),
    [format, setFormat] = useState("png"),
    [split, setSplit] = useState("ranges"),
    [range, setRange] = useState("1"),
    [interval, setInterval] = useState(2),
    [position, setPosition] = useState("end"),
    [meta, setMeta] = useState<Record<string, string>>({});
  const all = useRef<Source[]>([]),
    input = useRef<HTMLInputElement>(null),
    drag = useRef(0),
    start = useRef<{ x: number; y: number } | null>(null),
    lock = useRef(false);
  const alive = useRef(true);
  const primary = sources[0];
  const nativeSource = useRef<LocalFile | undefined>(files[0]);
  async function nativeUpload(paths = files) {
    const incoming: File[] = [];
    for (const f of paths) {
      const data = await invoke<string>("read_pdf", { path: f.path });
      incoming.push(
        new File(
          [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
          f.name,
          { type: "application/pdf" },
        ),
      );
    }
    if (!nativeSource.current || !["pdf-merge", "pdf-insert"].includes(op))
      nativeSource.current = paths[0];
    await upload(incoming);
  }
  useEffect(() => {
    if (!isDesktop) return;
    return api.onNativeDrop?.(
      (incoming) => {
        void nativeUpload(incoming).catch((e) => {
          setError(true);
          setMessage(String(e));
        });
      },
      (message) => {
        setError(true);
        setMessage(message);
      },
    );
  }, [sources]);
  async function choose() {
    if (!isDesktop) {
      input.current?.click();
      return;
    }
    try {
      await nativeUpload(await api.addFiles());
    } catch (e) {
      setError(true);
      setMessage(String(e));
    }
  }
  useEffect(() => {
    if (isDesktop && files.length)
      void nativeUpload().catch((e) => {
        setError(true);
        setMessage(String(e));
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const s of all.current) void s.preview.destroy();
      all.current = [];
    };
  }, []);
  async function upload(incoming: File[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      const loaded: Source[] = [];
      for (const f of op === "pdf-merge" ? incoming : incoming.slice(0, 1)) {
        if (!alive.current) return;
        const s = await load(f);
        if (!alive.current) {
          await s.preview.destroy();
          return;
        }
        all.current.push(s);
        loaded.push(s);
      }
      if (!loaded.length) return;
      const next =
        op === "pdf-merge"
          ? [...sources, ...loaded]
          : op === "pdf-insert" && sources.length
            ? [sources[0], loaded[0]]
            : loaded.slice(0, 1);
      setSources(next);
      setPages(
        Array.from({ length: next[0].pdf.getPageCount() }, (_, index) => ({
          source: next[0].id,
          index,
          rotation: 0,
        })),
      );
      setSelected([]);
      setHistory([]);
      setRegions([]);
      setConfirmed(false);
      setMeta(
        Object.fromEntries(
          metadataKeys.map((key) => [
            key,
            String(next[0].pdf[`get${key}`]() || ""),
          ]),
        ),
      );
      setMessage("Ready. Select pages or adjust output settings.");
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function change(next: Page[]) {
    setHistory((h) => [...h, pages]);
    setPages(next);
    setSelected([]);
  }
  function reset() {
    if (op === "pdf-merge") setSources([...all.current]);
    if (primary) {
      setPages(
        Array.from({ length: primary.pdf.getPageCount() }, (_, index) => ({
          source: primary.id,
          index,
          rotation: 0,
        })),
      );
      setMeta(
        Object.fromEntries(
          metadataKeys.map((key) => [
            key,
            String(primary.pdf[`get${key}`]() || ""),
          ]),
        ),
      );
    }
    setSelected([]);
    setRegions([]);
    setConfirmed(false);
    setHistory([]);
    setMessage("Reset to original.");
  }
  const chosen = pages.filter((_, i) => selected.includes(i));
  let groups: number[][] = [];
  let groupError = "";
  if (primary && op === "pdf-split")
    try {
      groups =
        split === "individual"
          ? pages.map((_, i) => [i])
          : split === "interval"
            ? Array.from(
                { length: Math.ceil(pages.length / Math.max(1, interval)) },
                (_, g) =>
                  pages
                    .slice(g * interval, (g + 1) * interval)
                    .map((p) => p.index),
              )
            : range.split(";").map((r) => ranges(r, pages.length));
    } catch (e) {
      groupError = String(e);
    }
  async function save() {
    if (!primary || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      const outputs: Record<string, Uint8Array> = {};
      const base = primary.name
        .replace(/\.pdf$/i, "")
        .replace(/[^\p{L}\p{N}._-]/gu, "_");
      if (op === "render") {
        if (!chosen.length) throw Error("Select pages to export.");
        for (const p of chosen) {
          setMessage(`Rendering page ${p.index + 1}…`);
          const c = await canvas(primary, p.index, dpi);
          outputs[`${base}-page-${p.index + 1}.${format}`] = await imageBytes(
            c,
            `image/${format}`,
          );
          c.width = 0;
        }
      } else if (op === "pdf-split") {
        if (groupError) throw Error(groupError);
        for (let i = 0; i < groups.length; i++)
          outputs[`${base}-part-${i + 1}.pdf`] = await assemble(
            sources,
            groups[i].map((index) => pages[index]),
          );
      } else if (op === "metadata") {
        const doc = await PDFDocument.load(primary.bytes, {
          updateMetadata: false,
        });
        doc.setTitle(meta.Title);
        doc.setAuthor(meta.Author);
        doc.setSubject(meta.Subject);
        doc.setKeywords(meta.Keywords.split(",").map((v) => v.trim()));
        doc.setCreator(meta.Creator);
        doc.setProducer(meta.Producer);
        outputs[`${base}-metadata.pdf`] = await doc.save();
      } else if (op === "compress" || op === "redact") {
        if (op === "redact" && (!confirmed || !regions.length))
          throw Error(
            "Draw redactions and confirm permanent rasterization first.",
          );
        const doc = await PDFDocument.create();
        for (let i = 0; i < pages.length; i++) {
          setMessage(`Processing page ${i + 1} of ${pages.length}…`);
          const c = await canvas(
            primary,
            i,
            op === "redact"
              ? 150
              : quality < 40
                ? 72
                : quality < 75
                  ? 110
                  : 150,
          );
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#000";
          for (const r of regions.filter((r) => r.page === i))
            ctx.fillRect(
              Math.floor(r.x * c.width),
              Math.floor(r.y * c.height),
              Math.ceil(r.w * c.width) + 1,
              Math.ceil(r.h * c.height) + 1,
            );
          const image =
            op === "redact"
              ? await doc.embedPng(await imageBytes(c, "image/png"))
              : await doc.embedJpg(
                  await imageBytes(c, "image/jpeg", quality / 100),
                );
          const view = (await primary.preview.getPage(i + 1)).getViewport({
            scale: 1,
          });
          doc.addPage([view.width, view.height]).drawImage(image, {
            x: 0,
            y: 0,
            width: view.width,
            height: view.height,
          });
          c.width = 0;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        outputs[`${base}-${op}.pdf`] = await doc.save();
      } else {
        let order = op === "pdf-extract" ? chosen : pages;
        if (op === "pdf-merge")
          order = sources.flatMap((s) =>
            s.pdf
              .getPageIndices()
              .map((index) => ({ source: s.id, index, rotation: 0 })),
          );
        if (op === "pdf-insert") {
          const donor = sources[1];
          if (!donor) throw Error("Add an insertion PDF.");
          if (!selected.length) throw Error("Select source pages to insert.");
          const additions = donor.pdf
            .getPageIndices()
            .filter((i) => selected.includes(i))
            .map((index) => ({ source: donor.id, index, rotation: 0 }));
          const at =
            position === "beginning"
              ? 0
              : position === "end"
                ? pages.length
                : Math.max(0, Number(range) - 1) +
                  (position === "after" ? 1 : 0);
          if (at > pages.length)
            throw Error("Insertion page is outside the document.");
          order = [...pages.slice(0, at), ...additions, ...pages.slice(at)];
        }
        outputs[`${base}-${title.toLowerCase()}.pdf`] = await assemble(
          sources,
          order,
        );
      }
      const entries = Object.entries(outputs);
      const bytes =
        entries.length === 1 ? entries[0][1] : await bundle(outputs);
      if (isDesktop && nativeSource.current) {
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        await invoke("save_pdf_output", {
          path: nativeSource.current.path,
          format: entries.length === 1 ? entries[0][0].split(".").pop() : "zip",
          data: btoa(binary),
        });
      } else
        download(
          bytes,
          entries.length === 1
            ? entries[0][0]
            : `${base}-${title.toLowerCase()}.zip`,
        );
      setMessage(
        op === "compress"
          ? `Original ${(primary.bytes.length / 1024).toFixed(1)} KB → ${(bytes.length / 1024).toFixed(1)} KB. ${bytes.length < primary.bytes.length ? `${((1 - bytes.length / primary.bytes.length) * 100).toFixed(1)}% smaller.` : "No savings; output is larger."}`
          : isDesktop
            ? "Output queued locally. Your original is preserved."
            : "Output downloaded. Your original is preserved.",
      );
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const display =
    op === "pdf-insert" && sources[1]
      ? sources[1].pdf
          .getPageIndices()
          .map((index) => ({ source: sources[1].id, index, rotation: 0 }))
      : pages;
  return (
    <ReferenceEditor
      title={title}
      subtitle={`${primary?.name || "PDF tools"} · Local processing`}
      onClose={onClose}
      onReset={reset}
      onSubmit={save}
      actionLabel={op === "metadata" ? "Save Metadata" : "Download output"}
      busy={busy}
      disabled={!primary || !capability.available}
      notice={message}
      error={error}
      output={
        primary
          ? `${pages.length} pages · ${(primary.bytes.length / 1024).toFixed(1)} KB`
          : "No PDF selected"
      }
      preview={
        <div
          className="pdf-tools"
          inert={busy}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length)
              void upload(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="pdf-toolbar">
            <span>{display.length} pages</span>
            <UiNativeButton type="button" disabled={busy} onClick={() => void choose()}>
              Upload PDF
            </UiNativeButton>
          </div>
          <UiNativeInput
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple={op === "pdf-merge"}
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {!primary && (
            <UiNativeButton
              type="button"
              className="pdf-upload"
              onClick={() => void choose()}
            >
              Drop a PDF here or choose a file
              {files.length > 0 && (
                <small>Choose {files[0].name} to load its pages</small>
              )}
            </UiNativeButton>
          )}
          {op === "pdf-merge" ? (
            <div className="pdf-grid">
              {sources.map((s, i) => (
                <article
                  key={s.id}
                  draggable={!busy}
                  onDragStart={() => {
                    drag.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    if (e.dataTransfer.files.length) {
                      void upload(Array.from(e.dataTransfer.files));
                      return;
                    }
                    const next = [...sources];
                    next.splice(i, 0, next.splice(drag.current, 1)[0]);
                    setSources(next);
                  }}
                >
                  <Thumbnail source={s} index={0} />
                  <span>
                    {i + 1}. {s.name}
                  </span>
                  <UiNativeButton
                    type="button"
                    onClick={() =>
                      setSources((v) => v.filter((x) => x.id !== s.id))
                    }
                  >
                    Remove
                  </UiNativeButton>
                </article>
              ))}
              <UiNativeButton
                type="button"
                className="pdf-upload"
                onClick={() => void choose()}
              >
                + Add PDFs
              </UiNativeButton>
            </div>
          ) : (
            <div className="pdf-grid">
              {display.map((p, i) => (
                <article
                  key={`${p.source}-${p.index}`}
                  className={selected.includes(i) ? "selected" : ""}
                  draggable={
                    !busy && ["pdf-organize", "pdf-rotate"].includes(op)
                  }
                  onDragStart={() => {
                    drag.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    if (e.dataTransfer.files.length) {
                      void upload(Array.from(e.dataTransfer.files));
                      return;
                    }
                    const next = [...pages];
                    next.splice(i, 0, next.splice(drag.current, 1)[0]);
                    change(next);
                  }}
                >
                  <UiNativeButton
                    variant="unstyled"
                    type="button"
                    aria-pressed={selected.includes(i)}
                    aria-label={`Select page ${p.index + 1}`}
                    onClick={() =>
                      setSelected((v) =>
                        v.includes(i) ? v.filter((x) => x !== i) : [...v, i],
                      )
                    }
                    onDoubleClick={() => setExpanded(i)}
                  >
                    <span className="pdf-number">{p.index + 1}</span>
                    <div style={{ transform: `rotate(${p.rotation}deg)` }}>
                      <Thumbnail
                        source={sources.find((s) => s.id === p.source)!}
                        index={p.index}
                      />
                    </div>
                  </UiNativeButton>
                  <UiNativeButton
                    type="button"
                    className="pdf-preview-button"
                    onClick={() => setExpanded(i)}
                    aria-label={`Preview page ${p.index + 1}`}
                  >
                    Preview
                  </UiNativeButton>
                </article>
              ))}
            </div>
          )}
          {expanded !== null && display[expanded] && (
            <div className="pdf-expanded">
              <UiNativeButton type="button" onClick={() => setExpanded(null)}>
                Close preview
              </UiNativeButton>
              <div
                className="pdf-redaction"
                onPointerDown={(e) => {
                  if (op !== "redact") return;
                  const b = e.currentTarget.getBoundingClientRect();
                  start.current = {
                    x: (e.clientX - b.left) / b.width,
                    y: (e.clientY - b.top) / b.height,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  if (!start.current) return;
                  const b = e.currentTarget.getBoundingClientRect(),
                    x = Math.max(
                      0,
                      Math.min(1, (e.clientX - b.left) / b.width),
                    ),
                    y = Math.max(
                      0,
                      Math.min(1, (e.clientY - b.top) / b.height),
                    ),
                    a = start.current;
                  start.current = null;
                  if (Math.abs(a.x - x) > 0.002 && Math.abs(a.y - y) > 0.002) {
                    setRegions((v) => [
                      ...v,
                      {
                        page: expanded,
                        x: Math.min(a.x, x),
                        y: Math.min(a.y, y),
                        w: Math.abs(a.x - x),
                        h: Math.abs(a.y - y),
                      },
                    ]);
                    setConfirmed(false);
                  }
                }}
              >
                <Thumbnail
                  source={primary}
                  index={display[expanded].index}
                  large
                />
                {regions
                  .filter((r) => r.page === expanded)
                  .map((r, i) => (
                    <span
                      key={i}
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`,
                        height: `${r.h * 100}%`,
                      }}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      }
      settings={
        <>
          <UiNativeButton
            type="button"
            onClick={() => setSelected(display.map((_, i) => i))}
          >
            Select All
          </UiNativeButton>{" "}
          <UiNativeButton type="button" onClick={() => setSelected([])}>
            Clear Selection
          </UiNativeButton>
          {["pdf-organize", "pdf-rotate"].includes(op) && (
            <>
              <UiNativeButton
                type="button"
                onClick={() =>
                  change(pages.filter((_, i) => !selected.includes(i)))
                }
              >
                Delete selected
              </UiNativeButton>
              <UiNativeButton
                type="button"
                onClick={() =>
                  change(
                    pages.map((p, i) =>
                      selected.includes(i)
                        ? { ...p, rotation: (p.rotation + 90) % 360 }
                        : p,
                    ),
                  )
                }
              >
                Rotate selected
              </UiNativeButton>
              <UiNativeButton
                type="button"
                disabled={!history.length}
                onClick={() => {
                  setPages(history[history.length - 1]);
                  setHistory((h) => h.slice(0, -1));
                  setSelected([]);
                }}
              >
                Undo
              </UiNativeButton>
              <label>
                Move selected page to position
                <UiNativeInput
                  type="number"
                  min="1"
                  max={pages.length}
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                />
              </label>
              <UiNativeButton
                type="button"
                disabled={selected.length !== 1}
                onClick={() => {
                  const next = [...pages];
                  next.splice(
                    Math.max(0, Math.min(pages.length - 1, Number(range) - 1)),
                    0,
                    next.splice(selected[0], 1)[0],
                  );
                  change(next);
                }}
              >
                Move page
              </UiNativeButton>
            </>
          )}
          {op === "pdf-split" && (
            <>
              <label>
                Split mode
                <UiNativeSelect
                  value={split}
                  onChange={(e) => setSplit(e.target.value)}
                >
                  <option value="ranges">Page ranges</option>
                  <option value="individual">Individual pages</option>
                  <option value="interval">Equal intervals</option>
                </UiNativeSelect>
              </label>
              {split === "ranges" && (
                <label>
                  Groups (semicolon separated)
                  <UiNativeInput
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    placeholder="1-3;4-6"
                  />
                </label>
              )}
              {split === "interval" && (
                <label>
                  Pages per document
                  <UiNativeInput
                    type="number"
                    min="1"
                    value={interval}
                    onChange={(e) =>
                      setInterval(Math.max(1, Number(e.target.value)))
                    }
                  />
                </label>
              )}
              <p>
                {groupError ||
                  groups
                    .map(
                      (g, i) =>
                        `Part ${i + 1}: ${g.map((p) => p + 1).join(", ")}`,
                    )
                    .join(" · ")}
              </p>
            </>
          )}
          {op === "pdf-insert" && (
            <>
              <p>
                Upload the primary PDF, then the insertion PDF. Select insertion
                pages in the grid.
              </p>
              <label>
                Insert position
                <UiNativeSelect
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                >
                  {["beginning", "end", "before", "after"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </UiNativeSelect>
              </label>
              {["before", "after"].includes(position) && (
                <label>
                  Primary page
                  <UiNativeInput
                    type="number"
                    min="1"
                    max={pages.length}
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                  />
                </label>
              )}
              {primary && (
                <section aria-label="Primary document pages">
                  <p>Primary document · choose insertion page</p>
                  <div className="pdf-grid pdf-primary-pages">
                    {primary.pdf.getPageIndices().map((index) => (
                      <UiNativeButton
                        key={index}
                        type="button"
                        aria-label={`Insert relative to page ${index + 1}`}
                        aria-pressed={Number(range) === index + 1}
                        onClick={() => setRange(String(index + 1))}
                      >
                        <Thumbnail source={primary} index={index} />
                        <span>{index + 1}</span>
                      </UiNativeButton>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {op === "compress" && (
            <>
              <label>
                Compression
                <UiNativeSelect
                  value={
                    quality < 40 ? "high" : quality < 75 ? "medium" : "low"
                  }
                  onChange={(e) =>
                    setQuality(
                      e.target.value === "high"
                        ? 30
                        : e.target.value === "medium"
                          ? 65
                          : 90,
                    )
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </UiNativeSelect>
              </label>
              <label>
                Image quality {quality}%
                <ShadcnSlider aria-label="Image quality" min={10} max={95} value={[quality]} onValueChange={([value]) => setQuality(value)} />
              </label>
              <p>
                Rebuilds pages as JPEG images. Selectable text and vector
                quality are lost. Output can be larger.
              </p>
            </>
          )}
          {op === "redact" && (
            <>
              <p>
                Double-click a page, then drag rectangles over sensitive areas.{" "}
                {regions.length} regions.
              </p>
              <p>
                Secure redaction rebuilds every page as pixels. Text, vectors,
                annotations, attachments and document metadata are discarded.
              </p>
              <UiNativeButton
                type="button"
                onClick={() => {
                  setRegions((r) => r.slice(0, -1));
                  setConfirmed(false);
                }}
              >
                Undo region
              </UiNativeButton>
              <label>
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                I confirm permanent rasterization and removal of marked content.
              </label>
            </>
          )}
          {op === "metadata" && (
            <>
              {metadataKeys.map((key) => (
                <label key={key}>
                  {key}
                  <UiNativeInput
                    value={meta[key] || ""}
                    onChange={(e) =>
                      setMeta((v) => ({ ...v, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <p>
                Created:{" "}
                {primary?.pdf.getCreationDate()?.toLocaleString() ||
                  "Unavailable"}
                <br />
                Modified:{" "}
                {primary?.pdf.getModificationDate()?.toLocaleString() ||
                  "Unavailable"}
              </p>
            </>
          )}
          {op === "render" && (
            <>
              <label>
                Image format
                <UiNativeSelect
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  {document
                    .createElement("canvas")
                    .toDataURL("image/webp")
                    .startsWith("data:image/webp") && (
                    <option value="webp">WebP</option>
                  )}
                </UiNativeSelect>
              </label>
              <label>
                Resolution
                <UiNativeSelect
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value))}
                >
                  {[72, 150, 300].map((n) => (
                    <option key={n} value={n}>
                      {n} DPI
                    </option>
                  ))}
                </UiNativeSelect>
              </label>
            </>
          )}
        </>
      }
    />
  );
}
