# Implementation status and next work

The `tauri-rt` branch has Tauri as its sole desktop runtime. The React/Vite workspace, citrus wheel, compact editors, local Rust job queue, detected optional backends, GNOME command bridge, Windows watcher, and Windows/Linux package configuration are in code. This is **code completion work**, not a claim of feature parity. The integrated Windows 10/11 x64 and Ubuntu LTS x64 checks remain in [Phase 8](TAURI_VALIDATION_CHECKLIST.md). The [parity matrix](TAURI_PARITY_MATRIX.md) is the detailed migration ledger.

| Area | Current code | Remaining acceptance work |
| --- | --- | --- |
| Images | Capability-gated Rust raster conversion plus local preview/editor surfaces for crop, resize, rotate with flip controls, adjustments, compression, canvas backgrounds, and metadata tools; optional ExifTool JPEG metadata copy | Verify format/codec matrix, metadata preservation and animated inputs against the previous release; manually validate local background-image selection and output handling before declaring parity |
| Subtitles and archives | Local SRT/VTT conversion; bounded ZIP/TAR/GZIP create/extract with path and link checks | Malformed input corpus, cancellation, and platform file-manager workflows |
| Audio/video | Detected FFmpeg routes for conversion, trim, multi-track split, ordered merge, visualization, waveform preview, 30-second video editor preview, merged frames & GIF, merged mute & extract audio, merged crop & resize, merged rotate & flip, multi-track shape redaction, and separate audio/video editor windows | Per-codec results, full-length visual seeking, metadata, playback, cancellation, and actual local output checks on both operating systems; audio lacks WaveSurfer regions/envelopes/recording and volume/fade/mute/speed/noise-reduction controls |
| PDF/documents | Detected Poppler, qpdf, Pandoc, and LibreOffice routes | Optional-tool fixtures, fidelity and safety review; absent tools stay hidden |
| Wheel/platform | Configurable double-tap modifiers with two taps begun during the drag, Tauri overlay, optional GNOME extension and Windows watcher, direct background conversion on a selected slice, accessible workspace fallback, repeat-drop handling and visible failure handoff | Real GNOME Files and Explorer drags, monitor/DPI placement, focus, screen lock/resume, extension absent/present |
| Packaging | Ubuntu `.deb`/AppImage config; small x64 NSIS setup asks before downloading WebView2 when missing and reuses an existing Runtime | Native Windows/Ubuntu install/uninstall checks, clean-machine, existing-runtime and declined-download paths, final installed bytes, AppImage portability, Windows signing, full license notice review |

Unimplemented scope stays disabled: SVG with external-resource isolation, HEIC without a validated codec, encrypted/password and RAR/7z archives, editable PDF/OCR, Office reconstruction, and native share providers. Do not add routes based only on extensions. Do not add macOS support. Update this document and [capabilities](CAPABILITIES.md) as code or proof changes.

## Website landing experience

The `website/` landing page uses one persistent SVG orange from branch to cut cross-section to the actual desktop wheel. Its rind, center and path node registration are retained; the arrow, branch and trunk use the same camera coordinates. The SVG settles into its reserved workspace anchor without replacing or fading the fruit, and normal layout takes over for stable interaction. Reverse/fast scrolling, intermediate cut masks, viewport resizing and reduced motion are covered by browser checks. The cream/green/orange/blue palette also applies when a dark preference is stored.

The desktop starts with valid PNG, PDF, Markdown, SRT, WAV, ZIP and CSV samples. Selection and pointer dragging derive action lists from file signatures, validated UTF-8 text and the existing family registry. Images reuse the browser Canvas adapter; SRT/VTT/TXT follows the local Rust subtitle cue/timestamp rules. Single-file ZIP STORE creation and detected native GZIP compression produce actual downloadable outputs within the existing archive-creation scope. Browser limits are 20 MB per file, 24 megapixels for images, and 16 MiB/100,000 cues for subtitles. Source files remain present; outputs and measured duration/bytes appear beside the source. Imports and archives are never executed or extracted in the browser.

PDF, document, media and archive-extraction operations show an explicit desktop-engine requirement; spreadsheet conversion stays disabled. No Tauri/Rust job bridge, native path access or source-adjacent write is claimed for the website. Existing `/tools`, `/usecase`, `/pricing` and `/install` routes remain available. Gesture guidance explains Shift conversion, Alt or Ctrl+Shift tools, and Ctrl file actions with same-modifier release/repress within 400 ms, plus pointer, keyboard and touch alternatives. Browser dragging is not evidence of global Explorer/GNOME acceptance. Run `npm run test:website` for the landing and real-output checks; native platform validation remains separate.

The reverse-scroll handoff is now stateless: scene channels and docking are functions of absolute scroll position and measured layout. The old `hasDocked` latch caused different forward/reverse poses; stable top-aligned wheel layout replaces its need. The complete public landing catalogue comes from `website/src/tools-data.ts`: nine families, 33 output options, 36 editor entries (seven explicitly non-executable audio concepts), with two zero-option families marked not enabled. Shared helpers and validated selectors on the existing `/tools` route prevent catalogue/preview drift; per-option ExifTool/JPEG requirements are explicit. Larger contextual action lists use six-slot pagination.

## White UI and feature-source migration

