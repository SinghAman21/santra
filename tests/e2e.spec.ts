import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { AudioEditorContext, Bridge, ImageEditorContext, Job, Snapshot, VideoEditorContext } from '../src/common/types';

interface MockControl {
  state: Snapshot;
  calls: { method: string; value: unknown }[];
  emit(update: Partial<Snapshot>): void;
  emitWheelMode(mode: string, newDrag?: boolean): void;
  emitNativeDragEnter(files: Snapshot['files']): void;
  emitNativeDragOver(position: { x: number; y: number }): void;
  emitNativeDrop(files: Snapshot['files'], position: { x: number; y: number }): void;
  emitGlobalFiles(files: Snapshot['files'], mode: 'convert' | 'tools' | 'actions'): void;
  emitImageContext(context: ImageEditorContext): void;
  emitVideoContext(context: VideoEditorContext): void;
  emitAudioContext(context: AudioEditorContext): void;
}

declare global { interface Window { __santraTest: MockControl } }

test.beforeEach(async ({ page }) => {
  await page.route('**/fixtures/preview.webm',route=>route.fulfill({path:fileURLToPath(new URL('./fixtures/preview.webm',import.meta.url)),contentType:'video/webm'}));
  await page.addInitScript(() => {
    const incoming: Snapshot['files'] = [
      { id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' },
      { id: 'audio', path: '/fixtures/tone.wav', name: 'tone.wav', ext: 'wav', size: 2048, category: 'audio' },
      { id: 'subtitle', path: '/fixtures/captions.srt', name: 'captions.srt', ext: 'srt', size: 64, category: 'subtitle' },
    ];
    const droppedVideo: Snapshot['files'] = [{ id: 'video', path: '/fixtures/clip.mp4', name: 'clip.mp4', ext: 'mp4', size: 4096, category: 'video' }];
    const nativeDragEnterListeners = new Set<(files:Snapshot['files'])=>void>();
    const nativeDragOverListeners = new Set<(position: { x: number; y: number }) => void>();
    const nativeDropListeners = new Set<(files: Snapshot['files'], position?: { x: number; y: number }) => void>();
    const mergeVideos: Snapshot['files'] = [...droppedVideo, { id: 'video-2', path: '/fixtures/clip-2.mp4', name: 'clip-2.mp4', ext: 'mp4', size: 2048, category: 'video' }];
    const state: Snapshot = {
      platform: 'linux', files: [], jobs: [],
      settings: {
        theme: 'light', outputFolder: '', collision: 'rename', concurrency: 2,
        quality: 85, stripMetadata: false, recursive: false, preserveStructure: false,
        namingPattern: '{name}-converted', shortcuts: { convert: 'Shift', tools: 'Alt', actions: 'Control' },
        backendPaths: {}, tray: false,
      },
      backends: { imagemagick: { available: true }, ffmpeg: { available: true } },
      capabilities: [
        { id: 'image:convert', label: 'Convert image', category: 'image', inputs: ['png','jpg','jpeg'], outputs: ['jpg', 'webp'], backend: 'rust-image', available: true, batch: true, preservesMetadata: false },
        { id: 'audio:convert', label: 'Convert audio', category: 'audio', inputs: ['wav'], outputs: ['mp3'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'subtitle:convert', label: 'Convert subtitles', category: 'subtitle', inputs: ['srt'], outputs: ['vtt'], backend: 'rust-subtitles', available: true, batch: true, preservesMetadata: false },
        ...['crop','resize','rotate','flip'].map(operation=>({id:`image:${operation}`,operation,label:operation,category:'image',inputs:['png','jpg'],outputs:['png'],backend:'rust-image',available:true,batch:true,preservesMetadata:false})),
        { id: 'image:edit-image', operation: 'edit-image', label: 'Edit photo', category: 'image', inputs: ['png'], outputs: ['png', 'jpg'], backend: 'rust-image', available: true, batch: true, preservesMetadata: false },
        { id: 'image:background', operation: 'background', label: 'Add background', category: 'image', inputs: ['png'], outputs: ['png', 'jpg'], backend: 'rust-image', available: true, batch: true, preservesMetadata: false },
        { id: 'image:compress', operation: 'compress', label: 'Compress', category: 'image', inputs: ['png'], outputs: ['png'], backend: 'rust-image', available: true, batch: true, preservesMetadata: false },
        { id: 'video:convert', operation: 'convert', label: 'Convert video', category: 'video', inputs: ['mp4'], outputs: ['mp4', 'webm'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'video:compress', operation: 'compress', label: 'Compress video', category: 'video', inputs: ['mp4'], outputs: ['mp4', 'webm'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'video:trim', operation: 'trim', label: 'Trim video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'video:split', operation: 'split', label: 'Split video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'video:merge', operation: 'merge', label: 'Merge video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'video:redact', operation: 'redact', label: 'Redact video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'video:crop-resize', operation: 'crop-resize', label: 'Crop & resize video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'video:rotate-flip', operation: 'rotate-flip', label: 'Rotate & flip video', category: 'video', inputs: ['mp4'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'video:frames-gif', operation: 'frames-gif', label: 'Frames & GIF', category: 'video', inputs: ['mp4'], outputs: ['png', 'gif'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'video:audio-output', operation: 'audio-output', label: 'Mute & extract audio', category: 'video', inputs: ['mp4'], outputs: ['mp4', 'wav'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: false },
        { id: 'audio:visualize', operation: 'visualize', label: 'Audio wave visualizer', category: 'audio', inputs: ['wav'], outputs: ['mp4'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'audio:normalize', operation: 'normalize', label: 'Normalize audio', category: 'audio', inputs: ['wav'], outputs: ['wav'], backend: 'ffmpeg', available: true, batch: true, preservesMetadata: true },
        { id: 'archive:create', operation: 'create-archive', label: 'Create archive', category: 'archive', inputs: ['*'], outputs: ['zip'], backend: 'rust-archive', available: true, batch: false, preservesMetadata: false },
        { id: 'pdf:render', operation: 'render', label: 'Render PDF pages', category: 'pdf', inputs: ['pdf'], outputs: ['png', 'jpg'], backend: 'poppler', available: true, batch: true, preservesMetadata: false, options: { page: { min: 1, max: 100000 }, dpi: { min: 36, max: 600, default: 300 } } },
        { id: 'office:convert', label: 'Unavailable office conversion', category: 'document', inputs: ['png'], outputs: ['pdf'], backend: 'libreoffice', available: false, batch: true, preservesMetadata: false },
      ],
    };
    const listeners = new Set<(update: Partial<Snapshot>) => void>();
    const wheelModeListeners = new Set<(mode: string, newDrag?: boolean) => void>();
    const globalFilesListeners = new Set<(request: { files: Snapshot['files']; mode: 'convert' | 'tools' | 'actions' }) => void>();
    const imageContextListeners = new Set<(context: ImageEditorContext) => void>();
    const videoContextListeners = new Set<(context: VideoEditorContext) => void>();
    const audioContextListeners = new Set<(context: AudioEditorContext) => void>();
    let imageContext: ImageEditorContext | null = null;
    let videoContext: VideoEditorContext | null = null;
    let audioContext: AudioEditorContext | null = null;
    const calls: MockControl['calls'] = [];
    const emit = (update: Partial<Snapshot>) => {
      Object.assign(state, structuredClone(update));
      for (const listener of listeners) listener(structuredClone(update));
    };
    const record = (method: string, value: unknown) => calls.push({ method, value: structuredClone(value) });
    const api: Bridge = {
      bootstrap: async () => structuredClone(state),
      addFiles: async () => { record('addFiles', null); return structuredClone(incoming); },
      addFolder: async () => [], inspectPaths: async () => [],
      droppedFiles: async files => { record('droppedFiles', files.map(file => file.name)); return structuredClone(files.some(file => file.name.toLowerCase().endsWith('.mp4')) ? droppedVideo : incoming); },
      enqueue: async request => {
        record('enqueue', request);
        const jobs: Job[] = request.files.map(file => ({ id: `job-${file.id}`, input: file.path, name: file.name, operation: request.operation, format: request.format, status: 'queued', progress: 0, createdAt: '2026-10-19T00:00:00Z' }));
        emit({ jobs });
        return jobs;
      },
      cancel: async id => { record('cancel', id); emit({ jobs: state.jobs.map(job => job.id === id ? { ...job, status: 'cancelled' } : job) }); },
      retry: async id => { record('retry', id); emit({ jobs: state.jobs.map(job => job.id === id ? { ...job, status: 'processing', error: undefined, progress: 10 } : job) }); },
      saveSettings: async patch => { record('saveSettings', patch); emit({ settings: { ...state.settings, ...patch } }); return structuredClone(state.settings); },
      pickOutput: async () => null, reveal: async () => undefined,
      openOutput: async () => undefined, fileAction: async () => undefined,
      finishGlobalWheel: async destination => { record('finishGlobalWheel', destination); },
      selectGlobalOperation: async request => { record('selectGlobalOperation', request); },
      handoffGlobalFiles: async request => { record('handoffGlobalFiles', request); },
      preview: async filename => {
        record('preview', filename);
        const waveform = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="120"><path d="'+Array.from({length:100},(_,i)=>{const h=Math.abs(Math.sin(i*.7))*48+8;return `M${i*8+4} ${60-h}v${h*2}`}).join(' ')+'" fill="none" stroke="#ff5a00" stroke-width="3"/></svg>')}`;
        if(/\.(mp4|mkv|webm)$/i.test(filename))return {url:'/fixtures/preview.webm',width:320,height:180,duration:4};
        if (filename.endsWith('.wav')) {
          const bytes = new Uint8Array(44 + 32000 * 2), view = new DataView(bytes.buffer);
          const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
          text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 64000, true);
          for (let index = 0; index < 32000; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(index * 440 * Math.PI * 2 / 8000) * 10000), true);
          return { url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), duration: 4, waveform };
        }
        const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e8e1c8"/><circle cx="520" cy="170" r="90" fill="#f29659"/><path d="M0 600L280 220L540 600Z" fill="#7d9271"/><path d="M220 600L610 300L800 600Z" fill="#465c43"/></svg>';
        return { url: `data:image/svg+xml,${encodeURIComponent(artwork)}`, width: 800, height: 600, duration: 4, waveform };
      },
      imagePreview: async () => ({ url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#dce7de"/><circle cx="610" cy="130" r="75" fill="#f4c67a"/><path d="M0 600L280 220L570 600Z" fill="#859b7d"/><path d="M220 600L610 300L800 600Z" fill="#526e5d"/></svg>')}`, width: 800, height: 600, sourceWidth: 800, sourceHeight: 600 }),
      applyImageTool: async request => { record('applyImageTool',request); return []; },
      imageToolContext: async () => { if (!imageContext) throw new Error('Image editor is no longer available'); return structuredClone(imageContext); },
      onImageToolContext: callback => { imageContextListeners.add(callback); return () => { imageContextListeners.delete(callback); }; },
      videoToolContext: async () => {
        if (new URLSearchParams(location.search).has('late-context')) { if (!videoContext) throw new Error('Video editor is no longer available'); return structuredClone(videoContext); }
        const merge = new URLSearchParams(location.search).get('operation') === 'merge';
        return { capability: structuredClone(state.capabilities.find(capability => capability.id === (merge ? 'video:merge' : 'video:trim'))!), files: structuredClone(merge ? mergeVideos : droppedVideo), format: 'mp4', options: { quality: '85', stripMetadata: 'false' } };
      },
      onVideoToolContext: callback => { videoContextListeners.add(callback); return () => { videoContextListeners.delete(callback); }; },
      applyVideoTool: async request => { record('applyVideoTool', request); return { queued: true }; },
      closeVideoTool: async () => { record('closeVideoTool', null); },
      openAudioTool: async request => { record('openAudioTool', request); return { opened: true }; },
      audioToolContext: async () => {
        if (new URLSearchParams(location.search).has('late-context')) { if (!audioContext) throw new Error('Audio editor is no longer available'); return structuredClone(audioContext); }
        return { capability: structuredClone(state.capabilities.find(capability => capability.id === 'audio:normalize')!), files: structuredClone(incoming.filter(file => file.category === 'audio')), format: 'wav', options: { loudness: '-16' } };
      },
      onAudioToolContext: callback => { audioContextListeners.add(callback); return () => { audioContextListeners.delete(callback); }; },
      applyAudioTool: async request => { record('applyAudioTool', request); return []; },
      closeAudioTool: async () => { record('closeAudioTool', null); },
      onWheelMode: callback => { wheelModeListeners.add(callback); return () => { wheelModeListeners.delete(callback); }; },
      onNativeDragEnter: callback => { nativeDragEnterListeners.add(callback); return ()=>{nativeDragEnterListeners.delete(callback)}; },
      onNativeDragOver: callback => { nativeDragOverListeners.add(callback); return () => { nativeDragOverListeners.delete(callback); }; },
      onNativeDrop: callback => { nativeDropListeners.add(callback); return () => { nativeDropListeners.delete(callback); }; },
      onGlobalFiles: callback => { globalFilesListeners.add(callback); return () => { globalFilesListeners.delete(callback); }; },
      onUpdate: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    };
    window.__santraTest = { state, calls, emit, emitWheelMode: (mode, newDrag) => { for (const listener of wheelModeListeners) listener(mode, newDrag); }, emitNativeDragEnter: files => { for(const listener of nativeDragEnterListeners) listener(structuredClone(files)); }, emitNativeDragOver: position => { for (const listener of nativeDragOverListeners) listener(position); }, emitNativeDrop: (files, position) => { for (const listener of nativeDropListeners) listener(files, position); }, emitGlobalFiles: (files, mode) => { for (const listener of globalFilesListeners) listener({ files, mode }); }, emitImageContext: context => { imageContext = structuredClone(context); for (const listener of imageContextListeners) listener(structuredClone(context)); }, emitVideoContext: context => { videoContext = structuredClone(context); for (const listener of videoContextListeners) listener(structuredClone(context)); }, emitAudioContext: context => { audioContext = structuredClone(context); for (const listener of audioContextListeners) listener(structuredClone(context)); } };
    Object.defineProperty(window, 'santra', { configurable: true, value: api });
  });
});

async function addFiles(page: Page) {
  await page.getByRole('button', { name: /add files/i }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Select pixel.png' })).toBeChecked();
}

async function hintNativeImage(page:Page) {
 await page.evaluate(()=>window.__santraTest.emitNativeDragEnter([{id:'image',name:'pixel.png',path:'/fixtures/pixel.png',ext:'png',category:'image',size:120}]));
 await expect(page.locator('.reference-wheel')).toHaveAttribute('data-family','image');
}

async function doubleTap(page: Page, key: 'Shift' | 'Alt' | 'Control') {
  await page.evaluate((modifier) => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    for (let tap = 0; tap < 2; tap += 1) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: modifier, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: modifier, bubbles: true }));
    }
  }, key);
}

async function tapModifier(page: Page, key: 'Shift' | 'Alt' | 'Control') {
  await page.evaluate((modifier) => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: modifier, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: modifier, bubbles: true }));
  }, key);
}

