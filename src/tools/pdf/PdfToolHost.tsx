import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Capability, LocalFile } from "../../common/types";
import PdfWorkspace from "./PdfWorkspace";
type Context = { id: string; capability: Capability; files: LocalFile[]; format: string };
export default function PdfToolHost() {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<Context>("santra:pdf-context", event => { if (active) setContext(event.payload); });
        const current = await invoke<Context | null>("pdf_context");
        if (active && current) setContext(current);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => { active = false; unlisten?.(); };
  }, []);
  if (context) return <PdfWorkspace key={context.id} files={context.files} capability={context.capability} format={context.format} initialOptions={{}} onApply={() => {}} loadPreview={async () => ({ url: "" })} onClose={() => { setContext(null); void getCurrentWindow().hide(); }} />;
  return <main className="tool-host-state" role={error ? "alert" : "status"}>{error || "Opening PDF tools…"}</main>;
}
