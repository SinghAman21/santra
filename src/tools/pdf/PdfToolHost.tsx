import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Capability, LocalFile } from "../../common/types";
import PdfWorkspace from "./PdfWorkspace";
type Context = {
  id: string;
  capability: Capability;
  files: LocalFile[];
  format: string;
};
export default function PdfToolHost() {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    let active = true;
    const listener = listen<Context>("santra:pdf-context", (event) => {
      if (active) setContext(event.payload);
    });
    void invoke<Context | null>("pdf_context").then((c) => {
      if (active) setContext(c);
    });
    return () => {
      active = false;
      void listener.then((stop) => stop());
    };
  }, []);
  return context ? (
    <PdfWorkspace
      key={context.id}
      files={context.files}
      capability={context.capability}
      format={context.format}
      initialOptions={{}}
      onApply={() => {}}
      loadPreview={async () => ({ url: "" })}
      onClose={() => {
        setContext(null);
        void getCurrentWindow().hide();
      }}
    />
  ) : null;
}