test('empty workspace renders without exceptions', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things come in new formats.' })).toBeVisible();
  await expect(page.getByText('Drop files or folders here to get started')).toBeVisible();
  await expect(page.locator('.file-row')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('empty-workspace.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('navigation keeps the white theme even with a dark system preference', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('settings-white.png') });
});

test('add files populates rows and mixed selections respect per-file routes', async ({ page }, testInfo) => {
  await page.goto('/');
  await addFiles(page);
  await expect(page.locator('.file-row')).toHaveCount(3);
  await expect(page.getByText(/Some operations may apply to only part/)).toBeVisible();
  await page.getByRole('button', { name: 'Choose an operation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose what happens next' });
  await expect(dialog.getByRole('button', { name: 'Convert image · JPG' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Convert audio · MP3' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Unavailable office/ })).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('mixed-file-picker.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^pixel\.png/ }).click();
  await expect(dialog.getByRole('button', { name: 'Convert image · WEBP' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Convert audio · MP3' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^tone\.wav/ }).click();
  await expect(dialog.getByRole('button', { name: 'Convert audio · MP3' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Convert image · JPG' })).toHaveCount(0);
});

test('double-tap Shift during a drag opens compatible operations after the mocked file boundary', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things come in new formats.' })).toBeVisible();
  const transfer = await page.evaluateHandle(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['Santra original synthetic fixture'], 'pixel.png', { type: 'image/png' }));
    return dataTransfer;
  });
  try {
    const app = page.locator('.app');
    await app.dispatchEvent('dragenter', { dataTransfer: transfer });
    await app.dispatchEvent('dragover', { dataTransfer: transfer, shiftKey: true });
    await tapModifier(page, 'Shift');
    await expect(page.getByRole('menu', { name: 'Convert', exact: true })).toHaveCount(0);
    await tapModifier(page, 'Shift');
    await expect(page.getByRole('menu', { name: 'Convert', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'droppedFiles'))).toEqual([]);
    await expect(page.locator('.file-row')).toHaveCount(0);
    await app.dispatchEvent('drop', { dataTransfer: transfer, shiftKey: true });
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await expect(page.locator('.file-row')).toHaveCount(3);
    const dialog = page.getByRole('dialog', { name: 'Choose what happens next' });
    await expect(dialog.getByRole('tab', { name: /Convert/ })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('button', { name: 'Convert image · JPG' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Convert audio · MP3' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Convert subtitles · VTT' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Unavailable office/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'droppedFiles'))).toEqual([{ method: 'droppedFiles', value: ['pixel.png'] }]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^pixel\.png/ }).click();
    await expect(dialog.getByRole('button', { name: 'Convert image · WEBP' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Convert audio · MP3' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Convert subtitles · VTT' })).toHaveCount(0);
  } finally {
    await transfer.dispose();
  }
});

test('a modifier held before a drag needs two new taps before the wheel opens', async ({ page }) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic fixture'], 'pixel.png', { type: 'image/png' }));
    return value;
  });
  try {
    const app = page.locator('.app');
    for (const [key, mode] of [['Shift', 'Convert'], ['Alt', 'Tools'], ['Control', 'File actions']] as const) {
      await page.keyboard.down(key);
      await app.dispatchEvent('dragenter', { dataTransfer: transfer });
      await page.keyboard.up(key);
      await tapModifier(page, key);
      await expect(page.locator('.drag-overlay')).toHaveCount(0);
      await tapModifier(page, key);
      await expect(page.getByRole('menu', { name: mode, exact: true })).toBeVisible();
      await app.dispatchEvent('dragleave', { dataTransfer: transfer, clientX: 0, clientY: 0 });
      await expect(page.locator('.drag-overlay')).toHaveCount(0);
    }
  } finally { await transfer.dispose(); }
});

