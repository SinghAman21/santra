# Santra Image Wheel Architecture

Tauri migration note: `src-tauri/` owns native drops and Rust raster jobs with crop, resize, rotation, flip, adjustments, and generated background canvases. Detected ExifTool adds same-format JPEG metadata editing. The GNOME extension targets Tauri's single-instance wheel command; the Windows watcher is bundled by the Tauri NSIS config. The detailed design below includes previous-release behavior and future requirements. Metadata preservation across raster transforms, codec parity, and real global drags remain unverified or incomplete; see `TAURI_PARITY_MATRIX.md`.

## Product direction

Santra should feel like a desktop wheel utility. A small Tauri desktop host owns the global wheel, local workers, settings, notifications, and native integrations. The workspace stays available for history, settings, queue, and accessibility fallback.

This document defines the next implementation scope for image files only. Audio, video, PDF, documents, archives, and other extensions remain unchanged until a separate design is approved.

## Target interaction

```text
Drag image
  -> double-tap Shift within 400 ms
  -> conversion wheel appears
  -> choose output format
  -> drop on an available format slice
  -> wheel closes; local conversion runs without opening the workspace
  -> new output appears beside the source by default
```

For image tools:

```text
Drag image
  -> double-tap Alt or the configured tools modifier within 400 ms
  -> image tools wheel appears
  -> choose a tool
  -> compact floating tool window opens
  -> preview and adjust locally
  -> Apply / Save copy
  -> new output is written beside the source
```

A single modifier press does not open the wheel. The first press and release must both happen after the drag begins and last no more than 400 ms; a modifier held before the drag cannot count as the first tap. The same key must be pressed again within 400 ms of that release. The wheel remains open after the second modifier press is released. Native drops use the pointer position to select a slice even when the webview receives no DOM drop event. Failed conversions return the files to the workspace with a visible error. The user selects a slice by hovering, dragging over it, clicking, or keyboard navigation. Enter confirms, Escape cancels, and arrow keys move between slices. When a native drag supplies no usable pre-drop type or URI metadata, Santra shows provisional image routes instead of an empty wheel and validates the actual file after drop. If the capability snapshot has not loaded, the wheel immediately offers the built-in Rust image routes; the backend validates the selected operation.

## Runtime architecture

### Hidden desktop host

The host remains installed as a background-capable desktop process. It is responsible for:

- Windows drag/modifier observation and Linux GNOME/XDND integration.
- The transparent, cursor-near citrus wheel overlay.
- Secure file-drop handoff and local file inspection.
- A local job queue and worker lifecycle.
- Rust image processing and local preview generation.
- Output naming, collision handling, atomic writes, cancellation, and cleanup.
- Small progress/result notifications.
- The tray status/quit control, diagnostics, and local job lifecycle.

The host must not upload files, filenames, paths, previews, metadata, or telemetry. It should start at login only when the user enables that preference; otherwise launching the wheel integration starts it on demand.

### Visible surfaces

Santra has four temporary surfaces:

1. **Citrus wheel** — conversion formats or image tools.
2. **Tool window** — a compact editor for one selected image operation.
3. **Progress/result notification** — status, cancel, retry, open file, and reveal folder.
4. **Full workspace** — deferred; it is not opened by the wheel workflow.

The full workspace is not required for, or opened by, a normal single-image conversion or tool edit.

## Conversion wheel

The conversion wheel is optimized for one-step output selection. For an image input, it displays only genuinely available raster outputs from the capability registry:

- PNG
- JPG/JPEG
- WebP
- TIFF
- AVIF
- BMP
- HEIC only when a verified local encoder is detected
- PDF when the local image-to-PDF route is available

SVG remains input-only unless a verified rasterization route is available. The wheel must hide unavailable formats instead of showing a dead route.

When the user chooses a format, Santra should:

- Inspect the dropped file locally before processing.
- Preserve the original file.
- Apply EXIF orientation correctly.
- Preserve metadata where the target supports it unless the privacy setting says to strip it.
- Warn when alpha will be lost, especially PNG/WebP/TIFF to JPG.
- Use the configured quality preset.
- Write beside the source by default using `name-converted.ext`.
- Resolve collisions according to Ask, Auto-rename, Skip, or explicitly confirmed Replace.
- Start the queue without opening the full workspace.

