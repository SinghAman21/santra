export const formats = ["xlsx", "xls", "ods", "csv", "tsv"] as const;
export type Format = (typeof formats)[number];
export const lossWarning =
  "Rewriting with SheetJS may lose unsupported document parts, macros, external links, charts and formatting fidelity. Formulas are preserved where supported but are not recalculated. The source is preserved.";