test('citrus wheel persists after modifier release and dropping a slice queues its format', async ({ page }, testInfo) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['Synthetic JPEG fixture; inspection boundary mocked'], 'photo.jpg', { type: 'image/png' }));
    return value;
  });
  try {
    const app = page.locator('.app');
    await app.dispatchEvent('dragenter', { dataTransfer: transfer, clientX: 700, clientY: 400 });
    await app.dispatchEvent('dragover', { dataTransfer: transfer, clientX: 700, clientY: 400, shiftKey: true });
    await doubleTap(page, 'Shift');
    await app.dispatchEvent('dragover', { dataTransfer: transfer, clientX: 710, clientY: 420, shiftKey: false });
    const wheel = page.getByRole('menu', { name: 'Convert', exact: true });
    await expect(wheel).toBeVisible();
    // The workspace drag shell must not wash the app in a white blur panel;
    // only the floating wheel paints.
    expect(await page.locator('.drag-overlay').evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, blur: style.backdropFilter, border: style.borderTopWidth };
    })).toEqual({ background: 'rgba(0, 0, 0, 0)', blur: 'none', border: '0px' });
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('citrus-wheel.png') });
    const jpg = wheel.getByRole('menuitem', { name: /^JPG/ });
    await jpg.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(jpg).toHaveClass(/chosen/);
    await jpg.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'enqueue')?.value)).toMatchObject({ operation: 'convert', format: 'jpg' });
  } finally { await transfer.dispose(); }
});

test('global citrus overlay accepts and queues a drop directly on a wheel slice', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic image fixture'], 'pixel.png', { type: 'image/png' }));
    return value;
  });
  try {
    const shell = page.locator('.global-wheel-shell');
    await shell.dispatchEvent('dragenter', { dataTransfer: transfer });
    const slice = page.locator('.citrus-segments [data-wheel-item="image:convert|jpg"]');
    const accepted = await slice.evaluate((element, dataTransfer) => {
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, transfer);
    expect(accepted).toBe(true);
    await expect(slice).toHaveClass(/chosen/);
    await slice.dispatchEvent('drop', { dataTransfer: transfer });
    await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'enqueue')?.value)).toMatchObject({ operation: 'convert', format: 'jpg' });
    expect(await page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'finishGlobalWheel')?.value)).toBe('background');
    await page.evaluate(() => window.__santraTest.emitWheelMode('convert', true));
    const nextTransfer = await page.evaluateHandle(() => {
      const value = new DataTransfer();
      value.items.add(new File(['synthetic audio fixture'], 'tone.wav', { type: 'audio/wav' }));
      return value;
    });
    try {
      await shell.dispatchEvent('dragenter', { dataTransfer: nextTransfer });
      await expect(page.getByRole('menuitem', { name: /^MP3/ })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /^JPG/ })).toHaveCount(0);
    } finally { await nextTransfer.dispose(); }
  } finally { await transfer.dispose(); }
});

test('native wheel drop converts at the pointer and keeps the workspace closed', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  const slice = page.locator('.citrus-label[data-wheel-item="image:convert|jpg"]');
  await expect(slice).toBeVisible();
  const bounds = await slice.boundingBox();
  expect(bounds).not.toBeNull();
  const position = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.evaluate(point => window.__santraTest.emitNativeDragOver(point), position);
  await expect(slice).toHaveClass(/chosen/);
  await page.evaluate(point => window.__santraTest.emitNativeDrop([
    { id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' },
  ], point), position);
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'enqueue')?.value)).toMatchObject({ operation: 'convert', format: 'jpg' });
  expect(await page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'finishGlobalWheel').at(-1)?.value)).toBe('background');
  expect(await page.evaluate(() => window.__santraTest.calls.some(call => call.method === 'handoffGlobalFiles'))).toBe(false);
});

test('native drop outside a slice does not reuse a previously hovered conversion', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  const slice = page.locator('.citrus-label[data-wheel-item="image:convert|jpg"]');
  await expect(slice).toBeVisible();
  const sliceBounds = await slice.boundingBox();
  const coreBounds = await page.locator('.citrus-core').boundingBox();
  expect(sliceBounds).not.toBeNull();
  expect(coreBounds).not.toBeNull();
  const hovered = { x: sliceBounds!.x + sliceBounds!.width / 2, y: sliceBounds!.y + sliceBounds!.height / 2 };
  const dropped = { x: coreBounds!.x + coreBounds!.width / 2, y: coreBounds!.y + coreBounds!.height / 2 };
  await page.evaluate(point => window.__santraTest.emitNativeDragOver(point), hovered);
  await expect(slice).toHaveClass(/chosen/);
  await page.evaluate(point => window.__santraTest.emitNativeDrop([
    { id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' },
  ], point), dropped);
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.some(call => call.method === 'handoffGlobalFiles'))).toBe(true);
  expect(await page.evaluate(() => window.__santraTest.calls.some(call => call.method === 'enqueue'))).toBe(false);
});