## Image tools wheel

The tools wheel opens after a double tap of the configured tools modifier, defaulting to Alt. For a supported image it should expose these tools as they become implemented and verified:

- Compress
- Crop
- Resize
- Rotate
- Flip
- Add Background
- Edit Photo
- Edit Metadata
- Annotate Photo
- Redact Photo
- Create Collage
- Strip Metadata

Each slice must include a short description and indicate when it applies only to part of a mixed selection. Unsupported tools must not appear merely because they are planned.

## Compact image tool windows

Tool windows are temporary, lightweight, and attached to the selected input. They should open near the wheel without exposing the full Santra workspace. Each window contains:

- A title and source filename.
- A local preview canvas.
- Before/after or original/current comparison where useful.
- Reset and Cancel actions.
- Apply / Save copy as the primary action.
- Output format, quality, and metadata controls where relevant.
- Clear warnings for alpha loss, metadata loss, re-encoding, or fidelity limits.

Applying a tool creates a new file; it never edits the source in place. The operation is represented as a validated recipe and submitted to the local queue. Temporary preview renders must be cleaned up on cancel, close, or failure.

## Image tool behavior

### Compress

Open a compact sheet showing original size, estimated output size when available, quality presets, target file size or reduction percentage, output dimensions, and metadata behavior. The primary action is `Compress`. Output defaults to `name-compressed.ext`.

### Crop

Show the image with a draggable crop rectangle and handles. Provide Free, 1:1, 4:3, 16:9, 3:2, and custom aspect ratios, plus exact pixel dimensions. Preserve orientation before calculating crop coordinates. Apply writes `name-cropped.ext`.

### Resize

Provide width, height, lock aspect ratio, fit mode, and no-enlargement controls. Preview the resulting dimensions before applying. Apply writes `name-resized.ext`.

### Rotate and Flip

Provide 90-degree rotation, arbitrary safe rotation where supported, horizontal flip, and vertical flip. The preview updates immediately. Apply writes a new output and preserves metadata where technically possible.

### Add Background

Provide Solid, Gradient, Transparent, or Local Image background modes when supported. Include canvas size, contain/cover/stretch/tile fit, alignment, padding, corner radius, and shadow controls. Show a checkerboard for remaining transparency. Warn before flattening alpha to JPG. Apply writes `name-background.ext`.

### Edit Photo

Provide a non-destructive adjustment panel with brightness, exposure, contrast, highlights, shadows, saturation, temperature, tint, sharpness, and noise reduction where the backend supports them. Include zoom, pan, before/after comparison, and undo/redo for the current recipe. Apply writes `name-edited.ext`.

### Edit Metadata

Show locally inspected metadata grouped by image, EXIF, GPS, color, and file fields. Allow individual field removal, Remove All, and Save. Do not expose binary metadata values that cannot be safely edited. Make the privacy effect clear. Apply writes `name-metadata.ext` or a configurable equivalent.

### Annotate Photo

Provide a canvas toolbar for arrows, lines, rectangles, circles, freehand drawing, text, numbered markers, color, stroke width, and undo/redo. Annotations are rendered into a new output only after Apply. The original remains unchanged.

### Redact Photo

Provide solid and blur redaction regions. Redaction must be destructive to the exported copy: the hidden pixels must not remain recoverable in the output file. Do not claim automatic face or text detection until a local, tested detector is implemented. Apply writes `name-redacted.ext`.

### Create Collage

Accept multiple selected image inputs. Provide grid, row, column, and featured layouts; column count; spacing; background; canvas dimensions; crop/fit behavior; and ordering. Preview the composition locally. Apply writes `collage.ext` or the configured naming pattern.

### Strip Metadata

Offer a one-click privacy tool with a short explanation of what is removed and what the encoder may regenerate. Apply writes `name-stripped.ext` and never changes the source.

## Backend and capability rules

