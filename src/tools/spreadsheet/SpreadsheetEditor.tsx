import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isDesktop } from "../../common/bridge";
import ReferenceEditor from "../../common/ReferenceEditor";
import type { Capability, LocalFile } from "../../common/types";
import { formats, lossWarning, type Format } from "./config";
import { SheetClient } from "./client";
import "./spreadsheet.css";
export type SheetContext = {
  id: string;
  capability: Capability;
  files: LocalFile[];
  format: string;
  automatic?: boolean;
};
function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function SpreadsheetEditor({
  context,
  onClose,
}: {
  context: SheetContext;
  onClose: () => void;
}) {
  const op = context.capability.operation || "convert";
  const [format, setFormat] = useState(context.format),
    [names, setNames] = useState<string[]>([]),
    [chosen, setChosen] = useState<string[]>([]),
    [preview, setPreview] = useState(""),
    [active, setActive] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [message, setMessage] = useState("Choose worksheets and an output format."),
    [confirmed, setConfirmed] = useState(false),
    [fileName, setFileName] = useState("");
  const worker = useRef<SheetClient | null>(null),
    input = useRef<HTMLInputElement>(null),
    source = useRef(context.files[0]),
    saving = useRef(false),
    alive = useRef(true);
  async function saveBytes(
    bytes: Uint8Array,
    outputFormat: string,
    name: string,
  ) {
    if (isDesktop && source.current) {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      await invoke("save_spreadsheet_output", {
        path: source.current.path,
        format: outputFormat,
        data: btoa(binary),
        suffix: name,
      });
    } else
      download(
        bytes,
        `${fileName.replace(/\.[^.]+$/, "") || "workbook"}-${name}.${outputFormat}`,
      );
  }
  async function process(
    client: SheetClient,
    selected: string[],
    target: string,
    strip = false,
  ) {
    const bytes = await client.request<Uint8Array>("export", {
      names: selected,
      format: target,
      strip,
    });
    await saveBytes(
      bytes,
      target,
      strip
        ? "metadata-removed"
        : selected.length === 1
          ? selected[0]
          : "converted",
    );
  }
  async function loadBytes(bytes: Uint8Array, name: string) {
    worker.current?.close();
    const client = new SheetClient();
    worker.current = client;
    setBusy(true);
    setError(false);
    setConfirmed(false);
    setChosen([]);
    setNames([]);
    setActive("");
    setPreview("");
    setFileName(name);
    setMessage("Reading workbook locally…");
    try {
      const ext = name.split(".").pop()!.toLowerCase(),
        sheets = await client.request<string[]>("load", { bytes, ext });
      if (!alive.current || worker.current !== client) return;
      setNames(sheets);
      setActive(sheets[0]);
      if (context.automatic && op === "convert") {
        for (const [index, sheet] of sheets.entries()) {
          setMessage(`Converting worksheet ${index + 1} of ${sheets.length}…`);
          await process(client, [sheet], context.format);
        }
        onClose();
        return;
      }
      setMessage("Choose worksheets and an output format.");
      if (context.automatic && isDesktop) await getCurrentWindow().show();
    } catch (e) {
      if (alive.current && worker.current === client) {
        setError(true);
        setMessage(String(e));
        if (context.automatic && isDesktop) await getCurrentWindow().show();
      }
    } finally {
      if (alive.current && worker.current === client) setBusy(false);
    }
  }
  async function nativeLoad(files: LocalFile[]) {
    if (!files.length) return;
    if (files.length !== 1) throw Error("Choose one workbook at a time.");
    if (saving.current) throw Error("Wait for the current output to finish.");
    setBusy(true);
    try {
      source.current = files[0];
      const data = await invoke<string>("read_spreadsheet", {
        path: files[0].path,
      });
      await loadBytes(
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
        files[0].name,
      );
    } catch (error) {
      setBusy(false);
      setNames([]);
      if (context.automatic && isDesktop) await getCurrentWindow().show();
      throw error;
    }
  }

  async function choose() {
    try {
      if (isDesktop) await nativeLoad(await api.addFiles());
      else input.current?.click();
    } catch (e) {
      setError(true);
      setMessage(String(e));
    }
  }
  useEffect(() => {
    alive.current = true;
    if (isDesktop && context.files.length)
      void nativeLoad(context.files).catch((e) => {
        setError(true);
        setMessage(String(e));
      });
    const stop = api.onNativeDrop?.((files) => {
      void nativeLoad(files).catch((e) => {
        setError(true);
        setMessage(String(e));
      });
    });
    return () => {
      alive.current = false;
      stop?.();
      worker.current?.close();
    };
  }, [context.id]);
  useEffect(() => {
    if (!active || !worker.current) return;
    let valid = true;
    setPreview("");
    void worker.current
      .request<string>("html", { name: active, limit: 2000 })
      .then((html) => {
        if (valid) setPreview(html);
      })
      .catch((e) => {
        if (valid) {
          setError(true);
          setMessage(String(e));
        }
      });
    return () => {
      valid = false;
    };
  }, [active, names]);
  async function save() {
    if (!worker.current || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    try {
      if (op === "strip-metadata" && !confirmed)
        throw Error("Acknowledge the rewrite loss warning before saving.");
      else if (op === "split") {
        if (!chosen.length) throw Error("Choose at least one worksheet.");
        for (let i = 0; i < chosen.length; i++) {
          setMessage(`Saving worksheet ${i + 1} of ${chosen.length}…`);
          await process(worker.current, [chosen[i]], format);
        }
        setMessage(
          isDesktop
            ? "Worksheet outputs queued locally. Source preserved."
            : "Worksheet outputs downloaded. Source preserved.",
        );
      } else {
        if (!chosen.length) throw Error("Choose at least one worksheet.");
        await process(worker.current, chosen, format, op === "strip-metadata");
        setMessage(
          isDesktop
            ? "Output queued locally. Source preserved."
            : "Output downloaded. Source preserved.",
        );
      }
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const title =
    op === "split"
      ? "Split worksheets"
      : op === "strip-metadata"
        ? "Delete workbook metadata"
        : "Convert spreadsheet";
  return (
    <div className="spreadsheet-editor">
      <ReferenceEditor
        title={title}
        subtitle={`${fileName || "Spreadsheet"} · SheetJS CE · Local processing`}
        preview={
          <div
            className="sheet-preview"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file)
                void file
                  .arrayBuffer()
                  .then((bytes) => loadBytes(new Uint8Array(bytes), file.name));
            }}
          >
            <button type="button" disabled={busy} onClick={() => void choose()}>
              Choose workbook
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept=".xlsx,.xls,.ods,.csv,.tsv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void file
                    .arrayBuffer()
                    .then((bytes) =>
                      loadBytes(new Uint8Array(bytes), file.name),
                    );
                e.target.value = "";
              }}
            />
            {names.length > 0 && (
              <label>
                Preview worksheet
                <select
                  value={active}
                  onChange={(e) => setActive(e.target.value)}
                >
                  {names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            <div
              className="sheet-table"
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
        }
        settings={
          <>
            <label>
              Output format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value);
                  setChosen([]);
                }}
              >
                {[...formats, ...(op === "convert" ? ["pdf"] : [])].map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                    {f === "pdf" ? " · layout-limited" : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
                <legend>Select worksheets</legend>
                {names.map((n) => (
                  <label key={n}>
                    <input
                      type="checkbox"
                      name="sheet-choice"
                      checked={chosen.includes(n)}
                      onChange={(e) =>
                        setChosen((v) =>
                          e.target.checked ? [...v, n] : v.filter((x) => x !== n),
                        )
                      }
                    />
                    {n}
                  </label>
                ))}
            </fieldset>
            {op === "strip-metadata" && <p>{lossWarning}</p>}
            {op === "strip-metadata" && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I understand the loss warning. Remove supported workbook
                properties and custom properties before rewriting.
              </label>
            )}
          </>
        }
        notice={message}
        error={error}
        output={fileName || "No workbook selected"}
        busy={busy}
        disabled={!names.length || !chosen.length}
        onClose={onClose}
        onReset={() => {
          setChosen([]);
          setConfirmed(false);
          setFormat(context.format);
          setMessage("Selections reset. Source unchanged.");
        }}
        onSubmit={save}
        actionLabel="Save new output"
      />
    </div>
  );
}