test('global wheel hands off files when no slice was selected', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic image fixture'], 'pixel.png', { type: 'image/png' }));
    return value;
  });
  try {
    await page.locator('.global-wheel-shell').dispatchEvent('drop', { dataTransfer: transfer });
    await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'handoffGlobalFiles')?.value)).toMatchObject({ mode: 'convert' });
    expect(await page.evaluate(() => (window.__santraTest.calls.find(call => call.method === 'handoffGlobalFiles')?.value as { files: Snapshot['files'] }).files.map(file => file.path))).toContain('/fixtures/pixel.png');
  } finally { await transfer.dispose(); }
});

test('global wheel keeps files available when a selected route fails', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  await page.evaluate(() => { window.santra!.enqueue = async () => { throw new Error('Local encoder unavailable'); }; });
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic image fixture'], 'pixel.png', { type: 'image/png' }));
    return value;
  });
  try {
    const slice = page.locator('.citrus-segments [data-wheel-item="image:convert|jpg"]');
    await slice.dispatchEvent('drop', { dataTransfer: transfer });
    await expect.poll(() => page.evaluate(() => (window.__santraTest.calls.find(call => call.method === 'handoffGlobalFiles')?.value as { notice?: string })?.notice)).toContain('Local encoder unavailable');
  } finally { await transfer.dispose(); }
});

test('workspace receives files from the global wheel with its selected mode', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__santraTest.emitGlobalFiles([{ id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' }], 'tools'));
  await expect(page.getByRole('checkbox', { name: 'Select pixel.png' })).toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Choose what happens next' }).getByRole('tab', { name: /^Tools/ })).toHaveAttribute('aria-selected', 'true');
});

test('global image tools wheel shows image tools and hides generic archive creation', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=tools');
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic image fixture'], 'pixel.png', { type: 'image/png' }));
    return value;
  });
  try {
    const shell = page.locator('.global-wheel-shell');
    await shell.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(page.getByRole('menuitem', { name: /^Edit photo/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Add background/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Create archive/ })).toHaveCount(0);
    await expect(shell.locator('.citrus-core .image-wheel-thumbnail')).toBeVisible();
    await expect(shell.locator('.citrus-core .santra-mark')).toHaveCount(0);
    await expect(shell.getByText('Drop on a slice')).toHaveCount(0);
    await expect(shell.locator('.wheel-description')).toHaveCount(0);
  } finally { await transfer.dispose(); }
});

test('global wheel overlay paints only the ring, never a card or blur', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=convert');
  const paint = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        blur: style.backdropFilter,
        shadow: style.boxShadow,
        border: style.borderTopWidth,
      };
    };
    return { body: read('body'), shell: read('.global-wheel-shell'), card: read('.global-wheel-card') };
  });
  const flat = { background: 'rgba(0, 0, 0, 0)', image: 'none', blur: 'none', shadow: 'none', border: '0px' };
  expect(paint.body).toEqual(flat);
  expect(paint.shell).toEqual(flat);
  expect(paint.card).toEqual(flat);
});

test('global video tools wheel shows supported video operations and dispatches the selected tool', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=tools');
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['synthetic video fixture'], 'clip.mp4', { type: 'video/mp4' }));
    return value;
  });
  try {
    const shell = page.locator('.global-wheel-shell');
    await shell.dispatchEvent('dragenter', { dataTransfer: transfer });
    const wheel = page.getByRole('menu', { name: 'Tools', exact: true });
    await expect(wheel.getByRole('menuitem', { name: /^Compress/ })).toBeVisible();
    const trim = wheel.getByRole('menuitem', { name: /^Trim/ });
    await expect(trim.locator('svg')).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Redact/ })).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Crop & resize/ })).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Rotate & flip/ })).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Frames & GIF/ })).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Mute & extract audio/ })).toBeVisible();
    await expect(wheel.getByRole('menuitem', { name: /^Snapshot/ })).toHaveCount(0);
    await expect(wheel.getByRole('menuitem', { name: /^Extract audio/ })).toHaveCount(0);
    await expect(wheel.getByRole('menuitem', { name: /^Edit photo/ })).toHaveCount(0);
    await expect(wheel.getByRole('menuitem', { name: /^Merge/ })).toHaveCount(0);
    await trim.dispatchEvent('dragenter', { dataTransfer: transfer });
    await trim.dispatchEvent('drop', { dataTransfer: transfer });
    await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'selectGlobalOperation')?.value)).toMatchObject({ capabilityId: 'video:trim', format: 'mp4' });
  } finally { await transfer.dispose(); }
});

test('compact video editor provides exact trim values and submits a non-destructive queue recipe', async ({ page }, testInfo) => {
  await page.goto('/?santra-video-tool=1');
  const editor = page.getByRole('dialog', { name: 'Trim video' });
  await expect(editor).toBeVisible();
  await expect(editor.locator('.modal-header')).toContainText('clip.mp4');
  await expect(editor.getByRole('slider', { name: 'Video preview timeline' })).toBeVisible();
  await editor.getByRole('button', {name:'Set start to playhead',exact:true}).click();
  expect(await page.evaluate(()=>window.__santraTest.calls.filter(call=>call.method==='applyVideoTool'))).toHaveLength(0);
  await editor.getByLabel('Start time (seconds)').fill('0.5');
  await editor.getByLabel('End time (seconds)').fill('2.5');
  await expect(editor.getByRole('button', {name:'Cancel', exact:true})).toHaveCount(1);
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('02-video-trim.png')});
  await editor.getByRole('button', { name: 'Save new copy' }).click();
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'applyVideoTool')?.value)).toMatchObject({
    format: 'mp4', files: ['/fixtures/clip.mp4'], options: { start: 0.5, duration: 2 },
  });
});

test('preloaded image editor opens and refreshes its context on each tool launch', async ({ page }) => {
  await page.goto('/?santra-image-tool=1');
  await expect(page.getByText('Preparing local image preview…')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.__santraTest.emitImageContext({
    id: 'first', capability: window.__santraTest.state.capabilities.find(item => item.id === 'image:edit-image')!,
    files: [{ id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' }], format: 'png', options: {},
  }));
  await expect(page.getByRole('dialog', { name: 'Edit photo' })).toBeVisible();
  await page.evaluate(() => window.__santraTest.emitImageContext({
    id: 'second', capability: window.__santraTest.state.capabilities.find(item => item.id === 'image:background')!,
    files: [{ id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' }], format: 'png', options: { padding: '32' },
  }));
  await expect(page.getByRole('dialog', { name: 'Add background' })).toBeVisible();
});

test('preloaded video editor recovers when its context arrives after startup', async ({ page }) => {
  await page.goto('/?santra-video-tool=1&late-context=1');
  await expect(page.getByText('Preparing local video preview…')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.__santraTest.emitVideoContext({
    id: 'late', capability: window.__santraTest.state.capabilities.find(item => item.id === 'video:trim')!,
    files: [{ id: 'video', path: '/fixtures/clip.mp4', name: 'clip.mp4', ext: 'mp4', size: 4096, category: 'video' }], format: 'mp4', options: {},
  }));
  await expect(page.getByRole('dialog', { name: 'Trim video' })).toBeVisible();
});

test('video merge editor sends the selected clip order to the local job queue', async ({ page }) => {
  await page.goto('/?santra-video-tool=1&operation=merge');
  const editor = page.getByRole('dialog', { name: 'Join videos' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Move clip.mp4 down' }).click();
  await editor.getByRole('button', { name: 'Save new copy' }).click();
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'applyVideoTool')?.value)).toMatchObject({
    format: 'mp4', files: ['/fixtures/clip-2.mp4', '/fixtures/clip.mp4'], options: { reencode: true },
  });
});

test('unknown native drags do not assume image routes', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=tools');
  await expect(page.getByRole('menuitem', { name: /^Edit photo/ })).toHaveCount(0);
  await expect(page.getByText('Detecting file type',{exact:true})).toBeVisible();
  await expect(page.locator('.wheel-description')).toHaveCount(0);
  await expect(page.getByText('Drop on a slice')).toHaveCount(0);
});

test('file actions wheel hides the unavailable native share route', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=actions');
  await expect(page.getByRole('menuitem', { name: /^Copy Path/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Share/ })).toHaveCount(0);
});

test('Ctrl wheel cancellation stays in the background', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=actions');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'finishGlobalWheel').at(-1)?.value)).toBe('background');
});

