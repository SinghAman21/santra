# Capability specification and source registry

The `tauri-rt` branch uses Tauri and a runtime capability registry. Shift, Alt, and Ctrl each require two complete taps during an active drag before the wheel opens; a held modifier at drag start does not count. Dropping on a conversion slice queues a local job and closes the wheel without showing the workspace; failures close the wheel without opening the workspace. Rust image/subtitle/archive routes and detected FFmpeg, Poppler, qpdf, Pandoc, LibreOffice, and optional ExifTool routes are implemented in code. Rust raster processing removes metadata; detected ExifTool enables JPEG metadata editing as a same-format copy. FFmpeg includes snapshot, GIF, visualization, bounded redaction, split ranges, and ordered merge. The detailed status and native validation gaps are in `TAURI_PARITY_MATRIX.md`.

Research date: 2026-10-19. Only the public [Tangerine website](https://tangerineformac.com/) was read. No application binary was downloaded, run, decompiled, or reverse engineered. Public marketing is evidence of advertised behavior, not a tested technical implementation or Santra compatibility.

## Public reference observations

The site presents local conversion across media, documents, and archives, drag-triggered contextual controls, editing operations, and file actions. It also advertises keyboard interaction. These observations motivate the independent requirements below; they do not establish that Santra implements them. The source site's format lists and counts can change.

| Requirement ID | Independent Santra requirement | Current acceptance status |
| --- | --- | --- |
| CAP-001 | Import files with clear empty and unsupported states | Parent implementation and browser tests must verify |
| CAP-002 | Report input/output support per installed engine | Engine registry and real fixture tests required |
| CAP-003 | Queue jobs with progress, failure, cancellation, collision handling | Native integration evidence required |
| CAP-004 | Local processing with explicit dependency discovery | Network and process audit required |
| CAP-005 | Image transformations and metadata choices | Advanced requirements; adapter-specific verification pending |
| CAP-006 | Audio/video conversion, trim, compression | Optional system engines; codec/license and quality review pending |
| CAP-007 | Document, PDF, presentation, and spreadsheet workflows | Fidelity, fonts, encryption, and unsupported formats need explicit limits |
| CAP-008 | Archive operations and subtitle conversion | Traversal/bomb protection and encoding tests required |
| CAP-009 | Keyboard-operable UI, settings, meaningful disabled states | Browser scaffold covers only selected flows |
| CAP-010 | Desktop drag wheel and global shortcuts | OS-specific research, implementation, and accessibility testing pending |
| CAP-011 | File actions such as copy, move, reveal, copy path | Validate destinations and destructive-action policy; no macOS-only parity claim |
| CAP-012 | Windows NSIS and Linux deb/AppImage x64 distribution | Windows setup checks for WebView2, asks before downloading Microsoft's small bootstrapper when missing, then installs Santra; native Windows and clean-machine installation validation remain required |

## Sources

| Source ID | URL | Use and limitations |
| --- | --- | --- |
| SRC-001 | https://tangerineformac.com/ | Public product positioning, format families, local workflow, keyboard demonstration; simulation/marketing only |
| SRC-004 | https://playwright.dev/docs/test-webserver | Browser preview server lifecycle; native drag behavior requires platform testing |
| SRC-005 | https://playwright.dev/docs/mock-browser-apis | Pre-page-load bridge mocking technique |

## Evidence rules

Every enabled conversion should have an engine ID, supported direction, required tool and version, original or permissively licensed fixture, asserted output properties, and failure/cancellation evidence. Record status as proposed, implemented, verified, or unavailable, with a reason. Never convert marketing format counts into a Santra support claim. Native macOS formats, AirDrop, OS-specific shortcuts, OCR, PDF-to-office reconstruction, and lossless preservation require separate feasibility work.

## Current implementation inventory

The requirement table is an acceptance checklist, not a list of absent features. The current source implements the routes below; runtime detection and tests determine what actually works on a given machine.

| Family | Implemented adapter behavior | Limits |
| --- | --- | --- |
| Subtitles | Built-in SRT/VTT conversion and TXT output | Styling/settings may be lost; TXT omits timing |
| Images | Bundled Rust raster processing with detected JPG/PNG/WebP/TIFF/AVIF support and image operations; a separate local-preview tool window exposes stable crop bounds with corner/edge handles and keyboard nudge, resize with an encoder-gated output extension, rotate with flip controls, single-colour/local-image/landscape/portrait/custom canvas choices, brightness/contrast/saturation, compression, editable EXIF fields, and a metadata-removal copy | Metadata inspection beyond editable EXIF text fields, annotation, redaction, collage, and advanced photo controls are not implemented; native loading and detected formats gate availability; local background-image selection still requires native end-to-end validation; SVG disabled; HEIC backend-dependent |
| Audio/video | Capability-gated FFmpeg video wheel/editor: conversion, compression, trim, split, compatible merge, crop, resize, rotate/flip, speed, frame snapshots, mute, solid time-ranged redaction, metadata deletion, GIF, and audio extraction | FFmpeg/FFprobe feature detection gates each route; uses primary audio/video streams; redaction is fixed-coordinate (not tracked/blurred); re-encoding may increase size; audio editor remains proposal-only |
| PDF | Nine local popup tools using pdf-lib, PDF.js, Canvas and fflate | Raster compression/redaction lose text and vector fidelity; PDF-to-office/OCR not claimed |
| Documents | Pandoc conversion when sandbox and readers/writers are detected | Input/resource limits, fidelity loss, no PDF/filter support; inspect registry warnings |
| Office | LibreOffice probing exists | Conversion disabled pending isolation of macros/external resources |
| Archives | Built-in ZIP/TAR/GZIP creation and extraction using mature archive libraries | ZIP STORE creation and STORE/DEFLATE extraction; plain USTAR; GZIP accepts one regular file; bounded sizes/counts and no links/unsafe paths; RAR/7z unsupported |

The live Tauri `bootstrap` snapshot contains backend availability and capability records for the current machine. This environment-specific detection is not proof that every declared input/output pair has been converted; filter `available` and run representative local fixtures during Phase 8.

## Drag and keyboard boundaries

The in-app action wheel, accessible post-drop conversion picker, and Tauri global overlay code are implemented. Shift, Alt, and Ctrl modes require two complete taps of the same modifier during a drag; a held key or single press has no wheel action. A selected conversion slice queues in the background without opening the workspace. Selected Ctrl file actions—and Escape/cancel from the global wheel—also close directly to the background; Copy/Move reserve a collision-safe sibling name rather than replacing a destination file. Only an unselected drop uses the deliberate workspace fallback. Native Share has no provider and is hidden. During an external drag, a WebView cannot read source filenames/paths until the OS delivers the drop. When early drag metadata has no usable type, Santra shows provisional image routes instead of an empty wheel and validates the actual file on drop. If the capability snapshot is still unavailable, the wheel offers the built-in Rust image routes until the registry loads; the backend validates every selected operation. The optional GNOME bridge and Windows watcher can request the overlay, but real Explorer and GNOME Files handoff remains a Phase 8 gate.

Many primary strings are centralized, but details remain hardcoded. Full localization is a roadmap requirement, not a delivered internationalization guarantee. The Tauri image route removes metadata during raster processing; detected ExifTool adds JPEG metadata editing as a separate copy operation.


## Website browser workspace boundary

The `website/` landing page uses one persistent SVG orange from branch to cut cross-section to the actual desktop wheel. Its rind, center and path node registration are retained; the arrow, branch and trunk use the same camera coordinates. The SVG settles into its reserved workspace anchor without replacing or fading the fruit, and normal layout takes over for stable interaction. Reverse/fast scrolling, intermediate cut masks, viewport resizing and reduced motion are covered by browser checks. The cream/green/orange/blue palette also applies when a dark preference is stored.

The desktop starts with valid PNG, PDF, Markdown, SRT, WAV, ZIP and CSV samples. Selection and pointer dragging derive action lists from file signatures, validated UTF-8 text and the existing family registry. Images reuse the browser Canvas adapter; SRT/VTT/TXT follows the local Rust subtitle cue/timestamp rules. Single-file ZIP STORE creation and detected native GZIP compression produce actual downloadable outputs within the existing archive-creation scope. Browser limits are 20 MB per file, 24 megapixels for images, and 16 MiB/100,000 cues for subtitles. Source files remain present; outputs and measured duration/bytes appear beside the source. Imports and archives are never executed or extracted in the browser.

PDF, document, media and archive-extraction operations show an explicit desktop-engine requirement; spreadsheet conversion stays disabled. No Tauri/Rust job bridge, native path access or source-adjacent write is claimed for the website. Existing `/tools`, `/usecase`, `/pricing` and `/install` routes remain available. Gesture guidance explains Shift conversion, Alt or Ctrl+Shift tools, and Ctrl file actions with same-modifier release/repress within 400 ms, plus pointer, keyboard and touch alternatives. Browser dragging is not evidence of global Explorer/GNOME acceptance. Run `npm run test:website` for the landing and real-output checks; native platform validation remains separate.

The reverse-scroll handoff is now stateless: scene channels and docking are functions of absolute scroll position and measured layout. The old `hasDocked` latch caused different forward/reverse poses; stable top-aligned wheel layout replaces its need. The complete public landing catalogue comes from `website/src/tools-data.ts`: nine families, 33 output options, 36 editor entries (seven explicitly non-executable audio concepts), with two zero-option families marked not enabled. Shared helpers and validated selectors on the existing `/tools` route prevent catalogue/preview drift; per-option ExifTool/JPEG requirements are explicit. Larger contextual action lists use six-slot pagination.

## UI organization and availability

The [feature UI structure](UI_STRUCTURE.md) separates tools, conversion reviews, and file actions. The white Penpot-based UI does not expand the registry: annotation/collage, secure PDF redaction, archive inspection, EPUB certification, and office conversion remain unavailable where not implemented/verified. Audio preview plays the original; normalization/channel/visualizer settings affect the queued output only.

Image rotate recipes additionally accept `flipHorizontal` and `flipVertical` booleans (or explicit `"true"`/`"false"` recipe strings). Flips apply after rotation and affect the new output only. Invalid flag values are rejected. No annotation, collage, or image-redaction route is enabled by this layout update.

## File family detection and remaining Penpot frames

Native drag-enter inspects bounded headers (up to 512 bytes per regular file), without recursively reading folders, to choose the correct wheel before drop. EBML/Matroska/WebM headers select video; extension fallback is case-insensitive and covers all ten reference families. EPUB remains document-backed with a separate EPUB UI profile. Classification does not grant processing support: inputs and executable routes still pass the live capability registry and backend validation. Unknown inputs are never assumed to be images.

All family wheels use the shared white reference geometry. Video/audio, PDF, archive, document/EPUB and subtitle reviews use the compact reference layout. No archive inspection, EPUB certification, office conversion, or proposal-only audio/PDF tool is enabled by these UI changes. Waveform accents use `#ff5a00`.

Wheel positioning now centers the ring on the opening cursor, with monitor/work-area edge clamping. Native headings/captions/pagination no longer change the ring center. This improves the chance of immediate native drag-enter detection; cursor coordinates alone do not identify a file, and unknown input remains neutral until drag metadata arrives. Processing support is unchanged.


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
