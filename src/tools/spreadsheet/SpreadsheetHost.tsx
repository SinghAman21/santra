import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import SpreadsheetEditor, { type SheetContext } from "./SpreadsheetEditor";
export default function SpreadsheetHost() {
  const [context, setContext] = useState<SheetContext | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<SheetContext>("santra:sheet-context", event => { if (active) setContext(event.payload); });
        const current = await invoke<SheetContext | null>("spreadsheet_context");
        if (active && current) setContext(current);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => { active = false; unlisten?.(); };
  }, []);
  if (context) return <SpreadsheetEditor key={context.id} context={context} onClose={() => { setContext(null); void getCurrentWindow().hide(); }} />;
  return <main className="tool-host-state" role={error ? "alert" : "status"}>{error || "Opening spreadsheet tools…"}</main>;
}