Penpot frames 01–10 now map to feature modules under `tools/`, `convert/`, and `action/`, with reusable UI under `common/`. Image/video controls are split by operation; audio adds a local playback/waveform editor; archive and document-family conversions have compact reviews. Theme switching is removed: desktop surfaces are white, and orange accents use `#ff5a00`. See [UI structure](UI_STRUCTURE.md) for frame-specific limits. Existing backend gates and Phase 8 native verification requirements remain unchanged.

Image-only follow-up: match the Penpot wheel geometry and compact editor layout, isolate those styles from other media families, and correct legacy GNOME launch configuration when it still invokes `santara`. Rounded slices, source/selection center, icon labels, preview toolbar, notice row, and compact footer now have browser coverage. Native image/wheel sizes are updated; real Windows/GNOME drag verification remains open.

## Remaining wheel frames and MKV detection

Penpot frames 02–10 now share the rounded white wheel, family-specific icons/order, primary `#ff5a00` selection, and explicit unsupported/no-tools states. Supported media editors, PDF and conversion/archive reviews follow the compact reference layout. Native drag-enter detection replaces the former provisional-image assumption; MKV and bounded EBML signatures select video before drop. Browser extension/MIME hints and source selection use one classifier. Native directory inspection does not recurse during a drag, and per-window generations reject stale inspection results.

Office conversion and proposal-only tools remain disabled. Phase 8 real Explorer/GNOME drag, focus, and packaging verification requirements remain open.

Wheel placement follow-up: native rings and unknown-file cards are centered in the host so the opening drag cursor immediately falls inside. Workspace placement measures actual ring geometry and clamps the whole panel; it does not follow the pointer while choosing. Configured native dimensions avoid zero-size startup placement, and target-monitor scaling/work-area bounds are included. Geometry tests do not replace manual real GNOME/Explorer drag validation.


### Local PDF popup tools (November 2026)

The capability registry exposes Organize, Merge, Split, Extract, Insert, Compress,
Redact, Metadata, and Export Pages in that wheel order. All use the shared
Audio/Image `ReferenceEditor` popup shell. Native wheel activation uses a compact
PDF popup host without focusing the workspace; deliberate workspace activation
uses the same editor as a modal. PNG/JPEG are page-export options, not separate
PDF wheel conversions. PDF.js renders lazy page thumbnails with a bundled worker;
pdf-lib edits documents and fflate bundles multiple outputs. No remote resources
or uploads are used. Native outputs enter the local job system with existing
collision handling; browser outputs download directly.

Compression rebuilds pages as JPEGs and can increase file size. Secure redaction
requires confirmation and rebuilds every page as PNG pixels, discarding text,
vectors, attachments, annotations and document metadata. Both retain displayed
page dimensions and orientation. Inputs are bounded to 100 MB and 2,000 pages;
individual rendering is limited to 32 megapixels. Password-protected documents
are rejected. Real Windows/GNOME file-manager drag validation remains manual.

Native editor handoff filters mixed selections against the selected capability using inspected file metadata, matching editor validation. Unsupported files do not block compatible files from opening a tool.


### SheetJS spreadsheet wheel

The spreadsheet registry offers local SheetJS CE 0.20.3 conversion between XLSX,
XLS (BIFF8 output), ODS, CSV and UTF-8 TSV. Workbook parsing and writing run in a
bundled Web Worker with a 30-second timeout, 32 MB input limit, 256-sheet limit,
and two-million-cell limit per worksheet. Only one source workbook is accepted
per operation. Formulas are not recalculated. Native outputs use the shared
artifact job runner, temporary files, atomic publication, configured destination,
and collision handling; originals remain unchanged.

Shift conversions run in the hidden spreadsheet host without opening the
workspace. Multi-sheet workbooks are split into one output per worksheet before
conversion, including CSV, TSV and PDF; no worksheet is silently skipped. CSV
and TSV outputs contain one worksheet each. PDF is labeled **layout-limited**
and is generated locally as a paginated table PDF. It does not promise Excel
print fidelity. PDF export is limited to 100,000 cells and 64 columns per sheet;
the worksheet preview is limited to 2,000 cells.

Alt exposes only Split and Delete metadata. Split writes one output per selected
worksheet in the chosen supported format. Delete metadata creates a fresh
workbook without source Props, Custprops, VBA blobs or workbook-level external
link parts; copied cell comments and hyperlinks are removed as well. It requires
acknowledgement that unsupported document parts, macros, external links, charts
and formatting fidelity can be lost. It is not a forensic metadata scrubber.
Native Windows and GNOME drag/print dialog behavior still requires manual checks.

Document Shift routes are exposed per input only after a sandboxed Pandoc conversion probe succeeds for that reader and writer pair. Supported candidates are DOCX, Markdown, HTML, EPUB and TXT; the wheel warns about possible fidelity loss before conversion.

PDF and spreadsheet tool hosts have scoped window visibility permissions, and compact tool windows use transparent, rounded surfaces. Shared dialog and form component primitives retain local tool behavior.

Tool dialogs and common controls use shared shadcn components with Radix dialog, checkbox, slider, select and collapsible primitives. File and colour pickers use browser-native inputs; previews and the citrus wheel retain their specialized rendering.
