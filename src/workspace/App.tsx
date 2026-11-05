import { hintedFiles as dragHints, wheelFamily } from '../common/file-kind';
import { performFileAction } from '../action';
import { enqueueLocalOperation } from '../convert/common/queue';
import ConversionWindow from '../convert/ConversionWindow';
import ConversionDetails from '../convert/ConversionDetails';
import ArchiveWindow from '../tools/archive/ArchiveWindow';
import AudioToolWindow, { audioEditorOperations } from '../tools/audio/AudioToolWindow';
import Modal from '../common/Modal';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Copy, CornerDownLeft, File, FileArchive, FileAudio, FileImage, FileSliders, FileSpreadsheet, FileText, FileVideo, Files, Folder, FolderOpen, History, Image, Info, Keyboard, Layers, Leaf, ListFilter, LoaderCircle, LockKeyhole, Maximize, Monitor, Moon, MoreHorizontal, Music2, Package, PanelLeftClose, Play, Plus, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Terminal, Trash2, Upload, WandSparkles, X, Zap } from 'lucide-react';
import { api, defaultSettings, isDesktop } from '../common/bridge';
import { en as t, settingsLabels } from '../common/strings';
import type { Capability, Job, LocalFile, Settings, Snapshot } from '../common/types';
import OperationFields from '../common/OperationFields';
import RadialWheel, { type WheelItem } from '../common/RadialWheel';
import PdfWorkspace from '../tools/pdf/PdfWorkspace';
import ImageToolWindow from '../tools/image/ImageToolWindow';
import { Crop, RotateCw, FlipHorizontal, Scissors, VolumeX, Gauge, Camera, Paintbrush, Palette, Merge, Split, type LucideIcon } from 'lucide-react';