- The Tauri Rust image processor is the bundled raster backend. Its codec and metadata gaps remain tracked in the parity matrix.
- ImageMagick is optional and must not be required for the primary JPG/PNG/WebP workflow.
- Every wheel item maps to a capability registry entry with inputs, outputs, backend, options, metadata behavior, batch support, and warnings.
- Preview and export must use the same validated recipe contract so what the user sees is consistent with the output.
- The registry must gate tools by detected backend support and safe input signatures, not file extensions alone.
- Every export uses a private temporary file followed by atomic publication.
- Originals are never silently replaced or deleted.

## Output and notifications

After an immediate conversion or applied tool, show a small local notification containing:

- Operation and source filename.
- Completed, failed, cancelled, or skipped state.
- Output filename and folder.
- Open converted file.
- Reveal in file manager.
- Retry when failed.

The notification should disappear automatically but remain available through the tray or recent activity surface. It must not force navigation to the main workspace.

## Accessibility and keyboard behavior

- Every slice has a screen-reader label and visible text.
- Hover is optional; keyboard focus can select every operation.
- Enter opens or confirms the selected operation.
- Escape closes the wheel or tool window without writing output.
- Arrow keys navigate slices and controls.
- Tool windows support normal tab order, visible focus, scalable text, and high contrast.
- All UI strings remain externalized for localization.

## Implementation sequence

1. Refactor global conversion dispatch so format selection queues immediately without focusing the main window.
2. Add a hidden-host lifecycle and compact progress/result notification path.
3. Refactor the existing image operation panel into a reusable floating tool-window shell.
4. Implement Compress, Crop, Resize, Rotate, Flip, and Add Background with live local previews.
5. Implement Edit Photo adjustments and before/after comparison.
6. Implement metadata editing and stripping with explicit privacy warnings.
7. Implement annotation, redaction, and collage with generated original fixtures.
8. Add capability-gated wheel routes and image-specific end-to-end tests.
9. Test Windows Explorer and Ubuntu GNOME drag/drop with the main workspace closed.
10. Update packaging, accessibility, user documentation, and the capability manifest after each verified tool.

## Current implementation note (2026-10-20)

Current Tauri code opens the compact image editor in a separate window with a local Rust preview and queue-backed output. The preloaded window receives a fresh editor context on each open, so its recipe and file selection reset for the new operation. It supports fit/zoom/pan, a stable crop frame with direct corner/edge handles and keyboard nudge, resize/fit with only capability-provided output encoders, rotation with horizontal/vertical flips, single-colour/local-image/landscape/portrait/custom backgrounds, and brightness/contrast/saturation. The detected ExifTool route exposes JPEG metadata fields; the built-in strip route creates a metadata-free copy. The older Sharp implementation described in this design is available in Git history; feature parity and notification behavior still require Phase 8 verification.

This remains an initial editor surface, not completion of the full tool roadmap. Background-image selection is local-file only and needs native end-to-end validation; no built-in background-image swatches ship without licensed assets. Advanced adjustment controls, broad metadata inspection, annotation, redaction, and collage are not exposed. The desktop host stays hidden while conversions run in the backend and image tools open as separate compact windows. Image conversion still needs end-to-end manual validation from external Windows/GNOME file managers.

## Acceptance criteria

- A JPG dragged from a file manager can be converted to PNG without opening the full Santra workspace.
- The output appears beside the source with a collision-safe name.
- Selecting Compress, Crop, Resize, Add Background, or Edit Photo opens only a compact tool window.
- Tool previews update locally and Apply creates a new output without modifying the source.
- Cancel closes the tool without output or leaked temporary files.
- Missing backends hide the affected wheel item or show a truthful unavailable state.
- Windows and Ubuntu Linux support the same image interaction model, with platform-specific drag adapters.
- No normal image workflow creates network requests or requires an account.

## Website image adapter

The `website/` landing page uses one persistent SVG orange from branch to cut cross-section to the actual desktop wheel. Its rind, center and path node registration are retained; the arrow, branch and trunk use the same camera coordinates. The SVG settles into its reserved workspace anchor without replacing or fading the fruit, and normal layout takes over for stable interaction. Reverse/fast scrolling, intermediate cut masks, viewport resizing and reduced motion are covered by browser checks. The cream/green/orange/blue palette also applies when a dark preference is stored.