test('Ctrl file actions finish without surfacing the workspace', async ({ page }) => {
  await page.goto('/?santra-wheel=1&mode=actions');
  await hintNativeImage(page);
  const copy = page.getByRole('menuitem', { name: 'Copy · Local file action' });
  const bounds = await copy.boundingBox();
  expect(bounds).not.toBeNull();
  await page.evaluate(point => window.__santraTest.emitNativeDrop([{ id: 'image', path: '/fixtures/pixel.png', name: 'pixel.png', ext: 'png', size: 120, category: 'image' }], point), { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 });
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'finishGlobalWheel').at(-1)?.value)).toBe('background');
});

test('keyboard wheel switches groups and highlights partial selection coverage', async ({ page }) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name: 'Choose an operation' }).click();
  await doubleTap(page, 'Alt');
  await expect(page.getByRole('tab', { name: /^Tools/ })).toHaveAttribute('aria-selected', 'true');
  const edit = page.getByRole('menuitem', { name: /^Edit photo/ });
  await expect(edit).toHaveAttribute('aria-label', /1 of 3 files/);
  await edit.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: /^Add background/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('single modifier presses leave the action picker unchanged; Ctrl double tap selects actions', async ({ page }) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name: 'Choose an operation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose what happens next' });
  for (const key of ['Shift', 'Alt', 'Control'] as const) {
    await page.keyboard.press(key);
    await expect(dialog.getByRole('tab', { name: /^Convert/ })).toHaveAttribute('aria-selected', 'true');
  }
  await doubleTap(page, 'Control');
  await expect(dialog.getByRole('tab', { name: /^File actions/ })).toHaveAttribute('aria-selected', 'true');
});

test('image editor exposes a real padded background canvas and directional zoom navigation', async ({ page }, testInfo) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name: 'Choose an operation' }).click();
  await doubleTap(page, 'Alt');
  await page.getByRole('menuitem', { name: /^Add background/ }).click();
  const backgroundEditor = page.getByRole('dialog', { name: 'Add background' });
  await backgroundEditor.getByRole('combobox', { name: /Background.*Single colour/ }).click();
  await backgroundEditor.getByRole('option', { name: 'Custom' }).click();
  await expect(backgroundEditor.getByLabel('Canvas width')).toHaveValue('864');
  await expect(backgroundEditor.getByLabel('Canvas height')).toHaveValue('664');
  await expect(backgroundEditor.getByLabel('Padding')).toHaveValue('32');
  const color = backgroundEditor.getByRole('button', { name: 'Choose #ff5a00 background' });
  await color.click();
  await expect(color).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('01-image-background.png')});
  await backgroundEditor.getByRole('button', { name: 'Close editor' }).click();

  await page.getByRole('button', { name: 'Choose an operation' }).click();
  await doubleTap(page, 'Alt');
  await page.getByRole('menuitem', { name: /^Edit photo/ }).click();
  const photoEditor = page.getByRole('dialog', { name: 'Edit photo' });
  await photoEditor.getByRole('button', { name: 'Zoom & pan' }).click();
  await expect(photoEditor.getByRole('button', { name: 'Move image up' })).toBeEnabled();
  await photoEditor.getByRole('button', { name: 'Move image up' }).click();
  await expect(photoEditor.locator('.image-tool-preview')).toHaveAttribute('style', /--image-pan-y: -48px/);
  await photoEditor.getByRole('button', { name: 'Move image down' }).click();
  await expect(photoEditor.locator('.image-tool-preview')).toHaveAttribute('style', /--image-pan-y: 0px/);
  await photoEditor.getByRole('button', { name: 'Move image left' }).click();
  await expect(photoEditor.locator('.image-tool-preview')).toHaveAttribute('style', /--image-pan-x: -48px/);
  await photoEditor.getByRole('button', { name: 'Move image right' }).click();
  await expect(photoEditor.locator('.image-tool-preview')).toHaveAttribute('style', /--image-pan-x: 0px/);
  await photoEditor.getByRole('button', { name: 'Zoom in' }).click();
  await photoEditor.getByRole('button', { name: 'Move image left' }).click();
  await expect(photoEditor.locator('.image-tool-preview')).toHaveAttribute('style', /--image-pan-x: -48px/);
  await expect(photoEditor.getByRole('button', { name: 'Move image up' })).toBeEnabled();
});

test('PDF workspace labels the source preview and exports the selected page settings', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things come in new formats.' })).toBeVisible();
  await page.evaluate(() => window.__santraTest.emit({ files: [{ id: 'pdf', path: '/fixtures/original.pdf', name: 'original.pdf', size: 100, ext: 'pdf', category: 'pdf' }] }));
  await page.getByRole('button', { name: /^original\.pdf/ }).click();
  await page.getByRole('button', { name: 'Render PDF pages · PNG' }).click();
  const workspace = page.getByRole('dialog', { name: 'Render a page' });
  await expect(workspace.getByRole('heading', { name: 'First page preview' })).toBeVisible();
  await expect(workspace.getByRole('img')).toBeVisible();
  await workspace.getByLabel('Page to render', { exact: true }).fill('2');
  await workspace.getByLabel('Resolution (DPI)', { exact: true }).fill('144');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('pdf-workspace.png') });
  await workspace.getByRole('button', { name: 'Render page', exact: true }).click();
  expect(await page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'enqueue')?.value)).toMatchObject({ operation: 'render', format: 'png', options: { page: '2', dpi: '144' } });
  await expect(workspace).toHaveCount(0);
});

test('keyboard picker supports arrows, Escape, and Ctrl K search', async ({ page }) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name: 'Choose an operation' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const first = dialog.getByRole('button', { name: 'Convert image · JPG' });
  const second = dialog.getByRole('button', { name: 'Convert image · WEBP' });
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('textbox', { name: 'Find a format or tool…' });
  await expect(search).toBeFocused();
  await search.fill('subtitle');
  await expect(page.locator('.family-card')).toHaveCount(1);
});

test('submission, cancellation, failure, and retry follow mock events', async ({ page }) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name: /^captions\.srt/ }).click();
  await page.getByRole('button', { name: 'Convert subtitles · VTT' }).click();
  await page.getByRole('dialog', { name: 'Convert subtitles', exact: true }).getByRole('button', { name: 'Save new copy' }).click();
  await expect(page.locator('.job-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'enqueue')?.value)).toMatchObject({ operation: 'convert', format: 'vtt', files: [{ id: 'subtitle' }], options: { quality: 85, collision: 'rename' } });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.job-status')).toHaveText('cancelled');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => window.__santraTest.emit({ jobs: window.__santraTest.state.jobs.map(job => ({ ...job, status: 'failed', error: 'Synthetic processor failure' })) }));
  await expect(page.getByRole('alert')).toHaveText('Synthetic processor failure');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  await page.evaluate(() => window.__santraTest.emit({ jobs: window.__santraTest.state.jobs.map(job => ({ ...job, status: 'completed', progress: 100, output: '/fixtures/captions.vtt' })) }));
  await expect(page.getByRole('button', { name: 'Open converted file' })).toBeVisible();
  expect(await page.evaluate(() => window.__santraTest.calls.filter(call => ['cancel', 'retry'].includes(call.method)))).toEqual([{ method: 'cancel', value: 'job-subtitle' }, { method: 'retry', value: 'job-subtitle' }]);
});