type Page = 'converter' | 'activity' | 'formats' | 'settings';
type PickerTab = 'convert' | 'tools' | 'actions';
const families = [
  { id: 'image', label: 'Images', icon: FileImage, color: 'peach', formats: ['JPG', 'PNG', 'WebP', 'HEIC', 'TIFF', 'AVIF', 'BMP', 'SVG'], engine: 'Built-in images / ImageMagick', detail: 'A new look, down to the last pixel.' },
  { id: 'video', label: 'Video', icon: FileVideo, color: 'lavender', formats: ['MP4', 'MOV', 'MKV', 'WebM', 'AVI', 'WMV', 'GIF'], engine: 'FFmpeg', detail: 'From the big screen to a little GIF.' },
  { id: 'audio', label: 'Audio', icon: FileAudio, color: 'mint', formats: ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG', 'Opus', 'AIFF', 'WMA'], engine: 'FFmpeg', detail: 'Good sound. Your choice of format.' },
  { id: 'pdf', label: 'PDFs', icon: FileText, color: 'rose', formats: ['PDF', 'PNG', 'JPG', 'TXT'], engine: 'Poppler / qpdf', detail: 'A little less paperwork.' },
  { id: 'document', label: 'Documents', icon: Files, color: 'sand', formats: ['DOCX', 'MD', 'TXT', 'EPUB', 'RTF', 'HTML', 'PDF'], engine: 'Pandoc / LibreOffice', detail: 'Keep your words moving.' },
  { id: 'presentation', label: 'Presentations', icon: Layers, color: 'peach', formats: ['PPT', 'PPTX', 'PDF'], engine: 'LibreOffice', detail: 'Give your next idea a new stage.' },
  { id: 'spreadsheet', label: 'Spreadsheets', icon: FileSpreadsheet, color: 'mint', formats: ['XLSX', 'ODS', 'CSV', 'TSV', 'XLS', 'PDF'], engine: 'LibreOffice', detail: 'Bring a little order to your data.' },
  { id: 'subtitle', label: 'Subtitles', icon: FileSliders, color: 'lavender', formats: ['SRT', 'VTT', 'TXT'], engine: 'Built in', detail: 'Every word, right on time.' },
  { id: 'archive', label: 'Archives', icon: FileArchive, color: 'sand', formats: ['ZIP', 'TAR', 'GZIP', 'RAR'], engine: 'Optional safe archive backend', detail: 'Good things, neatly wrapped.' }
];
const actionItems = [ { id: 'copy', label: t.copy, icon: Copy }, { id: 'move', label: t.move, icon: FolderOpen }, { id: 'copy-path', label: t.copyPath, icon: Clipboard }, { id: 'terminal', label: t.terminal, icon: Terminal }, { id: 'preview', label: t.quickPreview, icon: ScanLine } ];
const operationName = (cap: Capability) => cap.operation || cap.id.split(':').pop()!;
const compatible = (cap: Capability, file: LocalFile) => cap.inputs.includes('*') || ((file.category === 'other' || cap.category === file.category) && cap.inputs.includes(file.isDirectory ? 'directory' : file.ext.toLowerCase()));
const toolLabels: Record<string, string> = { 'edit-image': 'Edit photo', background: 'Add background', compress: 'Compress', crop: 'Crop', resize: 'Resize', rotate: 'Rotate', flip: 'Flip', metadata: 'Edit metadata', 'strip-metadata': 'Delete metadata', trim: 'Trim', visualize: 'Visualize', normalize: 'Normalize', channels: 'Channels', speed: 'Speed', mute: 'Mute', snapshot: 'Snapshot', gif: 'Create GIF', 'extract-audio': 'Extract audio', 'pdf-extract': 'Extract pages', 'pdf-merge': 'Merge PDFs', 'pdf-rotate': 'Rotate pages', render: 'Render pages', extract: 'Extract archive', 'create-archive': 'Create archive' };
const toolIcons: Record<string, LucideIcon> = { 'edit-image': Paintbrush, background: Palette, compress: Package, crop: Crop, resize: Maximize, rotate: RotateCw, flip: FlipHorizontal, metadata: Info, 'strip-metadata': Info, trim: Scissors, visualize: AudioLines, normalize: SlidersHorizontal, channels: AudioLines, speed: Gauge, mute: VolumeX, snapshot: Camera, gif: FileVideo, 'extract-audio': Music2, 'pdf-extract': Files, 'pdf-merge': Merge, 'pdf-rotate': RotateCw, render: FileImage, extract: FileArchive, 'create-archive': Package, merge: Merge, split: Split };
function formatSize(size: number) { return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`; }
function Orange({ className = '', sliced = false }: { className?: string; sliced?: boolean }) { return <img className={`santra-logo ${sliced ? 'santra-logo--illustration' : ''} ${className}`} src="./santra.png" alt="" aria-hidden="true"/>; }
function FileIcon({ file }: { file: LocalFile }) { const family = families.find(item => item.id === file.category); const Icon = file.isDirectory ? Folder : family?.icon || File; return <span className={`file-icon ${family?.color || 'sand'}`}><Icon size={23}/></span>; }
export default function App() {
  const [conversionEditor, setConversionEditor] = useState<{capability:Capability;files:LocalFile[];format:string;options:Record<string,string>}|null>(null);
  const [archiveEditor, setArchiveEditor] = useState<{capability:Capability;files:LocalFile[];format:string;options:Record<string,string>}|null>(null);
  const [audioEditor, setAudioEditor] = useState<{capability:Capability;files:LocalFile[];format:string;options:Record<string,string>}|null>(null);
  const [data, setData] = useState<Snapshot>({ files: [], jobs: [], capabilities: [], backends: {}, settings: defaultSettings, platform: 'browser' });
  const [page, setPage] = useState<Page>('converter');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerTab | null>(null);
  const [guide, setGuide] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [licenses, setLicenses] = useState(false);
  const dragActive = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState<PickerTab | null>(null);
  const [wheelChoice, setWheelChoice] = useState('');
  const [dragSource, setDragSource] = useState<LocalFile[]>([]);
  const floatingWheelRef = useRef<HTMLDivElement>(null);
  const wheelOrigin = useRef({x:400,y:350});
  const [wheelAnchor, setWheelAnchor] = useState({ x: 300, y: 200 });
  const [pdfEditor, setPdfEditor] = useState<{ capability: Capability; files: LocalFile[]; format: string; options: Record<string, string> } | null>(null);
  const [imageEditor, setImageEditor] = useState<{ capability: Capability; files: LocalFile[]; format: string; options: Record<string, string> } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState('all');
  const [operation, setOperation] = useState<Capability | null>(null);
  const [outputFormat, setOutputFormat] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [settingsTab, setSettingsTab] = useState('general');
  const [hiddenJobs, setHiddenJobs] = useState<string[]>([]);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLButtonElement>(null);
  const dragInternal = useRef<LocalFile[] | null>(null);
  const dragChoice = useRef('');
  const dragModeRef = useRef<PickerTab | null>(null);
  const pendingNativeMode = useRef<PickerTab | null>(null);
  const dragPosition = useRef({ x: 400, y: 350 });
  const modifierTap = useRef({ pressed: new Map<string, number>(), lastReleased: '', releasedAt: 0 });
  const selectedFiles = files.filter(file => selected.includes(file.id));
  const activeJobs = data.jobs.filter(job => ['queued', 'preparing', 'processing', 'publishing'].includes(job.status));
  const completedJobs = data.jobs.filter(job => job.status === 'completed');
  const settings = data.settings;

  useEffect(() => { api.bootstrap().then(snapshot => { setData({ ...snapshot, settings: { ...defaultSettings, ...snapshot.settings, shortcuts: { ...defaultSettings.shortcuts, ...snapshot.settings?.shortcuts } } }); if (snapshot.files?.length) { setFiles(snapshot.files); setSelected(snapshot.files.map(file => file.id)); } }).catch(error => setNotice(String(error.message || error))); return api.onUpdate(update => { setData(previous => ({ ...previous, ...update })); if (update.files?.length) { setFiles(previous => [...new Map([...previous, ...update.files!].map(file => [file.path, file])).values()]); setSelected(previous => [...new Set([...previous, ...update.files!.map(file => file.id)])]); } }); }, []);
  useEffect(() => api.onNativeDrop?.(incoming => {
    if (!incoming.length) return;
    const mode = pendingNativeMode.current || dragModeRef.current || 'convert';
    pendingNativeMode.current = null;
    resetDrag();
    appendFiles(incoming);
    setSelected(incoming.map(file => file.id));
    setPicker(mode);
  }, message => setNotice(`Could not inspect dropped files: ${message}`)), []);
  useEffect(() => api.onNativeDragEnter?.(incoming=>{setDragSource(incoming);highlightWheel('');}), []);
  useEffect(() => { document.documentElement.dataset.theme = 'light'; }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement)?.matches('input,select,textarea');
      if (pdfEditor) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); void addFiles(); }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setPage('formats'); setTimeout(() => document.querySelector<HTMLInputElement>('.library-search input')?.focus(), 0); }
      if (event.key === 'Escape') { resetDrag(); setPicker(null); }
      if (editing) return;
      if (event.key === 'Enter' && selected.length && page === 'converter' && !(event.target as HTMLElement)?.closest('button,a,input,select,textarea') && !picker && !guide && !privacy && !licenses) { event.preventDefault(); setPicker('convert'); }
      if (!dragActive.current && !picker) return;
      const modifier = ['Shift', 'Alt', 'Control'].includes(event.key) ? event.key : '';
      if (!modifier || event.repeat || modifierTap.current.pressed.has(modifier)) return;
      const now = performance.now();
      modifierTap.current.pressed.set(modifier, now);
      const doubleTap = modifierTap.current.lastReleased === modifier && now - modifierTap.current.releasedAt <= 400;
      modifierTap.current.lastReleased = '';
      if (!doubleTap) return;
      const key = event.ctrlKey && event.shiftKey ? 'Ctrl+Shift' : modifier;
      const match = Object.entries(settings.shortcuts).find(([, value]) => value === key || (value === 'Ctrl' && key === 'Control'));
      if (match) { event.preventDefault(); if (dragActive.current) activateWheel(match[0] as PickerTab); else setPicker(match[0] as PickerTab); }
    };
    const released = (event: KeyboardEvent) => {
      const pressedAt = modifierTap.current.pressed.get(event.key);
      if (pressedAt === undefined) return;
      modifierTap.current.pressed.delete(event.key);
      const now = performance.now();
      if ((dragActive.current || picker) && now - pressedAt <= 400) { modifierTap.current.lastReleased = event.key; modifierTap.current.releasedAt = now; }
      else modifierTap.current.lastReleased = '';
    };
    window.addEventListener('keydown', handle);
    window.addEventListener('keyup', released);
    return () => { window.removeEventListener('keydown', handle); window.removeEventListener('keyup', released); };
  });

  useLayoutEffect(()=>{
    if(!dragMode)return;
    const element=floatingWheelRef.current;
    if(!element)return;
    const place=()=>{
      const panel=element.getBoundingClientRect();
      const target=element.querySelector('.citrus-rind, .reference-wheel-empty')?.getBoundingClientRect();
      if(!target)return;
      const margin=8;
      const clamp=(value:number,available:number,length:number)=>Math.max(margin,Math.min(Math.max(margin,available-length-margin),value));
      const x=clamp(wheelOrigin.current.x-(target.left-panel.left+target.width/2),window.innerWidth,panel.width);
      const y=clamp(wheelOrigin.current.y-(target.top-panel.top+target.height/2),window.innerHeight,panel.height);
      setWheelAnchor(previous=>Math.abs(previous.x-x)<.5&&Math.abs(previous.y-y)<.5?previous:{x,y});
    };
    place();
    const observer=new ResizeObserver(place);observer.observe(element);
    window.addEventListener('resize',place);
    return()=>{observer.disconnect();window.removeEventListener('resize',place)};
  },[dragMode,dragSource]);

  async function runSafe<T,>(task: () => Promise<T>): Promise<T | undefined> { try { return await task(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } }
  async function addFiles(folder = false) { setBusy(true); await runSafe(async () => { const incoming = await (folder ? api.addFolder() : api.addFiles()); appendFiles(incoming); }); setBusy(false); }
  function appendFiles(incoming: LocalFile[]) { if (!incoming?.length) return; setFiles(previous => { const paths = new Set(previous.map(file => file.path)); return [...previous, ...incoming.filter(file => !paths.has(file.path))]; }); setSelected(previous => [...new Set([...previous, ...incoming.map(file => file.id)])]); setPage('converter'); setOperation(null); }
  async function saveSettings(patch: Partial<Settings>) { await runSafe(async () => { const updated = await api.saveSettings(patch); setData(previous => ({ ...previous, settings: { ...previous.settings, ...updated } })); }); }
  function validRoutes(tab: PickerTab, source = selectedFiles) { return data.capabilities.filter(cap => cap.available && cap.outputs.length && (tab === 'convert' ? operationName(cap) === 'convert' || operationName(cap) === 'render' : operationName(cap) !== 'convert' && operationName(cap) !== 'render' && !(cap.category === 'image' && operationName(cap) === 'strip-metadata')) && source.some(file => compatible(cap, file)) && (!['merge', 'pdf-merge'].includes(operationName(cap)) || source.filter(file => compatible(cap, file)).length >= 2)); }
  function wheelItems(tab: PickerTab, source = selectedFiles): WheelItem[] {
    if (tab === 'actions') return actionItems.map(item => ({ id: item.id, label: item.label, detail: 'Local file action', icon: <item.icon size={20}/> }));
    const routes = validRoutes(tab, source).flatMap(cap => (tab === 'convert' ? cap.outputs : ['']).map(format => {
      const count = source.filter(file => compatible(cap, file)).length;
      const Icon = toolIcons[operationName(cap)] || WandSparkles;
      return { id: `${cap.id}|${format}`, label: tab === 'convert' ? format.toUpperCase() : toolLabels[operationName(cap)] || cap.label, detail: count === source.length ? `${count} ${count === 1 ? 'file' : 'files'} · Processed locally` : `${count} of ${source.length} files · Others will be skipped`, icon: tab === 'tools' ? <Icon size={19}/> : undefined };
    }));
    return [...new Map(routes.map(item => [item.label, item])).values()];
  }
  function chooseWheel(id: string, tab: PickerTab, source = selectedFiles) {
    if (!id) return;
    if (tab === 'actions') { void fileAction(id, source); return; }
    const [capId, format] = id.split('|');
    const cap = data.capabilities.find(item => item.id === capId);
    if (cap) pickRoute(cap, format || undefined, source);
  }
  function pickRoute(cap: Capability, format?: string, source = selectedFiles) {
    if (!cap.available) { setNotice('This operation is unavailable. Check local engines in Settings.'); return; }
    const id = operationName(cap);
    const presets: Record<string, Record<string, string>> = { trim: { start: '0', duration: '10' }, rotate: { angle: '90' }, 'pdf-rotate': { angle: '90', pages: '1-z' }, 'pdf-extract': { pages: '1-z' }, flip: { direction: 'horizontal' }, gif: { fps: '12', width: '480' }, render: { page: '1', dpi: '300' } };
    const target = format || (cap.outputs.includes(source[0]?.ext) ? source[0].ext : cap.outputs[0]) || '';
    const nextOptions = presets[id] || {};
    const skipped = source.filter(file => !compatible(cap, file)).length;
    const normalized = { ...cap, id, operation: id, warning: skipped ? `${skipped} selected ${skipped === 1 ? 'file does' : 'files do'} not support this operation and will be recorded as skipped. ${cap.warning || ''}` : cap.warning };
    setOperation(normalized); setOutputFormat(target); setPicker(null); setOptions(nextOptions); setPage('converter');
    if (id === 'convert' && ['document','presentation','spreadsheet','subtitle'].includes(cap.category)) setConversionEditor({capability:normalized,files:source.filter(file=>compatible(cap,file)),format:target,options:nextOptions});
    else if (cap.category === 'archive') setArchiveEditor({capability:normalized,files:source.filter(file=>compatible(cap,file)),format:target,options:nextOptions});
    else if (cap.category === 'audio' && audioEditorOperations.includes(id)) setAudioEditor({capability:normalized,files:source.filter(file=>compatible(cap,file)),format:target,options:nextOptions});
    else if (cap.category === 'pdf') setPdfEditor({ capability: normalized, files: source, format: target, options: nextOptions });
    else if (cap.category === 'image' && ['edit-image', 'background', 'crop', 'resize', 'rotate', 'flip', 'compress', 'metadata', 'strip-metadata'].includes(id)) {
      const compatibleFiles = source.filter(file => compatible(cap, file));
      if (isDesktop && api.openImageTool) void runSafe(() => api.openImageTool!({ capabilityId: cap.id, files: compatibleFiles.map(file => file.path), format: target, options: nextOptions }));
      else setImageEditor({ capability: normalized, files: compatibleFiles, format: target, options: nextOptions });
    }
    else if (cap.category === 'video' && id !== 'convert' && api.openVideoTool) {
      const compatibleFiles = source.filter(file => compatible(cap, file));
      void runSafe(() => api.openVideoTool!({ capabilityId: cap.id, files: compatibleFiles.map(file => file.path), format: target, options: nextOptions }));
    }
  }
  useEffect(() => {
    const removeFiles = api.onGlobalFiles?.(({ files: incoming, mode, notice: message }) => {
      appendFiles(incoming);
      setSelected(incoming.map(file => file.id));
      setPicker(mode);
      if (message) setNotice(message);
    });
    const removeOperation = api.onGlobalOperation?.(({ capabilityId, format, files: incoming }) => {
      setFiles(previous => [...new Map([...previous, ...incoming].map(file => [file.path, file])).values()]);
      setSelected(incoming.map(file => file.id));
      const capability = data.capabilities.find(item => item.id === capabilityId);
      if (capability) pickRoute(capability, format || undefined, incoming);
      else setNotice('That operation is no longer available for the selected files.');
    });
    const removePage = api.onGlobalPage?.(destination => setPage(destination));
    const removeNotice = api.onGlobalNotice?.(message => setNotice(message));
    return () => { removeFiles?.(); removeOperation?.(); removePage?.(); removeNotice?.(); };
  }, [data.capabilities]);
  async function queueOperation(cap: Capability, format: string, values: Record<string, string>, source = selectedFiles) {
    await enqueueLocalOperation(cap, format, source, settings, values);
    setPage('activity'); setNotice('Your files are in the local queue.');
  }
  async function startConversion() { if (!operation || !selectedFiles.length) return; await runSafe(() => queueOperation(operation, outputFormat, options)); }
  async function fileAction(action: string, source = selectedFiles) { await runSafe(async () => { const result = await performFileAction({ action, files: source }) as { ok?: boolean; canceled?: boolean; reason?: string; results?: { ok: boolean; input: string; output: string; error?: string }[] } | string; if (typeof result === 'string') setNotice(result); else if (result?.canceled) return; else if (result?.ok === false) setNotice(result.reason || result.results?.filter(item => !item.ok).map(item => item.error).join('; ') || 'Some files could not be processed.'); else setNotice(action === 'copy-path' ? 'Paths copied to clipboard.' : result?.results ? result.results.map(item => `${item.input} → ${item.output}`).join('; ') : 'File action completed.'); }); setPicker(null); }
  function resetDrag() { dragActive.current = false; setDragging(false); setDragMode(null); dragModeRef.current = null; dragDepth.current = 0; dragInternal.current = null; dragChoice.current = ''; modifierTap.current.lastReleased = ''; modifierTap.current.pressed.clear(); setWheelChoice(''); }
  function highlightWheel(id: string) { dragChoice.current = id; setWheelChoice(id); }
  function activateWheel(mode: PickerTab) {
    if (!dragModeRef.current) {
      wheelOrigin.current = {...dragPosition.current};
      setWheelAnchor(wheelOrigin.current);
    }
    if (mode !== dragMode) highlightWheel('');
    dragModeRef.current = mode;
    setDragMode(mode);
  }
  async function onDrop(event: DragEvent) {
    event.preventDefault();
    if (pdfEditor) return;
    const dropped = Array.from(event.dataTransfer.files), internal = dragInternal.current;
    const mode = dragMode, choice = dragChoice.current;
    pendingNativeMode.current = mode;
    resetDrag();
    if (!dropped.length && !internal?.length) return;
    setBusy(true);
    await runSafe(async () => {
      const incoming = internal || await api.droppedFiles(dropped);
      if (!incoming.length) return;
      pendingNativeMode.current = null;
      appendFiles(incoming); setSelected(incoming.map(file => file.id));
      if (mode === 'actions' && choice) await fileAction(choice, incoming);
      else if (mode && choice && choice !== 'choose') {
        const [id, format] = choice.split('|');
        const cap = data.capabilities.find(item => item.id === id && item.available && incoming.some(file => compatible(item, file)));
        if (cap && operationName(cap) === 'convert') await queueOperation(cap, format, {}, incoming);
        else if (cap) pickRoute(cap, format || undefined, incoming);
        else setPicker(mode);
      } else setPicker(mode || 'convert');
    });
    setBusy(false);
  }
  function selectToggle(id: string) { setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]); }
  const localCount = Object.values(data.backends).filter(backend => backend.available).length;
  const visibleJobs = data.jobs.filter(job => !hiddenJobs.includes(job.id));

  return <div className="app" onDragEnter={event => {
    event.preventDefault();
    dragPosition.current = {x:event.clientX,y:event.clientY};
    if (pdfEditor || (!event.dataTransfer.types.includes('Files') && !dragInternal.current)) return;
    if (!dragActive.current) { pendingNativeMode.current = null; modifierTap.current.lastReleased = ''; modifierTap.current.pressed.clear(); setDragSource(dragInternal.current || dragHints(event.dataTransfer)); highlightWheel(''); }
    dragActive.current = true; setDragging(true);
  }} onDragOver={event => {
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    if (pdfEditor) return;
    dragPosition.current = { x: event.clientX, y: event.clientY };
  }} onDragLeave={event => {
    event.preventDefault();
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) resetDrag();
  }} onDrop={onDrop}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('converter'); }} aria-label="Santra home"><Orange/><span>{t.brand}<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">{t.workspace}</div>
      <nav aria-label="Main navigation">{([{ id: 'converter', label: t.converter, icon: ArrowDownToLine }, { id: 'activity', label: t.activity, icon: History }, { id: 'formats', label: t.formats, icon: Layers }] as const).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'activity' && activeJobs.length > 0 && <span className="nav-count">{activeJobs.length}</span>}{page === item.id && <span className="nav-active-dot"/>}</button>)}</nav>
      <div className="sidebar-collection"><span className="workspace-label">MADE FOR ALL YOUR FILES</span><div className="mini-formats">{[Image, FileVideo, Music2, FileText].map((Icon, index) => <span key={index}><Icon size={17}/></span>)}</div><p>A different format.<br/>The same possibilities.</p></div>
      <div className="sidebar-bottom"><div className="local-note"><span className="local-badge"><ShieldCheck size={19}/></span><strong>{t.offline}</strong><p>{t.noUploads}</p><button onClick={() => setPrivacy(true)}>{t.privacyLink}<ArrowUpRight size={13}/></button></div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings2 size={19}/><span>{t.settings}</span></button><button className="nav-item" onClick={() => setGuide(true)}><CircleHelp size={19}/><span>{t.help}</span><ArrowUpRight size={14}/></button><button className="version" onClick={() => setLicenses(true)} aria-label="About Santra and third-party licenses"><span className="version-dot"/>{t.version}<span>{t.beta}</span></button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">{t.tagline}<span>/</span><strong>{t[page === 'formats' ? 'formats' : page]}</strong></div><div className="topbar-right"><span className="local-pill"><span/>{t.local}</span><button className="avatar" onClick={() => setPrivacy(true)} aria-label={t.privacy}><Leaf size={18}/></button></div></header>
    <main className={`main-content ${page}`}>
      {page === 'converter' && <>
        <section className="page-heading"><div><div className="eyebrow"><span/> {t.welcome}</div><h1>{files.length ? t.filesReady : t.title}</h1><p>{files.length ? t.queueHint : t.subtitle}</p></div><button ref={fileInput} className="button primary" disabled={busy} onClick={() => void addFiles()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Plus size={18}/>} {t.addFiles}<span className="button-key">Ctrl O</span></button></section>
        <div className="converter-grid"><div className="converter-main">
          {files.length === 0 ? <section className="drop-zone" aria-label="Drop files here" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void addFiles(); } }}><div className="drop-decoration dot-one"/><div className="drop-decoration dot-two"/><div className="file-illustration"><div className="floating-file file-back"><FileImage size={26}/><span>JPG</span></div><div className="floating-file file-front"><FileText size={27}/><span>PDF</span></div><div className="illustration-arrow"><ArrowRight size={18}/></div><div className="little-spark">✦</div></div><h2>{t.drop}</h2><p>{t.dropHint}</p><button className="browse-link" onClick={() => void addFiles()}>{t.browse}<ArrowUpRight size={15}/></button><div className="drop-divider"/><div className="drop-buttons"><button className="button small" onClick={() => void addFiles()}><Plus size={15}/>{t.addFiles}</button><button className="button small" onClick={() => void addFiles(true)}><Folder size={15}/>{t.addFolder}</button></div><div className="drop-keyboard"><kbd>{settings.shortcuts.convert}</kbd><span>{t.shiftHint.replace('Shift', settings.shortcuts.convert)}</span></div></section>
          : <section className="queue-panel">
            <header className="section-row"><h2>{t.queue}<span className="count-badge">{files.length}</span></h2><div className="row-actions"><button className="text-button" onClick={() => setSelected(selected.length === files.length ? [] : files.map(file => file.id))}>{selected.length === files.length ? t.clear : t.selectAll}</button><button className="icon-button" aria-label={t.addFolder} onClick={() => void addFiles(true)}><Folder size={17}/></button></div></header>
            <div className="file-list">{files.map(file => <div key={file.id} draggable className={`file-row ${selected.includes(file.id) ? 'selected' : ''}`} onDragStart={event => {
              const source = selected.includes(file.id) ? selectedFiles : [file];
              dragInternal.current = source; setDragSource(source); setSelected(source.map(item => item.id)); dragActive.current = true; setDragging(true); setDragMode(null); highlightWheel('');
              event.dataTransfer.setData('application/x-santra-selection', source.map(item => item.id).join(',')); event.dataTransfer.effectAllowed = 'copy';
              dragPosition.current = { x: event.clientX, y: event.clientY };
            }} onDragEnd={resetDrag} onContextMenu={event => { event.preventDefault(); if (!selected.includes(file.id)) setSelected([file.id]); setPicker('actions'); }}>
              <input aria-label={`Select ${file.name}`} type="checkbox" checked={selected.includes(file.id)} onChange={() => selectToggle(file.id)}/><FileIcon file={file}/><button className="file-name" onClick={() => { setSelected([file.id]); setPicker('convert'); }}><strong>{file.name}</strong><span>{file.isDirectory ? 'Folder' : `${file.ext.toUpperCase()} · ${formatSize(file.size)}`}</span></button><span className="ready-label"><span/>{t.ready}</span><button className="icon-button" aria-label={`${t.remove} ${file.name}`} onClick={() => { setFiles(previous => previous.filter(item => item.id !== file.id)); setSelected(previous => previous.filter(id => id !== file.id)); }}><X size={15}/></button>
            </div>)}</div>
            <footer className="queue-footer"><span>{selectedFiles.length} {t.selected}</span><button className="button small" disabled={!selectedFiles.length} onClick={() => setPicker('convert')}>{t.chooseOperation}<ArrowRight size={15}/></button></footer>
            {selectedFiles.some(file => file.category !== selectedFiles[0]?.category) && <p className="inline-warning"><Info size={16}/>{t.mixed}</p>}
          </section>}
          {!!files.length && <div className="selection-tools" aria-label="Selected file operations">{(['convert', 'tools', 'actions'] as const).map(mode => <button key={mode} disabled={!selectedFiles.length} onClick={() => setPicker(mode)}>{mode === 'convert' ? <ArrowDownToLine size={15}/> : mode === 'tools' ? <WandSparkles size={15}/> : <Folder size={15}/>} {t[mode]}<kbd>{settings.shortcuts[mode]}</kbd></button>)}</div>}
          <section className="quick-tools"><div className="section-row"><div><h2>{t.quickTools}</h2><p>{t.quickSubtitle}</p></div><button className="text-button" onClick={() => { if (files.length) setPicker('tools'); else { setPage('formats'); setQuery(''); } }}>{t.allTools}<ArrowUpRight size={14}/></button></div><div className="tool-grid">{[{ title: t.compress, text: t.compressDescription, icon: Package, color: 'peach', operation: 'compress' }, { title: t.resize, text: t.resizeDescription, icon: Maximize, color: 'lavender', operation: 'resize' }, { title: t.extract, text: t.extractDescription, icon: AudioLines, color: 'mint', operation: 'extract-audio' }, { title: t.pdf, text: t.pdfDescription, icon: Files, color: 'sand', operation: 'pdf-extract' }].map(tool => <button className="tool-card" key={tool.title} onClick={() => { const cap = validRoutes(tool.operation === 'convert' ? 'convert' : 'tools').find(item => (item.operation || item.id.split(':').pop()) === tool.operation); if (cap) pickRoute(cap); else if (files.length) setPicker(tool.operation === 'convert' ? 'convert' : 'tools'); else { setNotice(t.noFilesHint); fileInput.current?.focus(); } }}><span className={`tool-icon ${tool.color}`}><tool.icon size={22}/></span><ArrowUpRight className="tool-arrow" size={16}/><strong>{tool.title}</strong><span>{tool.text}</span></button>)}</div></section>
          <section className="format-strip"><span>HAPPILY WORKS WITH</span><div>{['JPG', 'PNG', 'MP4', 'MP3', 'PDF', 'DOCX', 'ZIP'].map(ext => <span key={ext}>{ext}</span>)}<button onClick={() => setPage('formats')}>and more <ArrowRight size={13}/></button></div><small>{t.optional}</small></section>
        </div><aside className="right-rail">{operation && files.length ? <section className="output-card"><div className="section-row"><span className="eyebrow">{t.output}</span><button className="icon-button" aria-label="Clear operation" onClick={() => setOperation(null)}><X size={16}/></button></div><h2>{operation.label}</h2><label className="field-label">{t.selectedFormat}<select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}>{operation.outputs?.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label><label className="field-label">{t.quality}<div className="range-label"><span>{t.balanced}</span><strong>{settings.quality}%</strong></div><input type="range" min="1" max="100" value={settings.quality} onChange={event => void saveSettings({ quality: Number(event.target.value) })}/></label><ConversionDetails capability={operation} files={selectedFiles}/><OperationFields capability={operation} values={options} onChange={setOptions}/><div className="output-destination"><Folder size={18}/><div><strong>{t.saveTo}</strong><span title={settings.outputFolder}>{settings.outputFolder || t.alongside}</span></div><button className="icon-button" aria-label={t.change} onClick={() => void runSafe(async () => { const folder = await api.pickOutput(); if (folder) await saveSettings({ outputFolder: folder }); })}><MoreHorizontal size={18}/></button></div><label className="checkbox-label"><input type="checkbox" checked={operation.preservesMetadata && !settings.stripMetadata} disabled={!operation.preservesMetadata} onChange={event => void saveSettings({ stripMetadata: !event.target.checked })}/><span>{operation.preservesMetadata ? t.metadata : "This local backend removes metadata"}</span></label>{['jpg','jpeg'].includes(outputFormat) && <p className="inline-warning"><Info size={16}/>{t.transparency}</p>}{operation.warning && <p className="inline-warning"><Info size={16}/>{operation.warning}</p>}<button className="button primary full" disabled={!selectedFiles.length} onClick={() => void startConversion()}><Zap size={17}/>{t.run}</button><p className="fine-print">{t.outputWarning}</p></section> : <section className="privacy-card"><div className="privacy-visual"><div className="privacy-orbit"/><Orange sliced/><span className="shield-float"><ShieldCheck size={22}/></span><span className="privacy-star">✦</span></div><span className="eyebrow">A LITTLE PEACE OF MIND</span><h2>{t.deviceTitle.split('\n').map((line, index) => <span key={index}>{line}<br/></span>)}</h2><p>{t.deviceText}</p><button onClick={() => setPrivacy(true)}>{t.privacyLink}<ArrowUpRight size={15}/></button><div className="privacy-bottom"><LockKeyhole size={13}/>{t.privacyFootnote}</div></section>}
          <section className="workflow-card"><div className="section-row"><h3>{t.workflowTitle}</h3><Sparkles size={17}/></div>{[{ title: t.workflowDrag, text: t.workflowDragText }, { title: t.workflowChoose, text: t.workflowChooseText }, { title: t.workflowDone, text: t.workflowDoneText }].map((step, index) => <div className="workflow-step" key={step.title}><span>{index + 1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></div>)}<button className="text-button" onClick={() => setGuide(true)}>{t.learnMore}<ArrowRight size={14}/></button></section>
        </aside></div>
      </>}
      {page === 'activity' && <><section className="page-heading"><div><div className="eyebrow"><span/> YOUR LOCAL WORKSPACE</div><h1>One thing at a time. Or a few.</h1><p>Keep an eye on every file, from start to fresh start.</p></div><button className="button" onClick={() => setHiddenJobs(data.jobs.filter(job => ['completed','cancelled','skipped'].includes(job.status)).map(job => job.id))}>{t.clearFinished}</button></section><div className="activity-stats">{[{ label: t.active, count: activeJobs.filter(job => job.status !== 'queued').length, icon: RefreshCw }, { label: t.queued, count: activeJobs.filter(job => job.status === 'queued').length, icon: History }, { label: t.completed, count: completedJobs.length, icon: CheckCheck }].map(stat => <div key={stat.label}><stat.icon size={21}/><strong>{stat.count}</strong><span>{stat.label}</span></div>)}</div>{visibleJobs.length ? <section className="jobs-list">{visibleJobs.map(job => <JobRow key={job.id} job={job} onCancel={() => void runSafe(() => api.cancel(job.id))} onRetry={() => void runSafe(() => api.retry(job.id))} onReveal={() => void runSafe(() => api.reveal(job.output!))} onOpen={() => void runSafe(() => api.openOutput(job.output!))} onDiagnostic={() => { const copy = api.copyDiagnostic ? api.copyDiagnostic(job.id) : navigator.clipboard.writeText(JSON.stringify({ operation: job.operation, format: job.format, status: job.status, error: job.error ? 'A local processing error occurred' : null, version: '0.1.0' }, null, 2)); void copy.then(() => setNotice('Diagnostic details copied. Review before sharing.')).catch(error => setNotice(error instanceof Error ? error.message : String(error))); }}/>)}</section> : <section className="empty-state"><div className="empty-icon"><History size={35}/><span>✦</span></div><h2>{t.noQueue}</h2><p>{t.noQueueHint}</p><button className="button primary" onClick={() => { setPage('converter'); void addFiles(); }}><Plus size={16}/>{t.addFiles}</button></section>}</>}
      {page === 'formats' && <><section className="page-heading"><div><div className="eyebrow"><span/> MADE FOR THE POSSIBILITIES</div><h1>{t.libraryTitle}</h1><p>{t.libraryHint}</p></div><span className="soft-badge">9 file families</span></section><div className="library-toolbar"><label className="library-search"><Search size={18}/><input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)}/><kbd>Ctrl K</kbd></label><button className="button" onClick={() => { setPage('settings'); setSettingsTab('engines'); }}><SlidersHorizontal size={16}/>{t.viewSettings}</button></div><div className="category-tabs" role="group" aria-label="Filter file families"><button className={familyFilter === 'all' ? 'active' : ''} onClick={() => setFamilyFilter('all')}>{t.allFormats}</button>{families.map(family => <button key={family.id} className={familyFilter === family.id ? 'active' : ''} onClick={() => setFamilyFilter(family.id)}>{family.label}</button>)}</div><div className="family-grid">{families.filter(family => (familyFilter === 'all' || family.id === familyFilter) && `${family.label} ${family.formats.join(' ')} ${family.engine}`.toLowerCase().includes(query.toLowerCase())).map(family => { const routes = data.capabilities.filter(cap => cap.available && cap.inputs.some(input => family.formats.some(format => format.toLowerCase() === input.toLowerCase()))); return <article className="family-card" key={family.id}><div className="section-row"><span className={`tool-icon ${family.color}`}><family.icon size={24}/></span><span className={`availability ${routes.length ? 'enabled' : ''}`}><span/>{routes.length ? t.available : isDesktop ? t.missing : t.nativeOnly}</span></div><h2>{family.label}</h2><p>{family.detail}</p><div className="format-chips">{family.formats.map(format => <span key={format}>{format}</span>)}</div><footer><span>{family.engine}</span><button aria-label={`Configure ${family.engine}`} onClick={() => { setSettingsTab('engines'); setPage('settings'); }}><ArrowUpRight size={17}/></button></footer></article>; })}</div><p className="library-disclaimer"><Info size={16}/>This is a format overview. The operation picker lists only verified routes for your selected files. SVG, PPT, XLS, and RAR are input-only where supported.</p></>}
      {page === 'settings' && <><section className="page-heading"><div><div className="eyebrow"><span/> MAKE YOURSELF AT HOME</div><h1>Your flow. Your way.</h1><p>{t.settingsHint}</p></div></section><div className="settings-layout"><nav className="settings-tabs" aria-label="Settings sections">{[{ id: 'general', label: t.general, icon: SlidersHorizontal }, { id: 'shortcuts', label: t.shortcuts, icon: Keyboard }, { id: 'engines', label: t.engines, icon: Package }, { id: 'privacy', label: t.privacy, icon: ShieldCheck }].map(tab => <button key={tab.id} className={settingsTab === tab.id ? 'active' : ''} onClick={() => setSettingsTab(tab.id)}><tab.icon size={17}/>{tab.label}<ChevronRight size={14}/></button>)}</nav><div className="settings-panel">{settingsTab === 'general' && <><h2>{t.general}</h2><SettingRow title={t.appearance} description="White surfaces with Santra orange accents."><span>Light</span></SettingRow><SettingRow title={t.outputFolder} description={settings.outputFolder || t.alongside}><button className="button small" onClick={() => void runSafe(async () => { const folder = await api.pickOutput(); if (folder) await saveSettings({ outputFolder: folder }); })}><Folder size={16}/>{t.chooseFolder}</button></SettingRow><SettingRow title={t.collision} description="Never silently overwrite an existing file."><select aria-label={t.collision} value={settings.collision} onChange={event => void saveSettings({ collision: event.target.value })}><option value="rename">{t.autoRename}</option><option value="ask">{t.ask}</option><option value="skip">{t.skip}</option></select></SettingRow><SettingRow title={t.concurrency} description="Keep your computer comfortable while files are processed."><select aria-label={t.concurrency} value={settings.concurrency} onChange={event => void saveSettings({ concurrency: Number(event.target.value) })}>{[1,2,3,4].map(count => <option key={count}>{count}</option>)}</select></SettingRow><SettingRow title={t.recursive} description={t.recursiveHelp}><Toggle label={t.recursive} checked={settings.recursive} onChange={value => void saveSettings({ recursive: value })}/></SettingRow><SettingRow title={t.strip} description="Remove identifying details when the selected engine supports it."><Toggle label={t.strip} checked={settings.stripMetadata} onChange={value => void saveSettings({ stripMetadata: value })}/></SettingRow><SettingRow title="Default quality" description={t.qualityHint}><select aria-label="Default quality" value={settings.quality} onChange={event => void saveSettings({ quality: Number(event.target.value) })}><option value="65">{t.small}</option><option value="85">{t.balanced}</option><option value="95">{t.high}</option></select></SettingRow><SettingRow title={settingsLabels.naming} description={settingsLabels.namingHint}><input className="naming-input" aria-label={settingsLabels.naming} defaultValue={settings.namingPattern} onBlur={event => { if (event.target.value !== settings.namingPattern) void saveSettings({ namingPattern: event.target.value }); }}/></SettingRow><SettingRow title={settingsLabels.tray} description={settingsLabels.trayHint}><Toggle label={settingsLabels.tray} checked={settings.tray} onChange={value => void saveSettings({ tray: value })}/></SettingRow>{settings.tray && <SettingRow title={settingsLabels.minimize} description={settingsLabels.minimizeHint}><Toggle label={settingsLabels.minimize} checked={!!settings.minimizeToTray} onChange={value => void saveSettings({ minimizeToTray: value })}/></SettingRow>}</>}{settingsTab === 'shortcuts' && <><h2>{t.shortcuts}</h2><p className="settings-intro">Double-tap your preferred modifier while dragging. The picker stays open until you drop or press Escape.</p>{(['convert', 'tools', 'actions'] as const).map(key => <SettingRow key={key} title={key === 'convert' ? t.convertKey : key === 'tools' ? t.toolsKey : t.actionsKey} description={key === 'convert' ? 'Change a file’s format.' : key === 'tools' ? 'Refine what’s inside.' : 'Organize without converting.'}><select aria-label={`${key} shortcut`} value={settings.shortcuts[key]} onChange={event => { const value = event.target.value; if (Object.entries(settings.shortcuts).some(([other, existing]) => other !== key && existing === value)) { setNotice('Each wheel needs a different shortcut.'); return; } void saveSettings({ shortcuts: { ...settings.shortcuts, [key]: value } }); }}>{['Shift','Alt','Control','Ctrl+Shift'].map(value => <option key={value}>{value}</option>)}</select></SettingRow>)}<div className="keyboard-callout"><Keyboard size={25}/><p>{t.keyboardHelp}</p></div></>}{settingsTab === 'engines' && <EngineSettings data={data} onSave={saveSettings} onNotice={setNotice}/>} {settingsTab === 'privacy' && <div className="privacy-settings"><span className="privacy-big-icon"><ShieldCheck size={34}/></span><h2>Private by nature.</h2><p>{t.privacyText}</p><div className="privacy-points">{['Zero uploads, including filenames and previews.', 'No accounts, ads, or conversion allowances.', 'Works without an internet connection.', 'Original files stay on your device.', 'Settings and interrupted job metadata are stored locally.'].map(text => <p key={text}><Check size={17}/>{text}</p>)}</div><small>Conversion tools are separate local processes. Install trusted builds and keep them updated. Local logs can contain paths; review diagnostic details before sharing.</small></div>}</div></div></>}
    </main><footer className="statusbar"><span><span className="status-dot"/>{activeJobs.length ? `${activeJobs.length} ${t.active}` : t.ready}</span><span>{isDesktop ? `${localCount} local engines · ${data.platform === 'win32' ? 'Windows' : 'Linux'}` : t.desktopPreview}<span className="statusbar-divider"/><LockKeyhole size={12}/>{t.noUploads}</span></footer></div>
    {notice && <div className="toast" role="status"><Info size={19}/><span>{notice}</span><button aria-label={t.close} onClick={() => setNotice('')}><X size={17}/></button></div>}
    {licenses && <Modal title="A small app. A shared effort." onClose={() => setLicenses(false)}><div className="guide-content license-content"><Orange sliced/><h3>Santra · 0.1.0 Preview</h3><p>Original citrus branding and application code. Santra is available under the MIT license.</p><div className="license-list">{[['React / React DOM', 'MIT'], ['Tauri', 'MIT or Apache-2.0; system WebView terms apply'], ['Lucide', 'ISC · Feather-derived icons: MIT'], ['Rust image and archive crates', 'See package inventory and upstream notices'], ['Optional local engines', 'Separate upstream licenses; not bundled']].map(([name, license]) => <div key={name}><strong>{name}</strong><span>{license}</span></div>)}</div><p>Dependency notices are in THIRD_PARTY_NOTICES.md. Optional tools such as FFmpeg and ExifTool use their own installed licenses; availability is detected locally.</p><button className="button full" onClick={() => setLicenses(false)}>{t.close}</button></div></Modal>}
    {picker && <Modal title={t.quickPick} onClose={() => setPicker(null)} wide>
      <div className="picker-file-summary"><Files size={19}/>{selectedFiles.length} {t.fileCount}<span>{selectedFiles.slice(0,2).map(file => file.name).join(', ')}{selectedFiles.length > 2 ? '…' : ''}</span></div>
      <div className="picker-tabs" role="tablist" aria-label="Operation groups">{(['convert','tools','actions'] as const).map(tab => <button key={tab} role="tab" aria-selected={picker === tab} className={picker === tab ? 'active' : ''} onClick={() => setPicker(tab)}>{tab === 'convert' ? <ArrowDownToLine size={17}/> : tab === 'tools' ? <WandSparkles size={17}/> : <Folder size={17}/>} {t[tab]}<kbd>{settings.shortcuts[tab]}</kbd></button>)}</div>
      {!!wheelItems(picker).length && <div className="picker-visual"><RadialWheel family={wheelFamily(selectedFiles)} sourceName={selectedFiles[0]?.name} sourceFile={selectedFiles[0]} label={picker === 'convert' ? 'Convert' : picker === 'tools' ? 'Tools' : 'File actions'} items={wheelItems(picker)} onChoose={id => chooseWheel(id, picker)}/></div>}
      {selectedFiles.length > 1 && <p className="wheel-context-note">Each operation shows its compatible files. Other selected files are explicitly skipped.</p>}
      <div className="picker-list-heading">All available operations</div>
      <div className="picker-options" onKeyDown={event => {
        if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const direction = ['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1;
        event.preventDefault(); buttons[(current + direction + buttons.length) % buttons.length]?.focus();
      }}>{picker === 'actions' ? actionItems.map(item => <button className="operation-choice" key={item.id} onClick={() => void fileAction(item.id)}><span className="tool-icon sand"><item.icon size={21}/></span><span><strong>{item.label}</strong><small>{item.id === 'preview' ? 'Always-on-top local preview' : 'Local file action'}</small></span><ChevronRight size={17}/></button>) : validRoutes(picker).length ? validRoutes(picker).flatMap(cap => (picker === 'convert' ? cap.outputs : ['']).map(format => <button className="operation-choice" key={`${cap.id}-${cap.backend}-${format}-${cap.category}`} onClick={() => pickRoute(cap, format || undefined)}><span className="tool-icon peach">{picker === 'convert' ? <File size={21}/> : <WandSparkles size={21}/>}</span><span><strong>{picker === 'convert' ? `${cap.label} · ${format.toUpperCase()}` : cap.label}</strong><small>{selectedFiles.filter(file => compatible(cap, file)).length} of {selectedFiles.length} files · {cap.backend}{cap.warning ? ' · Review fidelity warning' : ' · Processed locally'}</small></span><ChevronRight size={17}/></button>)) : <div className="picker-empty"><Package size={32}/><h3>{t.noRoutes}</h3><p>{!isDesktop ? t.previewNotice : t.noRoutesHint}</p><button className="button" onClick={() => { setPicker(null); setPage('settings'); setSettingsTab('engines'); }}>{t.viewSettings}<ArrowRight size={15}/></button></div>}</div>
      <footer className="picker-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Choose</span><span><kbd>Esc</kbd> Close</span></footer>
    </Modal>}
    {conversionEditor && <ConversionWindow {...conversionEditor} initialOptions={conversionEditor.options} onClose={()=>setConversionEditor(null)} onApply={(format,values)=>queueOperation(conversionEditor.capability,format,values,conversionEditor.files)}/>}
    {archiveEditor && <ArchiveWindow {...archiveEditor} initialOptions={archiveEditor.options} onClose={()=>setArchiveEditor(null)} onApply={(format,values)=>queueOperation(archiveEditor.capability,format,values,archiveEditor.files)}/>}
    {audioEditor && <AudioToolWindow {...audioEditor} initialOptions={audioEditor.options} onClose={()=>setAudioEditor(null)} onApply={(format,values)=>queueOperation(audioEditor.capability,format,values,audioEditor.files)}/>}
    {pdfEditor && <PdfWorkspace files={pdfEditor.files.filter(file => compatible(pdfEditor.capability, file))} capability={pdfEditor.capability} format={pdfEditor.format} initialOptions={pdfEditor.options} onClose={() => setPdfEditor(null)} loadPreview={file => api.preview ? api.preview(file.path) : Promise.reject(new Error('PDF preview needs the desktop app and Poppler.'))} onApply={async (format, values) => { await queueOperation(pdfEditor.capability, format, values, pdfEditor.files); setPdfEditor(null); }}/ >}
    {imageEditor && imageEditor.files[0] && <ImageToolWindow capability={imageEditor.capability} file={imageEditor.files[0]} format={imageEditor.format} initialOptions={imageEditor.options} onClose={() => setImageEditor(null)} onApply={async (format, values) => { await runSafe(async () => { await queueOperation(imageEditor.capability, format, values, imageEditor.files); setImageEditor(null); }); }}/ >}
    {guide && <Modal title={t.guide} onClose={() => setGuide(false)}><div className="guide-content"><Orange sliced/><p>{t.guideIntro}</p><div className="guide-keys">{([{ key: 'convert', label: t.convertKey }, { key: 'tools', label: t.toolsKey }, { key: 'actions', label: t.actionsKey }] as const).map(item => <div key={item.key}><kbd>{settings.shortcuts[item.key]}</kbd><span>{item.label}</span></div>)}</div><p>{t.keyboardHelp}</p><div className="privacy-callout"><ShieldCheck size={21}/><span>{t.noUploads}</span></div>{!isDesktop && <p className="inline-warning">{t.previewNotice}</p>}<button className="button primary full" onClick={() => setGuide(false)}>Let’s make something fresh<ArrowRight size={16}/></button></div></Modal>}
    {privacy && <Modal title="Private by nature." onClose={() => setPrivacy(false)}><div className="guide-content"><span className="privacy-big-icon"><ShieldCheck size={35}/></span><h3>{t.noUploads}</h3><p>{t.privacyText}</p><button className="button full" onClick={() => { setPrivacy(false); setSettingsTab('privacy'); setPage('settings'); }}>More about your local data<ArrowRight size={16}/></button></div></Modal>}
    {dragging && dragMode && <div className="drag-overlay wheel-overlay" aria-label="File drop target">
      {dragMode ? <div ref={floatingWheelRef} className="floating-wheel" style={{ left: wheelAnchor.x, top: wheelAnchor.y }}>
        <div className="wheel-mode-bar">{(['convert', 'tools', 'actions'] as const).map(mode => <button key={mode} className={mode === dragMode ? 'active' : ''} onDragEnter={() => activateWheel(mode)} onClick={() => activateWheel(mode)}><kbd>{settings.shortcuts[mode]}</kbd>{t[mode]}</button>)}</div>
        <RadialWheel family={wheelFamily(dragSource)} sourceName={dragSource[0]?.name} sourceFile={dragSource[0]} label={dragMode === 'convert' ? 'Convert' : dragMode === 'tools' ? 'Tools' : 'File actions'} subtitle={dragSource.some(file => !file.ext) ? 'Drop to inspect files and choose a supported operation' : 'Hover a slice, then drop'} dragging selected={wheelChoice} onHighlight={highlightWheel} onChoose={id => highlightWheel(id)} items={wheelItems(dragMode, dragSource)}/>
      </div> : <div className="drag-welcome"><Orange/><h2>Drop a little possibility.</h2><p>{t.dropHint}</p><div className="drag-shortcuts"><span><kbd>{settings.shortcuts.convert}</kbd>{t.convert}</span><span><kbd>{settings.shortcuts.tools}</kbd>{t.tools}</span><span><kbd>{settings.shortcuts.actions}</kbd>{t.actions}</span></div></div>}
      <div className="wheel-drag-hint">Release the key and keep dragging · Drop on a slice to choose · Esc to cancel</div>
    </div>}
  </div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>; }
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><div>{children}</div></div>; }
function JobRow({ job, onCancel, onRetry, onReveal, onOpen, onDiagnostic }: { job: Job; onCancel: () => void; onRetry: () => void; onReveal: () => void; onOpen: () => void; onDiagnostic: () => void }) { const active = ['queued','preparing','processing','publishing'].includes(job.status); return <article className={`job-row ${job.status}`}><div className={`job-icon ${job.status === 'completed' ? 'mint' : job.status === 'failed' ? 'rose' : 'sand'}`}>{job.status === 'completed' ? <Check size={23}/> : active ? <RefreshCw className={['processing','publishing'].includes(job.status) ? 'spin' : ''} size={21}/> : <File size={23}/>}</div><div className="job-details"><strong>{job.name || job.input?.split(/[\\/]/).pop()}</strong><span>{job.operation} {job.format && <><ArrowRight size={12}/>{job.format.toUpperCase()}</>}<span className="job-status">{job.status}</span></span>{active && <div className="progress-track" role="progressbar" aria-label={`Progress for ${job.name}`} aria-valuenow={job.progress || 0} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${job.progress || 0}%` }}/></div>}{job.error && <p className="job-error" role="alert">{job.error}</p>}{job.output && <small title={job.output}>{job.output}</small>}</div><div className="job-actions">{active && job.status !== 'publishing' && <button className="button small" onClick={onCancel}><X size={14}/>{t.cancel}</button>}{job.status === 'failed' && <><button className="icon-button" onClick={onDiagnostic} aria-label={t.diagnostics}><Clipboard size={17}/></button><button className="button small" onClick={onRetry}><RefreshCw size={14}/>{t.retry}</button></>}{job.status === 'completed' && <><button className="icon-button" aria-label={t.openFile} onClick={onOpen}><ArrowUpRight size={18}/></button><button className="button small" onClick={onReveal}><FolderOpen size={15}/>{t.reveal}</button></>}</div></article>; }
function EngineSettings({ data, onSave, onNotice }: { data: Snapshot; onSave: (patch: Partial<Settings>) => Promise<void>; onNotice: (text: string) => void }) { const [paths, setPaths] = useState(data.settings.backendPaths || {}); const names: Record<string,string> = { 'rust-image': 'Built-in images', 'rust-subtitles': 'Built-in subtitles', 'rust-archive': 'Built-in archives', exiftool: 'ExifTool · JPEG metadata', ffmpeg: 'FFmpeg', ffprobe: 'FFprobe', pandoc: 'Pandoc', libreoffice: 'LibreOffice', soffice: 'LibreOffice', pdftoppm: 'Poppler · pdftoppm', pdftotext: 'Poppler · pdftotext', qpdf: 'qpdf' }; const builtIn = new Set(['rust-image', 'rust-subtitles', 'rust-archive']); const keys = Object.keys(data.backends).length ? Object.keys(data.backends) : ['rust-image','rust-subtitles','rust-archive','ffmpeg','ffprobe','exiftool','pandoc','libreoffice','pdftoppm','pdftotext','qpdf']; return <><h2>{t.engines}</h2><p className="settings-intro">{t.engineHint}</p>{!isDesktop && <div className="inline-warning"><Monitor size={18}/>{t.previewNotice}</div>}<div className="engine-list">{keys.map(key => { const backend = data.backends[key]; return <div className="engine-row" key={key}><div className="section-row"><strong><Package size={17}/>{names[key] || key}</strong><span className={`availability ${backend?.available ? 'enabled' : ''}`}><span/>{backend?.available ? 'Detected' : 'Not detected'}</span></div>{backend?.version && <p className="engine-version">{String(backend.version).slice(0,150)}</p>}<input disabled={builtIn.has(key) || key === 'exiftool'} aria-label={`${names[key] || key} executable path`} placeholder={backend?.path || t.backendPath} value={builtIn.has(key) ? 'Included with Santra · no setup needed' : paths[key] || ''} onChange={event => setPaths(previous => ({ ...previous, [key]: event.target.value }))}/></div>; })}</div><button className="button primary" onClick={() => void onSave({ backendPaths: paths }).then(() => onNotice(t.saved))}><RefreshCw size={16}/>{t.rescan}</button><p className="fine-print">Optional tools are installed separately. Review their licenses before redistribution. No online fallback is used.</p></>; }
