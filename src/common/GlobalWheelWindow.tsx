import { NativeButton as UiNativeButton } from './ui/primitives';
import { operationIcons, operationLabels } from './wheel-profiles';
import { hintedFiles, wheelFamily } from './file-kind';
import { Copy, FolderInput, Link, TerminalSquare, ScanEye, Palette, Paintbrush } from 'lucide-react';
import { performFileAction } from '../action';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, Crop, EyeOff, Film, FlipHorizontal2, Gauge, Layers, Minimize2, Music2, RotateCw, Scaling, Scissors, Split, Tag, VolumeX, type LucideIcon } from 'lucide-react';
import { api, defaultSettings } from './bridge';
import RadialWheel, { type WheelItem } from './RadialWheel';
import type { Capability, LocalFile, Snapshot } from './types';
import './global-wheel-window.css';

type WheelMode = 'convert' | 'tools' | 'actions';
const actionIcons: Record<string,LucideIcon> = {copy:Copy,move:FolderInput,'copy-path':Link,terminal:TerminalSquare,preview:ScanEye};
const imageToolIcons: Record<string,LucideIcon> = {compress:Minimize2,crop:Crop,resize:Scaling,rotate:RotateCw,flip:FlipHorizontal2,background:Palette,'edit-image':Paintbrush,metadata:Tag};
const actions = [
  { id: 'copy', label: 'Copy' }, { id: 'move', label: 'Move' },
  { id: 'copy-path', label: 'Copy Path' }, { id: 'terminal', label: 'Open Terminal' },
  { id: 'preview', label: 'Quick Preview' },
];
const operationName = (capability: Capability) => capability.operation || capability.id.split(':').pop()!;
const noticeText = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256);
const supports = (capability: Capability, file: LocalFile) => capability.inputs.includes('*') || ((file.category === 'other' || capability.category === file.category) && (file.ext ? capability.inputs.includes(file.isDirectory ? 'directory' : file.ext.toLowerCase()) : capability.category === file.category));
const knownCategory = (file: LocalFile) => file.category !== 'other' ? file.category : '';
const imageToolLabels: Record<string, string> = {
  'edit-image': 'Edit photo', background: 'Add background', compress: 'Compress',
  crop: 'Crop', resize: 'Resize', rotate: 'Rotate & flip', flip: 'Flip', metadata: 'Metadata',
};
const videoToolLabels: Record<string, string> = {
  compress: 'Compress', trim: 'Trim', split: 'Split', merge: 'Merge', crop: 'Crop', speed: 'Speed',
  snapshot: 'Frames', mute: 'Mute', redact: 'Redact', 'strip-metadata': 'Delete metadata', resize: 'Resize',
  rotate: 'Rotate', flip: 'Flip', gif: 'GIF', 'extract-audio': 'Extract audio',
};
export default function GlobalWheelWindow() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ files: [], jobs: [], capabilities: [], backends: {}, settings: defaultSettings, platform: 'unknown' });
  const [mode, setMode] = useState<WheelMode>(() => {
    const value = new URLSearchParams(window.location.search).get('mode');
    return value === 'tools' || value === 'actions' ? value : 'convert';
  });
  const [hints, setHints] = useState<LocalFile[]>([]);
  const [choice, setChoice] = useState('');
  const [failure, setFailure] = useState('');
  const processing = useRef(false);
  const choiceRef = useRef('');
  const nativeDropHandler = useRef<(files: LocalFile[], position?: { x: number; y: number }) => void>(() => {});
  const nativeOverHandler = useRef<(position: { x: number; y: number }) => void>(() => {});
  const seenDrag = useRef(false);
  const externalFiles = hints;
  const family = wheelFamily(externalFiles);

  useEffect(() => {
    let active = true;
    void api.bootstrap().then(value => { if (active) setSnapshot(value); }).catch(error => {
      console.error('Global wheel capability bootstrap failed:', error);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => api.onUpdate(update => setSnapshot(previous=>({...previous,...update}))), []);

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, [snapshot.settings.theme]);

  useEffect(() => {
    void api.currentWheelMode?.().then(value => {
      if (value === 'convert' || value === 'tools' || value === 'actions') setMode(value);
    });
    return api.onWheelMode?.((value, newDrag) => {
      if (newDrag) {
        setFailure('');
        setHints([]);
        setChoice('');
        choiceRef.current = '';
        seenDrag.current = false;
      }
      if (value === 'convert' || value === 'tools' || value === 'actions') {
        setMode(value);
        setChoice('');
        choiceRef.current = '';
      }
    });
  }, []);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // The global overlay is disposable; Escape must never surface the workspace.
        void api.finishGlobalWheel?.('background');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  // Runtime capabilities and inspected drag files are authoritative; unknown drags stay neutral.
  const capabilities = snapshot.capabilities;
  const selectedCategories: Set<string> = new Set(externalFiles.map(knownCategory).filter(Boolean));
  const items: WheelItem[] = mode === 'actions'
    ? actions.map(action => {const Icon=actionIcons[action.id];return {...action,icon:<Icon size={22} aria-hidden="true"/>,detail:'Local file action'}})
    : [...new Map(capabilities
      .filter(capability => capability.available && capability.outputs.length)
      .filter(capability => mode !== 'tools' || operationName(capability) !== 'create-archive')
      .filter(capability => mode !== 'tools' || !(capability.category === 'image' && operationName(capability) === 'strip-metadata'))
      .filter(capability => !selectedCategories.size || selectedCategories.has(capability.category))
      .filter(capability => mode === 'convert'
        ? ['convert', 'create-archive'].includes(operationName(capability))
        : !['convert', 'create-archive'].includes(operationName(capability)))
      .filter(capability => externalFiles.some(file => supports(capability, file)))
      .filter(capability => !['merge'].includes(operationName(capability)) || externalFiles.filter(file => supports(capability, file)).length > 1)
      .flatMap(capability => (mode === 'convert' ? capability.outputs : ['']).map(format => {
        const coverage = externalFiles.filter(file => supports(capability, file)).length;
        const operation = operationName(capability);
        const label = mode === 'convert' ? (capability.category==='spreadsheet' && format==='pdf'?'PDF · layout-limited':format.toUpperCase()) : capability.category === 'video' ? videoToolLabels[operation] || capability.label : capability.category === 'image' ? imageToolLabels[operation] || capability.label : operationLabels[operation] || capability.label;
        const Icon = capability.category === 'image' ? imageToolIcons[operation] : operationIcons[operation];
        return [{ id: `${capability.id}|${format}`, label, icon: Icon ? <Icon size={17} aria-hidden="true"/> : undefined, detail: coverage === externalFiles.length ? `${coverage} ${coverage === 1 ? 'file' : 'files'} · Local` : `${coverage} of ${externalFiles.length} files · Others will be skipped` }];
      }))
      .flat().map(item => [item.id, item])).values()];

  const isImage = family === 'image';

  function highlight(id: string) {
    choiceRef.current = id;
    setChoice(id);
  }

  function itemAt(x: number, y: number) {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-wheel-item]');
    const id = target?.dataset.wheelItem || '';
    return items.some(item => item.id === id && !item.disabled) ? id : '';
  }

  async function processIncoming(incoming: LocalFile[], targetChoice?: string) {
    if (!incoming.length || processing.current) return;
    processing.current = true;
    const acceptedTarget = targetChoice && items.some(item => item.id === targetChoice && !item.disabled) ? targetChoice : '';
    if (acceptedTarget) highlight(acceptedTarget);
    try {
      const selectedChoice = targetChoice === undefined ? choiceRef.current : acceptedTarget;
      if (!selectedChoice) {
        await api.finishGlobalWheel?.('background');
        return;
      }
      if (mode === 'actions') {
        const action = selectedChoice;
        const result = await performFileAction({ action, files: incoming }) as { ok?: boolean; canceled?: boolean; reason?: string };
        if (result?.ok === false) throw new Error(result.reason || 'The file action could not be completed.');
        await api.finishGlobalWheel?.('background');
        return;
      }
      const [capabilityId, format] = selectedChoice.split('|');
      const capability = capabilities.find(item => item.id === capabilityId && item.available && incoming.some(file => supports(item, file)));
      if (!capability) {
        await api.finishGlobalWheel?.('background');
        return;
      }
      if (capability.category !== 'spreadsheet' && ['convert', 'create-archive'].includes(operationName(capability))) {
        const settings = snapshot.settings;
        await api.enqueue({
          files: incoming.filter(file => supports(capability, file)),
          operation: operationName(capability),
          format,
          options: { quality: settings.quality, stripMetadata: settings.stripMetadata, outputFolder: settings.outputFolder, collision: settings.collision, recursive: settings.recursive, preserveStructure: settings.preserveStructure },
        });
        await api.finishGlobalWheel?.('background');
      } else {
        const compatibleDefault = capability.outputs.includes(incoming[0]?.ext) ? incoming[0].ext : capability.outputs[0] || '';
        await api.selectGlobalOperation?.({ capabilityId, format: format || compatibleDefault, files: incoming });
      }
    } catch (error) {
      console.error('Global wheel drop failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (mode === 'actions') {
        // File actions are direct operations. Keep failures local to the overlay instead of
        // treating the workspace as an error-review fallback.
        setFailure(message);
        await api.finishGlobalWheel?.('background');
        return;
      }
      setFailure(message);
      await api.finishGlobalWheel?.('background', noticeText(message));
    } finally {
      processing.current = false;
    }
  }

  async function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wheel-item]') : null;
    try {
      const incoming = await api.droppedFiles(Array.from(event.dataTransfer.files));
      if (incoming.length) await processIncoming(incoming, target?.dataset.wheelItem || '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure(message);
      await api.finishGlobalWheel?.('background', noticeText(`Could not inspect dropped files: ${message}`));
    }
  }

  nativeDropHandler.current = (files, position) => { void processIncoming(files, position ? itemAt(position.x, position.y) : undefined); };
  useEffect(() => api.onNativeDrop?.((files, position) => nativeDropHandler.current(files, position), message => {
    setFailure(message);
    void api.finishGlobalWheel?.('background', noticeText(`Could not inspect dropped files: ${message}`));
  }), []);
  nativeOverHandler.current = position => {
    const pager=document.elementFromPoint(position.x,position.y)?.closest<HTMLButtonElement>('button[data-wheel-page]');
    if(pager && !pager.disabled){pager.click();highlight('');return;}
    const id = itemAt(position.x, position.y);
    if (id !== choiceRef.current) highlight(id);
  };
  useEffect(() => api.onNativeDragEnter?.(files => {
    setHints(files); seenDrag.current = true; setChoice(''); choiceRef.current = ''; setFailure('');
  }), []);
  useEffect(() => api.onNativeDragOver?.(position => nativeOverHandler.current(position)), []);

  return <main className={`global-wheel-shell reference-wheel-shell ${isImage ? 'image-wheel-shell' : ''}`} aria-label="Santra global drop wheel" onDragEnter={event => {
    event.preventDefault();
    if (!seenDrag.current) { const files = hintedFiles(event.dataTransfer); if (files.length) { setHints(files); seenDrag.current = true; } }
  }} onDragOver={event => {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wheel-item]') : null;
    const targetChoice = target?.dataset.wheelItem;
    if (targetChoice && items.some(item => item.id === targetChoice && !item.disabled)) highlight(targetChoice);
    event.dataTransfer.dropEffect = 'copy';
  }} onDrop={event => void onDrop(event)}>
    <div className="global-wheel-card">
      {failure && <p role="alert" className="global-wheel-error">{failure}</p>}
      <RadialWheel
        family={family}
        sourceFile={hints[0]}
        sourceName={hints[0]?.name !== 'Dragged file' ? hints[0]?.name : undefined}
        label={mode === 'convert' ? 'Convert' : mode === 'tools' ? 'Tools' : 'File actions'}
        subtitle={externalFiles.some(file => file.category === 'document') && mode === 'convert' ? 'Conversion may lose layout, fonts, images and metadata; TXT keeps text only.' : externalFiles.some(file => !file.ext) ? 'Image routes are shown provisionally · drop to verify' : 'Hold the drag · hover a slice · release to apply'}
        items={items}
        selected={choice}
        onHighlight={highlight}
        onChoose={highlight}
        dragging
        hideDescription={!(mode === 'convert' && externalFiles.some(file => file.category === 'document'))}
      />
    </div>
    <UiNativeButton className="global-wheel-cancel" onClick={() => void api.finishGlobalWheel?.('background')} aria-label="Close drop wheel">×</UiNativeButton>
  </main>;
}