The desktop starts with valid PNG, PDF, Markdown, SRT, WAV, ZIP and CSV samples. Selection and pointer dragging derive action lists from file signatures, validated UTF-8 text and the existing family registry. Images reuse the browser Canvas adapter; SRT/VTT/TXT follows the local Rust subtitle cue/timestamp rules. Single-file ZIP STORE creation and detected native GZIP compression produce actual downloadable outputs within the existing archive-creation scope. Browser limits are 20 MB per file, 24 megapixels for images, and 16 MiB/100,000 cues for subtitles. Source files remain present; outputs and measured duration/bytes appear beside the source. Imports and archives are never executed or extracted in the browser.

PDF, document, media and archive-extraction operations show an explicit desktop-engine requirement; spreadsheet conversion stays disabled. No Tauri/Rust job bridge, native path access or source-adjacent write is claimed for the website. Existing `/tools`, `/usecase`, `/pricing` and `/install` routes remain available. Gesture guidance explains Shift conversion, Alt or Ctrl+Shift tools, and Ctrl file actions with same-modifier release/repress within 400 ms, plus pointer, keyboard and touch alternatives. Browser dragging is not evidence of global Explorer/GNOME acceptance. Run `npm run test:website` for the landing and real-output checks; native platform validation remains separate.

The reverse-scroll handoff is now stateless: scene channels and docking are functions of absolute scroll position and measured layout. The old `hasDocked` latch caused different forward/reverse poses; stable top-aligned wheel layout replaces its need. The complete public landing catalogue comes from `website/src/tools-data.ts`: nine families, 33 output options, 36 editor entries (seven explicitly non-executable audio concepts), with two zero-option families marked not enabled. Shared helpers and validated selectors on the existing `/tools` route prevent catalogue/preview drift; per-option ExifTool/JPEG requirements are explicit. Larger contextual action lists use six-slot pagination.

## UI source migration (Penpot frame 01)

Frontend ownership now follows `src/tools/<family>`, `src/convert/<family>`, `src/action`, and `src/common`. See [UI structure](UI_STRUCTURE.md) for exact files and implemented/deferred frame coverage. Editors use white surfaces and `#ff5a00` accents; shortcuts remain configurable. This UI migration does not enable any additional backend route or certify proposed features above.

## Image-only Penpot alignment

The image wheel now uses `src/tools/image/ImageWheel.tsx` and `common/reference-wheel.css`: rounded annular slices, white surfaces, a single `#ff5a00` hover/keyboard selection, icons, a center thumbnail when the inspected source is available, and the active operation label. It has no enclosing rectangular card. JPEG/JPG and TIF/TIFF aliases share one displayed slice; unavailable routes are not fabricated. The remaining file families now share this reference geometry through `common/ReferenceWheel.tsx`; the image wrapper preserves image-specific format alias handling.

Image editor layout is owned by `image-reference.css`: an 800×560 surface, 72px title header, preview/settings columns, below-preview Fit and expandable zoom/pan controls, capability/error-only notice row, and output/footer actions. Resize has an aspect lock and capability-gated format Select; rotation can combine horizontal/vertical flips in one local recipe, so image Flip has no standalone wheel slice. The native image host is 824×584 with 12px padding and no OS title bar. The wheel host is enlarged to accommodate the 440px image wheel. Global real-file-manager drag and platform focus behavior still need manual verification.

If GNOME still shows the old brown wheel after installing Santra, inspect its saved command template: the legacy `santara` binary and flags launch a separate application. The current command is `santra --santra-wheel-action={action} --santra-global-wheel={mode} --santra-wheel-x={x} --santra-wheel-y={y}`.

The global wheel no longer assumes an image when the OS has not exposed file details. Native drag-enter inspection and shared extension/MIME hints select the family. A known MKV opens the video wheel; an unknown drag stays neutral until inspected.

## Cursor-centered wheel placement

The native ring now shares the undecorated host window's center; headings, source captions, and pagination do not offset it. Native placement uses the configured size at the target monitor's scale, including when a hidden window reports zero dimensions on startup, and clamps the host to that monitor's work area. The workspace fallback measures the rendered ring rather than using fixed offsets, anchors it at the cursor that opened it, and keeps it stationary while selecting. Screen-edge clamping may shift the center. Unknown-file cards use the same center so drag-enter detection can begin without moving to a distant panel.


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
