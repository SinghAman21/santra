import { Checkbox } from '../../common/ui/checkbox';
import { Slider as ShadcnSlider } from '../../common/ui/slider';
import { Button as UiNativeButton, Input as UiNativeInput, NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import ReferenceEditor from '../../common/ReferenceEditor';
import { decimal, clock, type Mask, type Preview } from './media';
import './video-tool-window.css';
import CompressControls from './CompressControls';
import TrimControls from './TrimControls';
import SplitControls from './SplitControls';
import CropControls from './CropControls';
import ResizeControls from './ResizeControls';
import RotateControls from './RotateControls';
import FlipControls from './FlipControls';
import SpeedControls from './SpeedControls';
import GifControls from './GifControls';
import ExtractAudioControls from './ExtractAudioControls';
import MuteControls from './MuteControls';
import SnapshotControls from './SnapshotControls';
import MergeControls from './MergeControls';
import RedactControls from './RedactControls';
import StripMetadataControls from './StripMetadataControls';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, Pause, Play, Plus, RotateCcw, Scissors, Trash2, X } from 'lucide-react';
import type { Capability, LocalFile } from '../../common/types';
import { api } from '../../common/bridge';

type Props = { capability: Capability; files: LocalFile[]; format: string; initialOptions: Record<string, unknown>; onClose: () => void; onApply: (format: string, options: Record<string, unknown>, orderedFiles: string[]) => Promise<unknown> };

const operationTitle: Record<string, string> = {
  compress: 'Compress video', trim: 'Trim video', split: 'Split video', merge: 'Join videos', crop: 'Crop video',
  speed: 'Change speed', snapshot: 'Extract frames', mute: 'Remove audio', redact: 'Redact video',
  'strip-metadata': 'Delete metadata', resize: 'Resize video', rotate: 'Rotate video', flip: 'Flip video',
  gif: 'Create GIF', 'extract-audio': 'Extract audio',
};

