import { AudioLines, FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, Files } from 'lucide-react';
export type WheelOption = {
    label: string;
    detail: string;
    availability?: 'concept' | 'conditional';
    backend?: string;
};
export type CatalogueMode = 'convert' | 'tools';
export type Family = {
    id: string;
    name: string;
    Icon: typeof FileImage;
    formats: string;
    note: string;
    detail: string;
    status: 'bundled' | 'conditional' | 'disabled';
    backend: string;
    outputs: WheelOption[];
    tools: WheelOption[];
    caveat: string;
};
export const families: Family[] = [
    { id: 'images', name: 'Images', Icon: FileImage, formats: 'JPG · PNG · WebP · TIFF · AVIF', note: 'Shape the picture. Keep the original.', detail: 'The bundled Rust raster processor handles common raster conversion and a separate local preview editor handles image adjustments. JPEG metadata editing additionally requires detected ExifTool.', status: 'bundled', backend: 'Rust image processor · bundled', outputs: ['PNG', 'JPG', 'WebP', 'TIFF', 'AVIF'].map(label => ({ label, detail: `Convert a copy to ${label}.` })), tools: [
            ['Compress', 'Tune quality or target size; an output can still grow.'], ['Crop', 'Set a free or preset crop and save a new image.'], ['Resize', 'Choose dimensions and fit behavior.'], ['Rotate', 'Turn the image without changing the source.'], ['Flip', 'Mirror the image horizontally or vertically.'], ['Add background', 'Build a new canvas with solid, gradient, or transparent fill.'], ['Edit photo', 'Adjust brightness, contrast, and saturation.'], ['Edit metadata', 'Update supported JPEG EXIF text fields when ExifTool is detected; save a same-format copy.'], ['Delete metadata', 'Save a clean copy without copied metadata.'],
        ].map(([label, detail]) => ({ label, detail, ...(label === 'Edit metadata' ? { availability: 'conditional' as const, backend: 'ExifTool · JPEG only' } : {}) })), caveat: 'Additional outputs depend on verified local routes. SVG is disabled; annotation, redaction, and collage are not implemented.' },
    { id: 'video', name: 'Video', Icon: FileVideo, formats: 'MP4 · MOV · MKV · WebM · AVI · WMV · GIF', note: 'Keep the moment. Lose the busywork.', detail: 'A compact local editor supports practical video cuts, frame work, and conversions when FFmpeg and FFprobe report compatible routes.', status: 'conditional', backend: 'FFmpeg + FFprobe · optional', outputs: ['MP4', 'MOV', 'MKV', 'WebM', 'AVI', 'WMV', 'GIF'].map(label => ({ label, detail: `Convert or export to ${label} when the installed codecs support it.` })), tools: [
            ['Compress', 'Choose output quality; compression may increase size.'], ['Trim', 'Set exact start and end times.'], ['Split', 'Create segments from selected split points.'], ['Merge', 'Order compatible clips; re-encode is the default.'], ['Crop', 'Set a fixed crop for the full clip.'], ['Resize', 'Choose output dimensions.'], ['Rotate', 'Rotate or flip the frame.'], ['Speed', 'Adjust playback speed with a new output.'], ['Snapshot', 'Save selected frames as images.'], ['Mute', 'Remove the audio stream from a copy.'], ['Create GIF', 'Export a selected clip as a GIF.'], ['Extract audio', 'Save the primary audio stream.'], ['Redact', 'Apply a fixed-position solid mask over a time range.'], ['Delete metadata', 'Remove copied tags where supported.'],
        ].map(([label, detail]) => ({ label, detail })), caveat: 'Routes vary by local codecs and filters. Redaction is fixed-position and is not motion tracking or recovery-proof.' },
    { id: 'audio', name: 'Audio', Icon: AudioLines, formats: 'MP3 · M4A · WAV · FLAC · OGG · Opus · AIFF · WMA', note: 'A good sound in the right format.', detail: 'Audio conversion routes are detected from local FFmpeg support. The seven editor tools below are design concepts, not enabled app routes.', status: 'conditional', backend: 'FFmpeg conversion · editor concepts planned', outputs: ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG', 'Opus', 'AIFF', 'WMA'].map(label => ({ label, detail: `Convert to ${label} when a compatible local encoder is detected.` })), tools: [
            ['Compress', 'Concept: compare codec and quality choices before exporting a new copy.'],
            ['Metadata', 'Concept: explore track tags; inspect, edit, and delete scope is not yet defined.'],
            ['Normalize', 'Concept: bring uneven loudness toward a chosen target with peak limits.'],
            ['Visualize', 'Concept: turn the audio waveform into a visual composition.'],
            ['Trim', 'Concept: keep a selected time range and preserve the source.'],
            ['Channels', 'Concept: preview how left and right channels map to an output.'],
            ['Bleep', 'Concept: replace selected time ranges in a new audio copy.'],
        ].map(([label, detail]) => ({ label, detail, availability: 'concept' as const })), caveat: 'Audio editor tools are proposal-only. Their previews explain intended behavior; no audio editing route is available in this build.' },
    { id: 'pdf', name: 'PDFs', Icon: FileText, formats: 'PDF · PNG · JPG', note: 'A little less paperwork.', detail: 'qpdf handles structural operations; Poppler renders one selected page to an image when available.', status: 'conditional', backend: 'qpdf / Poppler · optional', outputs: [{ label: 'PNG', detail: 'Render the selected page to PNG.' }, { label: 'JPG', detail: 'Render the selected page to JPG.' }], tools: [
            ['Compress', 'Rewrite PDF structure with qpdf; size may not decrease.'], ['Extract pages', 'Save a selected page range as a new PDF.'], ['Merge PDFs', 'Join selected PDFs in their chosen order.'], ['Rotate pages', 'Rotate the selected pages.'], ['Render page', 'Render one selected page through Poppler.'],
        ].map(([label, detail]) => ({ label, detail })), caveat: 'PDF-to-editable conversion, OCR, secure redaction, and metadata editing are not claimed.' },
    { id: 'documents', name: 'Documents & EPUB', Icon: Files, formats: 'DOCX · Markdown · TXT · HTML · EPUB', note: 'Move text between useful formats.', detail: 'Document conversion uses Pandoc only for reader/writer pairs that pass local checks and sandbox restrictions.', status: 'conditional', backend: 'Pandoc · detected and self-tested', outputs: ['DOCX', 'Markdown', 'TXT', 'HTML', 'EPUB'].map(label => ({ label, detail: `A candidate output; only locally verified routes appear in the app.` })), tools: [], caveat: 'Layout fidelity varies. External resources are blocked; there are no document editing tools or EPUB validator.' },
    { id: 'subtitles', name: 'Subtitles', Icon: FileText, formats: 'SRT · VTT · TXT', note: 'Keep every word on time.', detail: 'The built-in converter validates cue timing and preserves order for SRT and VTT conversion.', status: 'bundled', backend: 'Built in', outputs: [{ label: 'SRT', detail: 'Convert subtitle cues to SRT.' }, { label: 'VTT', detail: 'Convert subtitle cues to WebVTT.' }, { label: 'TXT', detail: 'Export plain text; timestamps and markup are omitted.' }], tools: [], caveat: 'Styling and format-specific settings may be lost. No subtitle editing tools are in scope.' },
    { id: 'archives', name: 'Archives', Icon: FileArchive, formats: 'ZIP · TAR · GZIP', note: 'Neatly packed. Carefully unpacked.', detail: 'Create and extract common archives locally with bounded size/count handling and path traversal checks.', status: 'bundled', backend: 'Built in · bounded archive routes', outputs: [{ label: 'ZIP', detail: 'Create a ZIP copy using STORE mode.' }, { label: 'TAR', detail: 'Create a plain USTAR archive.' }, { label: 'GZIP', detail: 'GZIP one regular file; it is not a multi-file container.' }], tools: [{ label: 'Extract archive', detail: 'Extract supported entries while rejecting unsafe paths and links.' }], caveat: 'RAR and 7z are unsupported. ZIP creation uses STORE and does not promise size reduction.' },
    { id: 'spreadsheets', name: 'Spreadsheets', Icon: FileSpreadsheet, formats: 'XLSX · ODS · CSV · TSV', note: 'A future route, not a promise.', detail: 'LibreOffice probing does not enable spreadsheet conversion. It remains disabled pending safe isolation and fixture verification.', status: 'disabled', backend: 'Office conversion · disabled', outputs: [], tools: [], caveat: 'No spreadsheet conversion or editing options are enabled in this build.' },
];
// Public catalogue consumers share the same ordering and explicit scope flags.
export function familyOptions(family: Family, mode: CatalogueMode, { includeConcepts = true }: {
    includeConcepts?: boolean;
} = {}) {
    const options = mode === 'convert' ? family.outputs : family.tools;
    return includeConcepts ? options : options.filter(option => option.availability !== 'concept');
}
export function catalogueEntries(family: Family) {
    return (['convert', 'tools'] as const).flatMap(mode => familyOptions(family, mode).map(option => ({
        key: `${family.id}:${mode}:${option.label}`, family, mode, option,
    })));
}
export function catalogueHref(family: Family, mode?: CatalogueMode, option?: WheelOption) {
    const params = new URLSearchParams({ family: family.id });
    if (mode)
        params.set('mode', mode);
    if (option)
        params.set('action', option.label);
    return `/tools?${params.toString()}`;
}
export function catalogueSelection(search: string) {
    const params = new URLSearchParams(search), family = families.find(item => item.id === params.get('family'));
    if (!family)
        return undefined;
    const mode: CatalogueMode = params.get('mode') === 'tools' ? 'tools' : 'convert';
    const options = familyOptions(family, mode), index = options.findIndex(option => option.label === params.get('action'));
    return { familyId: family.id, mode, index: Math.max(0, index) };
}