test('preview navigation makes no external network requests', async ({ page, baseURL }) => {
  await page.addInitScript(() => { delete window.santra; });
  const external: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) { external.push(url.href); await route.abort(); }
    else await route.continue();
  });
  page.on('websocket', socket => external.push(socket.url()));
  await page.goto('/');
  await page.getByRole('button', { name: 'Format library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A world of possibilities.' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('audio tools open their own editor window and queue only compatible files', async ({ page }) => {
  await page.goto('/');
  await addFiles(page);
  await page.getByRole('button', { name:'Choose an operation' }).click();
  await page.getByRole('tab', { name:/^Tools/ }).click();
  await page.getByRole('button', { name:/^Normalize audio/ }).click();
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'openAudioTool')?.value)).toMatchObject({
    capabilityId: 'audio:normalize', files: ['/fixtures/tone.wav'], format: 'wav',
  });
  await expect(page.getByRole('dialog', { name:'Normalize audio', exact:true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__santraTest.calls.filter(call => call.method === 'enqueue'))).toHaveLength(0);
});

test('audio editor window renders the waveform and sends the saved recipe', async ({ page }, testInfo) => {
  await page.goto('/?santra-audio-tool=1');
  const editor = page.getByRole('dialog', { name:'Normalize audio', exact:true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('img', { name:/Waveform/ })).toBeVisible();
  await editor.getByRole('spinbutton', { name:'Target loudness (LUFS)' }).fill('-18');
  await expect(editor.getByRole('spinbutton', { name:'True peak (dBTP)' })).toHaveValue('-1.5');
  await page.screenshot({ animations: 'disabled', path:testInfo.outputPath('03-audio-normalize.png') });
  await editor.getByRole('button', { name:'Save new copy' }).click();
  await expect.poll(() => page.evaluate(() => window.__santraTest.calls.find(call => call.method === 'applyAudioTool')?.value)).toMatchObject({
    format: 'wav', options: { loudness: '-18' },
  });
});

test('document conversion review preserves its warning and recovers from a queue error', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(()=>{
    const file:Snapshot['files'][number]={id:'doc',name:'notes.md',path:'/fixtures/notes.md',ext:'md',size:123,category:'document'};
    window.__santraTest.emit({capabilities:[...window.__santraTest.state.capabilities,{id:'document:convert',operation:'convert',label:'Convert document',category:'document',inputs:['md'],outputs:['html'],backend:'pandoc',available:true,batch:true,preservesMetadata:false}]});
    window.__santraTest.emitGlobalFiles([file],'convert');
  });
  await page.getByRole('button',{name:/^Convert document · HTML/}).click();
  const editor=page.getByRole('dialog',{name:'Convert document',exact:true});
  await expect(editor.getByText(/Complex tables, fonts/)).toBeVisible();
  await page.screenshot({ animations: 'disabled',path:testInfo.outputPath('06-document-conversion.png')});
  await page.evaluate(()=>{window.santra!.enqueue=async()=>{throw new Error('Output folder is read-only')};});
  await editor.getByRole('button',{name:'Save new copy'}).click();
  await expect(editor.getByRole('alert')).toHaveText('Output folder is read-only');
  await expect(editor.getByRole('button',{name:'Save new copy'})).toBeEnabled();
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(editor).toHaveCount(0);
});

test('image wheel matches the white Penpot geometry and uses one orange selection', async ({ page }, testInfo) => {
  await page.setViewportSize({width:520,height:620});
  await page.goto('/?santra-wheel=1&mode=convert');
  await hintNativeImage(page);
  const wheel=page.locator('.image-wheel');
  await expect(wheel).toBeVisible();
  await expect(page.locator('.global-wheel-card')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.getByRole('heading',{name:'Shift — Convert'})).toHaveCount(0);
  await page.getByRole('menuitem',{name:/^JPG/}).hover();
  await expect(wheel.locator('.citrus-segments path.chosen')).toHaveCSS('fill','rgb(255, 90, 0)');
  await expect(wheel.locator('.citrus-core')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(wheel.locator('.image-wheel-selection')).toHaveText('JPG');
  await expect(wheel.locator('.santra-mark')).toHaveCount(0);
  await expect(wheel.locator('.citrus-segments path').first()).toHaveAttribute('d',/Q /);
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('image-convert-penpot.png')});
  await page.evaluate(()=>window.__santraTest.emitWheelMode('tools'));
  await expect(page.getByRole('heading',{name:'Alt — Tools'})).toHaveCount(0);
  await page.getByRole('menuitem',{name:/^Crop/}).hover();
  await expect(wheel.locator('.image-wheel-selection')).toHaveText('Crop');
  await expect(page.getByRole('menuitem',{name:/^Crop/}).locator('svg')).toBeVisible();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('image-tools-penpot.png')});
  await page.evaluate(()=>window.__santraTest.emitWheelMode('actions'));
  await expect(page.getByRole('heading',{name:'Ctrl — File actions'})).toHaveCount(0);
  await page.getByRole('menuitem',{name:/^Copy ·/}).hover();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('image-actions-penpot.png')});
});

test('image crop editor fits the 800 by 560 Penpot layout and queues its crop recipe', async ({page},testInfo)=>{
  await page.setViewportSize({width:824,height:584});
  await page.goto('/?santra-image-tool=1');
  await page.evaluate(()=>window.__santraTest.emitImageContext({id:'crop-test',capability:{id:'image:crop',operation:'crop',label:'Crop',category:'image',inputs:['png'],outputs:['png'],backend:'rust-image',available:true,batch:true,preservesMetadata:false},files:[{id:'image',name:'alpine.png',path:'/fixtures/alpine.png',size:4800000,ext:'png',category:'image'}],format:'png',options:{}}));
  const editor=page.getByRole('dialog',{name:'Crop',exact:true});
  await expect(editor.locator('.image-tool-preview')).toBeVisible();
  const bounds=await editor.boundingBox();
  expect(bounds?.width).toBe(800);
  expect(bounds?.height).toBe(560);
  await editor.getByRole('button',{name:'16:9',exact:true}).click();
  await expect(editor.locator('.image-tool-notice')).toHaveCount(0);
  await expect(editor.getByRole('button',{name:'Save new copy'})).toBeInViewport();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('image-crop-penpot.png')});
  await editor.getByRole('button',{name:'Save new copy'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__santraTest.calls.find(c=>c.method==='applyImageTool')?.value)).toMatchObject({options:{width:'800',height:'450',x:'0',y:'75'}});
});