export default function VideoToolWindow({ capability, files: originalFiles, format: initialFormat, initialOptions, onClose, onApply }: Props) {
  const operation = capability.operation || capability.id.split(':').pop() || '';
  const title = operationTitle[operation] || capability.label;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [files, setFiles] = useState(originalFiles);
  const [format, setFormat] = useState(initialFormat);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [duration, setDuration] = useState(Number(initialOptions.duration) || 0);
  const [playhead, setPlayhead] = useState(0);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialOptions).map(([key, value]) => [key, String(value)])));
  const [frames, setFrames] = useState<number[]>([]);
  const [masks, setMasks] = useState<Mask[]>(() => Array.isArray(initialOptions.masks) ? initialOptions.masks as Mask[] : []);

  const file = files[0];
  const outputFormats = capability.outputs;
  const videoWidth = preview?.width || videoRef.current?.videoWidth || 0;
  const videoHeight = preview?.height || videoRef.current?.videoHeight || 0;
  const segmentsText = values.segments ?? `0-${decimal(duration || 5)}`;
  const cropX = values.x === undefined ? 0 : Number(values.x);
  const cropY = values.y === undefined ? 0 : Number(values.y);
  const cropWidth = values.width === undefined ? videoWidth : Number(values.width);
  const cropHeight = values.height === undefined ? videoHeight : Number(values.height);
  const resizeWidth = values.width === undefined ? videoWidth || 1280 : Number(values.width);
  const resizeHeight = values.height === undefined ? videoHeight || 720 : Number(values.height);
  const validSplit = useMemo(() => {
    if (operation !== 'split') return true;
    const segments = segmentsText.split(',').map(part => part.trim());
    let previousEnd = -1;
    return segments.length > 0 && segments.length <= 100 && segments.every(part => {
      const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(part);
      if (!match) return false;
      const start = Number(match[1]), end = Number(match[2]);
      const valid = end > start && start >= previousEnd && (!duration || end <= duration + 0.02);
      previousEnd = end;
      return valid;
    });
  }, [duration, operation, segmentsText]);

  useEffect(() => {
    let active = true;
    if (!file || !api.preview) return;
    void api.preview(file.path).then(value => { if (active) { setPreview(value); setPreviewError(''); if (value.duration) setDuration(value.duration); } }).catch(reason => { if (active) setPreviewError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [file?.path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;
    const update = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const stageRect = stage.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      setBounds({ left: videoRect.left - stageRect.left, top: videoRect.top - stageRect.top, width: videoRect.width, height: videoRect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    video.addEventListener('loadedmetadata', update);
    update();
    return () => { observer.disconnect(); video.removeEventListener('loadedmetadata', update); };
  }, [preview?.url]);

  function set(key: string, value: string) { setValues(current => ({ ...current, [key]: value })); }
  function seek(value: number) { if (videoRef.current && Number.isFinite(value)) videoRef.current.currentTime = Math.max(0, Math.min(preview?.previewDuration || duration || value, value)); }

  function point(event: PointerEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !videoWidth || !videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const x = Math.max(0, Math.min(videoWidth, (event.clientX - rect.left) / rect.width * videoWidth));
    const y = Math.max(0, Math.min(videoHeight, (event.clientY - rect.top) / rect.height * videoHeight));
    return { x: Math.round(x / 2) * 2, y: Math.round(y / 2) * 2 };
  }

  function beginMask(event: PointerEvent<HTMLDivElement>) {
    if (!['crop', 'redact'].includes(operation) || !videoWidth || !videoHeight) return;
    const target = point(event);
    if (!target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = target;
  }

  function finishMask(event: PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    if (!start) return;
    pointerRef.current = null;
    const end = point(event);
    if (!end) return;
    const rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    if (rect.width < 4 || rect.height < 4) return;
    if (operation === 'crop') {
      set('x', String(rect.x)); set('y', String(rect.y)); set('width', String(rect.width)); set('height', String(rect.height));
    } else if (masks.length < 16) {
      setMasks(current => [...current, { ...rect, start: playhead, end: duration || 604800, color: values.maskColor || '#000000' }]);
    }
  }

  const start = Number(values.start) || 0;
  const end = values.end === undefined ? duration : Number(values.end);
  let validation = '';
  if (!files.length) validation = 'No video file is selected.';
  else if (operation === 'trim' && (!(end > start) || (duration > 0 && end > duration))) validation = 'Choose a valid start and end within the video duration.';
  else if (operation === 'split' && !validSplit) validation = 'Enter valid ordered time ranges within the video duration, such as 0-5, 8-12.';
  else if (operation === 'merge' && files.length < 2) validation = 'Choose at least two video clips to join.';
  else if (operation === 'snapshot' && frames.length === 0) validation = 'Seek to a frame and add it before exporting.';
  else if (operation === 'redact' && masks.length === 0) validation = 'Draw at least one redaction box over the video.';
  else if (operation === 'redact' && masks.some(mask => mask.end <= mask.start || mask.start < 0 || (duration > 0 && mask.end > duration))) validation = 'Each redaction mask needs a valid time range within the video.';
  else if (operation === 'crop' && (!videoWidth || !videoHeight || cropWidth < 2 || cropHeight < 2 || cropWidth % 2 || cropHeight % 2 || cropX < 0 || cropY < 0 || cropX + cropWidth > videoWidth || cropY + cropHeight > videoHeight)) validation = 'Choose an even-sized crop rectangle inside the video frame.';
  else if (operation === 'resize' && (resizeWidth < 2 || resizeHeight < 2 || resizeWidth % 2 || resizeHeight % 2)) validation = 'Choose even output width and height values of at least 2 pixels.';

  async function apply() {
    if (busy || validation) return;
    setBusy(true); setError('');
    try {
      const options: Record<string, unknown> = { quality: Number(values.quality || 75), bitrate: Number(values.bitrate || 128), stripMetadata: values.stripMetadata === 'true' };
      if (operation === 'trim') Object.assign(options, { start, duration: end - start });
      if (operation === 'split') Object.assign(options, { segments: segmentsText });
      if (operation === 'snapshot') Object.assign(options, { times: frames });
      if (operation === 'crop') Object.assign(options, { x: cropX, y: cropY, width: cropWidth, height: cropHeight });
      if (operation === 'resize') Object.assign(options, { width: resizeWidth, height: resizeHeight });
      if (operation === 'speed') Object.assign(options, { factor: Number(values.factor || 1) });
      if (operation === 'rotate') Object.assign(options, { angle: Number(values.angle || 90) });
      if (operation === 'flip') Object.assign(options, { direction: values.direction || 'horizontal' });
      if (operation === 'gif') Object.assign(options, { fps: Number(values.fps || 12), width: Number(values.width || 480) });
      if (operation === 'merge') Object.assign(options, { reencode: values.reencode !== 'false' });
      if (operation === 'redact') Object.assign(options, { masks });
      await onApply(format, options, files.map(item => item.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  const selectionStyle = (rectangle: { x: number; y: number; width: number; height: number }): CSSProperties => ({
    left: bounds.left + rectangle.x / (videoWidth || 1) * bounds.width,
    top: bounds.top + rectangle.y / (videoHeight || 1) * bounds.height,
    width: rectangle.width / (videoWidth || 1) * bounds.width,
    height: rectangle.height / (videoHeight || 1) * bounds.height,
  });

  return <ReferenceEditor title={title.replace(/ video$/i,'')} ariaLabel={title} subtitle={<>{file?.name}{videoWidth && videoHeight ? ` · ${videoWidth} × ${videoHeight}` : ''}{duration ? ` · ${clock(duration)}` : ''}</>} preview={<><span>Local preview · original</span>        <div className="video-tool-main">
          <div className="video-tool-stage" ref={stageRef} onPointerDown={beginMask} onPointerUp={finishMask} onPointerCancel={() => { pointerRef.current = null; }}>
            {preview?.url ? <video ref={videoRef} src={preview.url} playsInline preload="metadata" aria-label={`Local video preview of ${file?.name}`} onLoadedMetadata={event => { const current = event.currentTarget; if (Number.isFinite(current.duration) && !preview.duration) setDuration(current.duration); setPlayhead(current.currentTime); }} onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)}/> : <div className="video-tool-preview-empty">{previewError || 'Preparing local preview…'}</div>}
            {operation === 'crop' && videoWidth && videoHeight && bounds.width > 0 && <div className="video-tool-box video-tool-crop" style={selectionStyle({ x: cropX, y: cropY, width: cropWidth, height: cropHeight })} aria-label="Crop area"/>}
            {operation === 'redact' && masks.map((mask, index) => <div className="video-tool-box video-tool-mask" key={`${index}-${mask.x}-${mask.y}`} style={{ ...selectionStyle(mask), backgroundColor: mask.color }} aria-label={`Redaction mask ${index + 1}`}>{index + 1}</div>)}
            {preview?.width && preview.height && <span className="video-tool-dimensions">{preview.width} × {preview.height} px</span>}
          </div>
          <div className="video-tool-transport"><UiNativeButton type="button" aria-label="Seek backward one second" onClick={() => seek(playhead - 1)}><RotateCcw size={15}/></UiNativeButton><UiNativeButton type="button" aria-label="Play video" onClick={() => void videoRef.current?.play()}><Play size={15}/></UiNativeButton><UiNativeButton type="button" aria-label="Pause video" onClick={() => videoRef.current?.pause()}><Pause size={15}/></UiNativeButton><span>{clock(playhead)} / {clock(duration)}</span></div>
          <ShadcnSlider className="video-tool-seek" aria-label="Video preview timeline" min={0} max={Math.max(Math.min(duration, preview?.previewDuration || duration), 0.01)} step={0.01} value={[Math.min(playhead, preview?.previewDuration || duration || playhead)]} onValueChange={([value]) => seek(value)} disabled={!duration}/>
          {preview?.previewDuration && <p className="video-tool-fileinfo">Playback previews the first 30 seconds. Time fields can target the full source.</p>}
          <p className="video-tool-fileinfo">{file?.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ''}{preview?.width && preview.height ? ` · ${preview.width} × ${preview.height}` : ''}{duration ? ` · ${clock(duration)}` : ''}</p>
        </div>
</>} settings={<div className="video-tool-controls">

          {outputFormats.length > 1 && <label className="video-tool-field">Output format<UiNativeSelect aria-label="Output format" value={format} onChange={event => setFormat(event.target.value)}>{outputFormats.map(output => <option key={output} value={output}>{output.toUpperCase()}</option>)}</UiNativeSelect></label>}
          {operation === 'compress' && <CompressControls values={values} set={set}/ >}
          {operation === 'trim' && <TrimControls duration={duration} values={values} set={set} playhead={playhead}/ >}
          {operation === 'split' && <SplitControls segmentsText={segmentsText} set={set} playhead={playhead} duration={duration}/ >}
          {operation === 'crop' && <CropControls values={values} videoWidth={videoWidth} videoHeight={videoHeight} set={set}/ >}
          {operation === 'resize' && <ResizeControls values={values} videoWidth={videoWidth} set={set} videoHeight={videoHeight}/ >}
          {operation === 'rotate' && <RotateControls values={values} set={set}/ >}
          {operation === 'flip' && <FlipControls values={values} set={set}/ >}
          {operation === 'speed' && <SpeedControls values={values} set={set}/ >}
          {operation === 'gif' && <GifControls values={values} set={set}/ >}
          {operation === 'extract-audio' && <ExtractAudioControls / >}
          {operation === 'mute' && <MuteControls / >}
          {operation === 'snapshot' && <SnapshotControls setFrames={setFrames} playhead={playhead} frames={frames} seek={seek}/ >}
          {operation === 'merge' && <MergeControls values={values} set={set} files={files} setFiles={setFiles}/ >}
          {operation === 'redact' && <RedactControls masks={masks} duration={duration} setMasks={setMasks} values={values} set={set}/ >}
          {operation === 'strip-metadata' && <StripMetadataControls preview={preview} previewError={previewError}/ >}
          {operation === 'compress' && <label className="video-tool-check"><Checkbox checked={values.stripMetadata === 'true'} onCheckedChange={checked => set('stripMetadata', String(checked === true))}/> Remove copied metadata</label>}

        </div>} notice={validation || error || capability.warning || 'The original is kept. Output is processed locally.'} error={Boolean(error)} output={`New ${format.toUpperCase()} copy · ${file?.name || 'selection'}`} busy={busy} disabled={Boolean(validation)} onClose={onClose} onReset={()=>{setValues(Object.fromEntries(Object.entries(initialOptions).map(([key,value])=>[key,String(value)])));setFiles(originalFiles);setFormat(initialFormat);setFrames([]);setMasks(Array.isArray(initialOptions.masks)?initialOptions.masks as Mask[]:[]);setError('');seek(0)}} onSubmit={apply}/>;
}
