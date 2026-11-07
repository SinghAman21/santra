# Santra Audio Wheel Architecture

## Status and scope

**Reference proposal with implemented subset.** Audio tools now open an independent audio editor window, and the registry supports detected normalize, trim, channels, visualize, compress, split, merge, metadata-removal, and conversion routes. The editor surfaces normalize, channels, trim, visualize, compress, and metadata removal; split, merge, and conversion run from the wheel/queue paths without a dedicated control surface. See [UI structure](UI_STRUCTURE.md). The proposal sections below remain design guidance for the full audio workbench. The capability registry remains the source of truth.

The references are interaction and layout inspiration only. Santra keeps its own citrus identity and Windows/Linux desktop conventions; do not reuse third-party branding, artwork, or copy. Processing remains local and offline-first, with no upload, account, cloud service, or default telemetry.

## Observed interaction model

The wheel reference (`audio.png`) presents two distinct groups for a dragged audio file:

- **Convert formats — Shift:** M4A, WAV, FLAC, OGG, OPUS, AIFF, and WMA appear as output slices. The center shows the currently selected format. Only routes verified for the actual input and installed local encoders should appear in Santra.
- **File tools — Alt or Ctrl+Shift:** Compress, Metadata, Normalize, Visualize, Trim, Channels, and Bleep appear as tool slices. These are the tools evidenced by this image; it does not establish that they are supported by Santra or every input type.
- **File actions — Ctrl:** Retain Santra’s separate cross-platform actions wheel (such as Copy, Move, Copy Path, Open Terminal, Share, and Quick Preview). The audio references do not depict this wheel.

Use the same pointer-near wheel, labeled slices, keyboard navigation, and screen-edge placement proposed for Santra’s other media wheels. A drag can select a slice by hovering, direct drop, or keyboard. Enter confirms; Escape cancels. Modifier defaults are **Shift** for conversion, **Alt** (or **Ctrl+Shift**) for tools, and **Ctrl** for file actions. Shortcuts must remain configurable. Do not use Command/⌘ conventions.

The wheel should be capability-filtered: inspect the selected files and available local backends, show only valid operations, and explain partial applicability for mixed selections before running. Dropping a conversion route should queue it locally. Selecting an editor tool should open a compact tool window, not the full dashboard. By default, write a new collision-safe output beside its source and preserve the original.

## Visual language and shared editor shell

The reference pages use a light neutral surface, compact rounded editor windows, restrained orange accents, and a clear title bar with a close control. Waveforms use orange amplitude marks on a pale track; playback previews are visually distinct from settings. Use these as broad layout cues, not as exact copied UI. Santra should apply its own typography, colors, icons, and citrus mark.

Proposed shared audio editor layout:

```text
┌ Tool title                                      Close ┐
│ Source name · duration · local preview status         │
│                                                       │
│   Waveform / channel lanes / visualization preview    │
│   Play controls · current time / total duration       │
│   Selection handles or tool-specific timeline layers  │
│                                                       │
│   Tool settings and exact values                      │
│ Cancel                              Save new copy     │
└───────────────────────────────────────────────────────┘
```

Keep the waveform or preview large enough to inspect while keeping precise numeric controls visible. Use explicit time values in addition to pointer-drag handles. Preview playback should let the user compare the original and proposed result when that behavior is shown in the references. All preview and processing is local. A saved result is a new file; closing or cancelling must not modify the source.

## Tool visual logic evidenced by the references

### Normalize volume

`audio1.png` shows an audio waveform preview and playback position, followed by three adjustable controls: target loudness, loudness range, and true-peak limit. Include numeric readouts and concise explanatory text. Provide a Normalize action. The values visible in the reference (approximately −16 LUFS, 11 LU, and −1.5 dBTP) are examples in the image, not Santra defaults or a required standard. Santra should choose and explain any defaults only after backend and product decisions.

### Audio visualizer

`audio1.png` shows a preview area with an orange waveform on a dark canvas, plus controls for visual style and aspect ratio. The accompanying description evidences an animated waveform or still-image output, with landscape, portrait, and square choices. The editor should preview the composition and expose only output types and settings that the installed local renderer can produce. Exact colors, animation controls, codecs, duration behavior, and export formats are not specified by the reference.

### Trim audio

`audio2.png` shows a waveform with draggable start/end handles, a highlighted selected range, start/end time labels, and selected duration. The controls include playback of the selected range, an optional “trim silence ends automatically” setting, and Apply. In Santra, provide keyboard-accessible handles and editable time fields as alternatives to dragging. Make the kept range and removed portions visually distinct. The reference does not specify silence-detection thresholds or whether trimming should re-encode.

### Convert audio channels

`audio2.png` shows separate left and right channel waveform lanes, per-channel playback controls, a Mono/Stereo output choice, and independent left/right volume controls. Include an output preview and Apply. Keep channel mapping explicit so a user can understand what happens to stereo input when choosing mono, or mono input when choosing stereo. The exact downmix/upmix policy is not shown and must be decided before implementation.

### Bleep audio