test('supported image editors retain the compact reference layout',async({page},testInfo)=>{
  await page.setViewportSize({width:824,height:584});
  await page.goto('/?santra-image-tool=1');
 for(const [operation,title] of [['compress','Compress'],['resize','Resize'],['rotate','Rotate & flip'],['background','Add background'],['edit-image','Edit photo'],['metadata','Edit metadata']] as const) {
    await page.evaluate(({operation,title})=>window.__santraTest.emitImageContext({id:operation,capability:{id:`image:${operation}`,operation,label:title,category:'image',inputs:[operation==='metadata'?'jpg':'png'],outputs:[operation==='metadata'?'jpg':'png'],backend:operation==='metadata'?'exiftool':'rust-image',available:true,batch:true,preservesMetadata:operation==='metadata'},files:[{id:'image',name:operation==='metadata'?'alpine.jpg':'alpine.png',path:'/fixtures/alpine.png',size:4800000,ext:operation==='metadata'?'jpg':'png',category:'image'}],format:operation==='metadata'?'jpg':'png',options:{}}),{operation,title});
    const editor=page.getByRole('dialog',{name:title,exact:true});
    await expect(editor.locator('.image-tool-preview')).toBeVisible();
    await expect(editor.getByRole('button',{name:'Save new copy'})).toBeInViewport();
    await expect(editor.getByRole('button',{name:'Fit image'})).toBeVisible();
    await editor.screenshot({animations:'disabled',path:testInfo.outputPath(`image-${operation}-penpot.png`)});
    if(operation==='resize') {
      await editor.getByRole('spinbutton',{name:'Width (px)'}).fill('400');
      await expect(editor.getByRole('spinbutton',{name:'Height (px)'})).toHaveValue('300');
    }
    if(operation==='rotate') {
      await editor.getByRole('checkbox',{name:'Flip horizontal'}).check();
      await expect(editor.getByRole('checkbox',{name:'Flip horizontal'})).toBeChecked();
    }
    await editor.getByRole('button',{name:'Close editor'}).click();
  }
});

test('native MKV drag switches from unknown to video before the drop',async({page},testInfo)=>{
 await page.setViewportSize({width:520,height:620});
 await page.goto('/?santra-wheel=1&mode=tools');
 await expect(page.getByText('Detecting file type',{exact:true})).toBeVisible();
 await page.evaluate(()=>{
   const capabilities=window.__santraTest.state.capabilities.map(cap=>cap.category==='video'?{...cap,inputs:[...cap.inputs,'mkv']}:cap);
   window.__santraTest.emit({capabilities});
   window.__santraTest.emitNativeDragEnter([{id:'mkv',path:'/fixtures/sample.MKV',name:'sample.MKV',ext:'mkv',category:'video',size:1000}]);
 });
 const wheel=page.locator('.reference-wheel');
 await expect(wheel).toHaveAttribute('data-family','video');
 await expect(page.getByRole('menuitem',{name:/^Trim/})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:/^Edit photo/})).toHaveCount(0);
 await page.getByRole('menuitem',{name:/^Trim/}).hover();
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('02-mkv-tools.png')});
 const box=await page.getByRole('menuitem',{name:/^Trim/}).boundingBox();
 await page.evaluate(position=>window.__santraTest.emitNativeDrop([{id:'mkv',path:'/fixtures/sample.MKV',name:'sample.MKV',ext:'mkv',category:'video',size:1000}],position),{x:box!.x+box!.width/2,y:box!.y+box!.height/2});
 await expect.poll(()=>page.evaluate(()=>window.__santraTest.calls.find(c=>c.method==='selectGlobalOperation')?.value)).toMatchObject({capabilityId:'video:trim',files:[{ext:'mkv',category:'video'}]});
});

test('every remaining Penpot family has the correct wheels and honest empty states',async({page},testInfo)=>{
 await page.setViewportSize({width:520,height:620});
 await page.goto('/?santra-wheel=1&mode=tools');
 await expect(page.getByText('Detecting file type',{exact:true})).toBeVisible();
 const cases=[
  ['02','video','mkv','convert','trim','mp4',true],['03','audio','wav','convert','normalize','flac',true],['04','pdf','pdf','render','pdf-extract','png',true],['05','archive','zip','create-archive','extract','tar',true],['06','document','docx','convert','','md',true],['07','epub','epub','convert','','docx',true],['08','presentation','pptx','convert','','pdf',false],['09','spreadsheet','xlsx','convert','','csv',false],['10','subtitle','srt','convert','','vtt',true],
 ] as const;
 for(const [frame,family,ext,conversion,tool,output,available] of cases){
  await page.evaluate(({family,ext,conversion,tool,output,available})=>{
   const category=(family==='epub'?'document':family) as Snapshot['files'][number]['category'];
   const base={category,inputs:[ext],outputs:[output],backend:'verified-test-boundary',available,batch:true,preservesMetadata:false};
   window.__santraTest.emit({capabilities:[{...base,id:`${category}:${conversion}`,operation:conversion,label:`Convert ${family}`},...(tool?[{...base,id:`${category}:${tool}`,operation:tool,label:tool}]:[])]});
   window.__santraTest.emitNativeDragEnter([{id:family,path:`/fixtures/sample.${ext}`,name:`sample.${ext}`,ext,size:1000,category}]);
  },{family,ext,conversion,tool,output,available});
  await expect(page.locator('.reference-wheel')).toHaveAttribute('data-family',family);
  for(const mode of ['convert','tools','actions'] as const){
   await page.evaluate(mode=>window.__santraTest.emitWheelMode(mode),mode);
   if(mode==='actions')await expect(page.getByRole('menuitem',{name:/^Copy ·/})).toBeVisible();
   else if(mode==='tools'&&!tool)await expect(page.getByText('No tools available for this file',{exact:true})).toBeVisible();
   else if(mode==='convert'&&!available)await expect(page.getByText('Conversion is not enabled',{exact:true})).toBeVisible();
   else await expect(page.getByRole('menuitem').first()).toBeVisible();
   if(mode==='actions'||(mode==='convert'&&available)||(mode==='tools'&&tool))await expect(page.getByRole('menu',{name:mode==='actions'?'File actions':mode==='tools'?'Tools':'Convert',exact:true})).toBeVisible();
   const first=page.getByRole('menuitem').first();if(await first.count()){await first.focus();await expect(first).toHaveClass(/chosen/);}
   await page.screenshot({animations:'disabled',path:testInfo.outputPath(`${frame}-${family}-${mode}.png`)});
  }
 }
});

test('MKV filename hints work with generic MIME and replace a previous image drag',async({page})=>{
 await page.goto('/?santra-wheel=1&mode=tools');
 await hintNativeImage(page);
 await expect(page.getByRole('menuitem',{name:/^Edit photo/})).toBeVisible();
 await page.evaluate(()=>{window.__santraTest.emit({capabilities:window.__santraTest.state.capabilities.map(cap=>cap.category==='video'?{...cap,inputs:['mkv']}:cap)});window.__santraTest.emitWheelMode('tools',true)});
 await expect(page.getByText('Detecting file type',{exact:true})).toBeVisible();
 const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['bounded fixture boundary'],'SAMPLE.MKV',{type:'application/octet-stream'}));return data});
 try {await page.locator('.global-wheel-shell').dispatchEvent('dragenter',{dataTransfer:transfer});await expect(page.locator('.reference-wheel')).toHaveAttribute('data-family','video');await expect(page.getByRole('menuitem',{name:/^Trim/})).toBeVisible();await expect(page.getByRole('menuitem',{name:/^Edit photo/})).toHaveCount(0)}finally{await transfer.dispose()}
});

