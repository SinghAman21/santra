# Santra Document Wheel Architecture

## Status and scope

This document defines the proposed drag-first workflow for text and word-processing documents. The current document route is conditionally implemented through the sandboxed Pandoc adapter; only detected, self-tested reader/writer combinations may appear. It currently enforces a 16 MiB input limit, blocks external resources, and does not provide PDF or filter routes. Complex layout fidelity is not guaranteed. See `docs/EPUB_WHEEL_ARCHITECTURE.md` for EPUB-specific behavior and `docs/PDF_WHEEL_ARCHITECTURE.md` for PDF workflows.

Supported candidate inputs are DOCX, Markdown, TXT, HTML, and EPUB. Candidate outputs are DOCX, Markdown, TXT, HTML, and EPUB, but the wheel must use the actual intersection of verified installed capabilities. Do not advertise ODT, RTF output, RTFD, or text clippings until a separately verified route is added.

## Modifier and interaction model

- **Shift — Convert:** while dragging document files, show compatible output formats only. Choosing an output queues a local conversion after drop.
- **Alt — Tools:** no document-specific editing tools are in scope yet. Do not show empty or planned-only tools; a future preview/metadata tool requires a separate capability and UI design.
- **Ctrl — File actions:** Copy, Move, Copy Path, Open Terminal, Share when a native provider exists, and Quick Preview. These work independently of conversion availability.

Use the global citrus wheel near the drag pointer, with visible output labels, keyboard selection, Enter to confirm, and Escape to cancel. For mixed selections, show routes applicable to all selected files or explicitly mark a safe partial-batch route before confirmation. If an OS drag does not expose file details before drop, show a provisional picker and resolve actual routes after receiving the files.

## Shift conversion routes

Build the output list from verified reader/writer pairs in the local capability registry. Candidate routes include:

- DOCX to Markdown, TXT, HTML, or EPUB where both reader and writer are verified.
- Markdown, TXT, or HTML to DOCX, Markdown, TXT, HTML, or EPUB where supported.
- EPUB conversions as enumerated in the EPUB architecture.
- Same-family routes only when they perform a useful, tested transformation; do not show a no-op same-format conversion.

Do not infer DOCX-to-PDF or office-to-PDF support from the presence of LibreOffice. Office conversion remains disabled until the subprocess is appropriately isolated from macros, external links/resources, user profiles, and untrusted input.

Before queuing, identify likely fidelity loss for complex documents: page layout, fonts, tables, equations, tracked changes, comments, images, footnotes, and embedded objects. Keep the warning concise and specific to the route. The conversion remains local; source files are never overwritten.

## Compact interaction and output

Conversion is immediate after a format is selected and the file is dropped; do not open the full workspace. Use `filename-converted.ext` beside the source by default, collision-safe naming, a temporary file followed by atomic publication, and a local progress/result notification with Open and Reveal in File Manager. Preserve basic semantic structure when supported: heading hierarchy, paragraphs, links, lists, tables, and images. State when a route is text extraction rather than layout-preserving conversion.

If a format is unavailable, omit it from the wheel and provide an accessible explanation in the post-drop picker or capability settings. Report malformed, encrypted, unsupported, oversized, permission-denied, and backend-failure errors without dumping document contents into logs.

## Capability and safety requirements

Each route declares accepted signature/type, detected backend and version, reader, writer, batch support, size limits, metadata behavior, warning, and fixture test. Validate actual input content where practical; extensions alone are insufficient. Treat office and document inputs as untrusted. Do not execute macros, load remote resources, or fetch linked content. Keep temporary conversion profiles isolated and clean temporary files on failure or cancellation. Never upload file contents, paths, filenames, previews, metadata, or telemetry.

## Verification plan

- Test each enabled reader/writer pair with original, permissively licensed fixtures covering headings, lists, links, tables, and embedded images.
- Verify output opens/parses, expected structural elements survive, and known fidelity losses are reported.
- Test malformed files, misleading extensions, oversized inputs, blocked external resources, missing Pandoc/sandbox, cancellation, collisions, and output permissions.
- Confirm batch partial failures are reported per file and no normal conversion makes network requests.
- Test wheel and accessible picker keyboard paths, focus restoration, output beside source, and native file-manager reveal on Windows and Linux.

## Implementation sequence

1. Keep the existing conditional Pandoc path and expose only tested route intersections in Shift.
2. Add route-specific warnings and an accessible post-drop format picker for protected OS drags.
3. Expand format coverage only with sandboxed readers/writers, fixtures, dependency/license review, and round-trip quality checks.
4. Design document-specific tools separately; do not crowd the conversion wheel with unimplemented editor ideas.


## UI source migration (Penpot frame 06)

Frontend ownership now follows `src/tools/<family>`, `src/convert/<family>`, `src/action`, and `src/common`. See [UI structure](UI_STRUCTURE.md) for exact files and implemented/deferred frame coverage. Editors use white surfaces and `#ff5a00` accents; shortcuts remain configurable. This UI migration does not enable any additional backend route or certify proposed features above.

## Penpot frame 06 implementation follow-up

The wheel now uses the shared `common/ReferenceWheel.tsx` and family profile, with white segments, `#ff5a00` selection, correct family center/icon, and explicit empty states. Supported editors/reviews use the compact reference shell (PDF retains its validated native dialog). Only currently verified operations appear; proposal-only controls above are not enabled by this change. See [UI structure](UI_STRUCTURE.md) for current ownership and native drag classification.