`audio3.png` shows a waveform timeline with one or more bleep regions on a separate aligned lane. The user can move a whole region or adjust its edges, and can compare original playback with playback “with bleeps.” Santra should show each region’s start/end values and provide keyboard-operable selection and resizing. A bleep replaces audio in the exported copy; it is not merely a playback effect. The reference does not identify the tone, tone frequency, fade behavior, or whether other replacement modes are intended.

### Compress and Metadata

The wheel shows **Compress** and **Metadata** as available-looking slices, but the supplied audio assets do not show their editor windows or settings. Do not infer detailed compression controls or claim metadata editing/removal behavior from the wheel labels alone. Before implementation, specify whether Metadata means inspect, edit, or delete, and define supported fields. Compression needs a separate design for codec/bitrate/quality choices, output-size feedback, and honest handling of cases where output grows.

## Not evidenced; do not assume

The supplied references do **not** show audio split, merge, speed, extraction, codec/bitrate/sample-rate controls, detailed compression or metadata editors, batch-job behavior, or specific backend support. These must not be presented as reference-derived or implemented features. If desired later, design and approve them separately. Conversion slices establish the visible format labels only; they do not prove every input-to-output pairing is valid.

## Implemented behavior

Audio tools open a separate audio editor window sized independently of the workspace, mirroring the image and video tool windows. The workspace keeps an in-window fallback only when the desktop bridge cannot open a popup. The editor uses the shared reference shell: source name, duration, output format, a large waveform/playback preview, then settings.

The current preview is a locally generated waveform image plus the original `<audio>` element. WaveSurfer, waveform regions, volume envelopes, and recording are not integrated yet. Do not describe the editor as a full non-linear audio workbench until those exist.

Implemented editor controls:

- **Normalize**: target loudness, loudness range, and true-peak limit, applied with FFmpeg `loudnorm` plus a 48 kHz `aresample`.
- **Channels**: explicit mono/stereo output count.
- **Trim**: start/end times for the saved copy.
- **Visualize**: waveform color and background color for the rendered video.
- **Compress**: quality/bitrate settings for the chosen audio output format.
- **Metadata**: writes a clean copy with copied tags and chapters removed where FFmpeg supports it.

The backend also supports audio split, merge (sequential concatenation), and format conversion. Those have no dedicated audio-editor control surface yet; merge is concatenation, not a crossfade or multi-track mix, and there is no volume, fade, mute, speed, or noise-reduction control. Silence trimming (`silenceremove`) and noise reduction (`afftdn`) are not implemented, so the editor must not offer them. Output actions appear only when the installed FFmpeg build reports the required encoder, muxer, and filters.

The audio editor is local-only and non-destructive: saving writes a new collision-safe file, and closing or cancelling leaves the source untouched.

## Accessibility, output, and safety proposal

- Make every wheel slice, waveform lane, playback action, handle, and setting keyboard accessible with a visible focus state and screen-reader label. Hover must never be required.
- Provide keyboard alternatives for seeking, playback, channel selection, and adjusting time ranges; retain exact time values for precision.
- Show the source, selected output, and consequential transformations before saving. Preserve the source and never silently overwrite an existing destination.
- Validate actual audio streams and backend support locally rather than trusting extensions. Treat malformed media as untrusted input; never execute it.
- Render previews locally. Use temporary output followed by atomic publication; clean temporary data on cancel or failure.
- Report actionable errors and offer the final path, Open, Reveal in File Manager, and Retry where applicable.

## Decisions needed before implementation

1. Confirm the remaining tool names and wheel grouping, especially whether **Bleep** is added; Compress, Metadata, Normalize, Visualize, Trim, and Channels are implemented.
2. Decide whether the selected conversion slice queues immediately or first opens a compact format-options step for quality/settings.
3. Approve Santra-specific editor proportions, color treatment, waveform contrast, and whether playback/preview controls are shared across all audio tools.
4. Define channel downmix/upmix behavior, normalization defaults, any bleep tone behavior, visualizer export options, and the remaining metadata action scope.
5. Map any additional approved actions to verified local backends and capabilities before exposing a wheel slice.

The implemented subset above is current; the unbuilt interactions remain design guidance and must not be treated as available until a separate implementation review lands.

## UI source migration (Penpot frame 03)

Frontend ownership now follows `src/tools/<family>`, `src/convert/<family>`, `src/action`, and `src/common`. See [UI structure](UI_STRUCTURE.md) for exact files and implemented/deferred frame coverage. Editors use white surfaces and `#ff5a00` accents; shortcuts remain configurable. This UI migration does not enable any additional backend route or certify proposed features above.

## Penpot frame 03 implementation follow-up

The wheel now uses the shared `common/ReferenceWheel.tsx` and family profile, with white segments, `#ff5a00` selection, correct family center/icon, and explicit empty states. Supported editors/reviews use the compact reference shell (PDF retains its validated native dialog). Only currently verified operations appear; proposal-only controls above are not enabled by this change. See [UI structure](UI_STRUCTURE.md) for current ownership and native drag classification.