test('remaining video editors fit the reference surface with playable local previews',async({page},testInfo)=>{
 await page.setViewportSize({width:824,height:584});
 await page.goto('/?santra-video-tool=1');
 for(const operation of ['compress','trim','split','merge','crop-resize','rotate-flip','speed','frames-gif','audio-output','redact','strip-metadata']){
  const format=operation==='frames-gif'?'png':'mp4';
  const outputs=operation==='frames-gif'?['png','gif']:operation==='audio-output'?['mp4','wav']:['mp4'];
  await page.evaluate(({operation,format,outputs})=>{
    const file:Snapshot['files'][number]={id:'video',name:'clip.mp4',path:'/fixtures/clip.mp4',size:4000,ext:'mp4',category:'video'};
    window.__santraTest.emitVideoContext({id:operation,capability:{id:`video:${operation}`,operation,label:operation,category:'video',inputs:['mp4'],outputs,backend:'ffmpeg',available:true,batch:operation!=='merge',preservesMetadata:true},files:operation==='merge'?[file,{...file,id:'video-2',name:'clip-2.mp4',path:'/fixtures/clip-2.mp4'}]:[file],format,options:{start:'0',end:'3',quality:'75'}});
  },{operation,format,outputs});
  const editor=page.getByRole('dialog');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button',{name:'Save new copy'})).toBeInViewport();
  await expect.poll(()=>editor.locator('video').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(2);
  const box=await editor.boundingBox();expect(box!.width).toBe(800);expect(box!.height).toBe(560);
  await editor.screenshot({animations:'disabled',path:testInfo.outputPath(`02-video-${operation}.png`)});
 }
});

test('archive, EPUB and subtitle reviews use the compact reference shell',async({page},testInfo)=>{
 await page.setViewportSize({width:900,height:700});
 await page.goto('/');
 const cases=[['05','archive','zip','extract','directory'],['05','archive','zip','create-archive','tar'],['06','document','docx','convert','md'],['07','document','epub','convert','docx'],['10','subtitle','srt','convert','vtt']] as const;
 for(const [frame,category,ext,operation,format] of cases){
  const label=`${operation} ${ext}`;
  await page.evaluate(({category,ext,operation,format,label})=>{
   window.__santraTest.emit({capabilities:[{id:`${category}:${operation}`,operation,label,category,inputs:[ext],outputs:[format],backend:'verified-fixture',available:true,batch:true,preservesMetadata:false}]});
   window.__santraTest.emitGlobalFiles([{id:ext,path:`/fixtures/sample.${ext}`,name:`sample.${ext}`,ext,category,size:2000}],operation==='convert'?'convert':'tools');
  },{category,ext,operation,format,label});
  await page.getByRole('button',{name:operation==='convert'?`${label} · ${format.toUpperCase()}`:new RegExp(`^${label}`)}).click();
  const editor=page.getByRole('dialog',{name:label,exact:true});
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button',{name:'Save new copy'})).toBeInViewport();
  const box=await editor.boundingBox();expect(box!.width).toBe(800);expect(box!.height).toBe(560);
  await editor.screenshot({animations:'disabled',path:testInfo.outputPath(`${frame}-${ext}-${operation}.png`)});
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 }
});

test('audio editor windows cover every supported audio operation',async({page},testInfo)=>{
 await page.setViewportSize({width:900,height:700});
 await page.goto('/?santra-audio-tool=1&late-context=1');
 await expect(page.getByText('Preparing local audio preview…')).toBeVisible();
 const cases=[['normalize','wav'],['trim','wav'],['channels','wav'],['visualize','mp4'],['compress','mp3'],['strip-metadata','wav']] as const;
 for(const [operation,format] of cases){
  const label=`${operation} wav`;
  await page.evaluate(({operation,format,label})=>{
   window.__santraTest.emitAudioContext({
    id:operation,
    capability:{id:`audio:${operation}`,operation,label,category:'audio',inputs:['wav'],outputs:[format],backend:'ffmpeg',available:true,batch:true,preservesMetadata:false},
    files:[{id:'audio',path:'/fixtures/tone.wav',name:'tone.wav',ext:'wav',size:2048,category:'audio'}],
    format,options:{},
   });
  },{operation,format,label});
  const editor=page.getByRole('dialog',{name:label,exact:true});
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button',{name:'Save new copy'})).toBeInViewport();
  await expect(editor.getByRole('img',{name:/Waveform/})).toBeVisible();
  const box=await editor.boundingBox();expect(box!.width).toBeLessThanOrEqual(900);expect(box!.height).toBeLessThanOrEqual(700);
  await editor.screenshot({animations:'disabled',path:testInfo.outputPath(`03-audio-${operation}.png`)});
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 }
});

test('archive destination and collision choices affect only the submitted local job',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>{
  window.santra!.pickOutput=async()=>'/fixtures/output';
  window.__santraTest.emit({capabilities:[{id:'archive:extract',operation:'extract',label:'Extract archive',category:'archive',inputs:['zip'],outputs:['directory'],backend:'rust-archive',available:true,batch:true,preservesMetadata:false}]});
  window.__santraTest.emitGlobalFiles([{id:'archive',path:'/fixtures/sample.zip',name:'sample.zip',ext:'zip',category:'archive',size:1000}],'tools');
 });
 await page.getByRole('button',{name:/^Extract archive/}).click();
 const editor=page.getByRole('dialog',{name:'Extract archive',exact:true});
 await editor.getByLabel('If output exists').selectOption('skip');
 await editor.getByRole('button',{name:'Change',exact:true}).click();
 await expect(editor.getByRole('textbox',{name:'Archive destination'})).toHaveValue('/fixtures/output');
 expect(await page.evaluate(()=>window.__santraTest.calls.filter(c=>c.method==='enqueue'))).toHaveLength(0);
 await editor.getByRole('button',{name:'Save new copy'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__santraTest.calls.find(c=>c.method==='enqueue')?.value)).toMatchObject({operation:'extract',format:'directory',options:{outputFolder:'/fixtures/output',collision:'skip'}});
 expect(await page.evaluate(()=>window.__santraTest.state.settings.collision)).toBe('rename');
 expect(await page.evaluate(()=>window.__santraTest.state.settings.outputFolder)).toBe('');
});

test('workspace wheel opens with its ring centered at the drag cursor and stays still while choosing',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/');
 const data=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['fixture'],'pixel.png',{type:'image/png'}));return data});
 try {
  const app=page.locator('.app');
  await app.dispatchEvent('dragenter',{dataTransfer:data,clientX:800,clientY:480});
  await app.dispatchEvent('dragover',{dataTransfer:data,clientX:800,clientY:480});
  await doubleTap(page,'Shift');
  const ring=page.locator('.floating-wheel .citrus-rind');
  await expect(ring).toBeVisible();
  const bounds=await ring.boundingBox();
  expect(bounds!.x+bounds!.width/2).toBeCloseTo(800,0);
  expect(bounds!.y+bounds!.height/2).toBeCloseTo(480,0);
  await app.dispatchEvent('dragover',{dataTransfer:data,clientX:900,clientY:520});
  expect(await ring.boundingBox()).toEqual(bounds);
  await page.keyboard.press('Escape');
  await app.dispatchEvent('dragenter',{dataTransfer:data,clientX:1435,clientY:995});
  await app.dispatchEvent('dragover',{dataTransfer:data,clientX:1435,clientY:995});
  await doubleTap(page,'Alt');
  const panel=await page.locator('.floating-wheel').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x+panel!.width).toBeLessThanOrEqual(1440);
  expect(panel!.y+panel!.height).toBeLessThanOrEqual(1000);
 }finally{await data.dispose()}
});

test('native host ring shares the window center in all modes and after file detection',async({page})=>{
 await page.setViewportSize({width:520,height:620});
 await page.goto('/?santra-wheel=1&mode=tools');
 await expect(page.getByText('Detecting file type',{exact:true})).toBeVisible();
 let box=await page.locator('.reference-wheel-empty').boundingBox();
 expect(box!.x+box!.width/2).toBeCloseTo(260,0);expect(box!.y+box!.height/2).toBeCloseTo(310,0);
 await hintNativeImage(page);
 for(const mode of ['convert','tools','actions'] as const){
  await page.evaluate(mode=>window.__santraTest.emitWheelMode(mode),mode);
  await expect(page.getByRole('menu',{name:mode==='actions'?'File actions':mode==='tools'?'Tools':'Convert',exact:true})).toBeVisible();
  box=await page.locator('.citrus-rind').boundingBox();
  expect(box!.x+box!.width/2).toBeCloseTo(260,0);expect(box!.y+box!.height/2).toBeCloseTo(310,0);
 }
});
