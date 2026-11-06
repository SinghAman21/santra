# Third-party notices

Santra application code is MIT licensed. The Tauri runtime, Rust crates, React, Lucide, system WebViews, and optional local engines retain their own licenses. The final package-specific dependency inventory is generated from `package-lock.json` and `cargo metadata` by `npm run release:report` into `build/dependency-inventory.json`. That inventory records declared licenses and versions, not full redistribution notices or a legal review.

The app includes Tauri and Rust crates such as `image`, `zip`, `tar`, and `flate2`, plus React, React DOM, and Lucide React. Exact transitive packages and their licenses must be reviewed from the generated inventory for each final build. The Windows package includes Santra's user-mode drag watcher and the WebView2 offline installer configured by Tauri; the license and redistribution inventory for that installer remains a Phase 8 release check. Linux `.deb` uses system GTK/WebKitGTK; AppImage is configured to bundle media framework components, whose exact shipped files and notices need an artifact audit.

FFmpeg/FFprobe, Poppler, qpdf, Pandoc, LibreOffice, and ExifTool are optional programs installed separately by the user. Santra does not bundle, download, or update them. Their licenses depend on the local distribution and build, including FFmpeg's codec configuration. Do not infer that every optional route is available from a program name alone.

Before public distribution, inspect each Windows and Linux artifact, preserve required notices and source offers, verify any dynamically linked LGPL component obligations, and make the final inventory available beside the release. `build/dependency-inventory.json` and this summary are evidence inputs, not certification of compliance. The [Phase 8 checklist](docs/TAURI_VALIDATION_CHECKLIST.md) retains this release gate.


## Browser PDF tools

- pdf-lib: MIT license, https://github.com/Hopding/pdf-lib
- PDF.js (pdfjs-dist): Apache-2.0 license, https://github.com/mozilla/pdf.js
- fflate: MIT license, https://github.com/101arrowz/fflate

These libraries process files locally. PDF.js worker code is bundled with the application.
