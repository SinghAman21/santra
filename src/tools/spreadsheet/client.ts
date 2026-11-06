export class SheetClient {
  private worker = new Worker(new URL("./sheet.worker.ts", import.meta.url), {
    type: "module",
  });
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(data.id);
      data.error
        ? pending.reject(Error(data.error))
        : pending.resolve(data.result);
    };
    this.worker.onerror = () =>
      this.close("Spreadsheet worker failed. Please reload the file.");
  }
  request<T>(
    action: string,
    options: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.close(
            "Spreadsheet processing exceeded 30 seconds. Please choose a smaller file.",
          ),
        30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, action, ...options });
    });
  }
  close(message = "Editor closed.") {
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error(message));
    }
    this.pending.clear();
  }
}
