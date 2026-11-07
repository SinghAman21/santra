import ReferenceEditor from '../../common/ReferenceEditor';
import { clock, cropRect, decimal, isAudioFormat, isEven, maskShape, type Mask, type MaskPoint, type MaskShape, type Preview, type SplitClip } from './media';
import './video-tool-window.css';
import CompressControls from './CompressControls';
import TrimControls from './TrimControls';
import SplitTracks, { clipError } from './SplitTracks';
import CropResizeControls, { ratios } from './CropResizeControls';
import RotateFlipControls from './RotateFlipControls';
import SpeedControls from './SpeedControls';
import FramesGifControls from './FramesGifControls';
import AudioOutputControls from './AudioOutputControls';
import MergeControls from './MergeControls';
import RedactTracks, { maskError } from './RedactTracks';
import StripMetadataControls from './StripMetadataControls';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import type { Capability, LocalFile } from '../../common/types';
import { api } from '../../common/bridge';

type Props = { capability: Capability; files: LocalFile[]; format: string; initialOptions: Record<string, unknown>; onClose: () => void; onApply: (format: string, options: Record<string, unknown>, orderedFiles: string[]) => Promise<unknown> };

const operationTitle: Record<string, string> = {
  compress: 'Compress video', trim: 'Trim video', split: 'Split video', merge: 'Join videos',
  'crop-resize': 'Crop & resize', 'rotate-flip': 'Rotate & flip', speed: 'Change speed',
  'frames-gif': 'Frames & GIF', 'audio-output': 'Mute & extract audio', redact: 'Redact video',
  'strip-metadata': 'Delete metadata',
};

const parseSegments = (text: string): SplitClip[] => text.split(',').map((part, index) => {
  const [start, end] = part.trim().split('-');
  return { id: `clip-${index}`, start: start?.trim() || '0', end: end?.trim() || '5' };
}).filter(clip => Number.isFinite(Number(clip.start)) && Number.isFinite(Number(clip.end)));

const initialClips = (options: Record<string, unknown>, duration: number): SplitClip[] => {
  const parsed = typeof options.segments === 'string' ? parseSegments(options.segments) : [];
  return parsed.length ? parsed : [{ id: 'clip-0', start: '0', end: decimal(Math.max(0.03, duration || 5)) }];
};

export default function VideoToolWindow({ capability, files: originalFiles, format: initialFormat, initialOptions, onClose, onApply }: Props) {
  const operation = capability.operation || capability.id.split(':').pop() || '';
  const title = operationTitle[operation] || capability.label;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<{ mode: 'draw' | 'move' | 'resize'; handle?: string; startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null);
  const drawRef = useRef<MaskPoint[] | null>(null);
  const [files, setFiles] = useState(originalFiles);
  const [format, setFormat] = useState(() => {
    if (operation === 'frames-gif' && !['png', 'gif'].includes(initialFormat)) return 'png';
    return initialFormat;
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [duration, setDuration] = useState(Number(initialOptions.duration) || 0);
  const [playhead, setPlayhead] = useState(0);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [intrinsic, setIntrinsic] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ratio, setRatio] = useState('Free');
  const [draft, setDraft] = useState<{ shape: MaskShape; points: MaskPoint[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialOptions).map(([key, value]) => [key, String(value)])));
  const [frames, setFrames] = useState<number[]>([]);
  const [masks, setMasks] = useState<Mask[]>(() => Array.isArray(initialOptions.masks) ? initialOptions.masks as Mask[] : []);
  const [clips, setClips] = useState<SplitClip[]>(() => initialClips(initialOptions, Number(initialOptions.duration) || 0));

  const file = files[0];
  const outputFormats = capability.outputs;
  const videoWidth = intrinsic.width || preview?.width || 0;
  const videoHeight = intrinsic.height || preview?.height || 0;
  const crop = cropRect(values, videoWidth, videoHeight);
  const shape = (values.redactShape || 'rect') as MaskShape;
  const start = Number(values.start ?? 0);
  const end = Number(values.end ?? (duration || 10));

  useEffect(() => {
    let active = true;
    if (!file || !api.preview) return;
    void api.preview(file.path).then(value => {
      if (!active) return;
      setPreview(value);
      setPreviewError('');
      if (value.duration) setDuration(value.duration);
    }).catch(reason => { if (active) setPreviewError(reason instanceof Error ? reason.message : String(reason)); });
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
    observer.observe(video);
    video.addEventListener('loadedmetadata', update);
    update();
    return () => { observer.disconnect(); video.removeEventListener('loadedmetadata', update); };
  }, [preview?.url, intrinsic.width, intrinsic.height]);

  useEffect(() => {
    if (duration > 0) setClips(current => current.map(clip => Number(clip.end) > duration + 0.02 ? { ...clip, end: decimal(duration) } : clip));
  }, [duration]);

  function set(key: string, value: string) { setValues(current => ({ ...current, [key]: value })); }

  function limit() { return previewTotal || preview?.previewDuration || duration || 0; }

  function seek(value: number) {
    const video = videoRef.current;
    const max = limit();
    if (!video || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(max || value, value));
    video.currentTime = next;
    setPlayhead(next);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || !ready) return;
    setPlaybackError('');
    try {
      if (video.ended || ended) {
        video.currentTime = 0;
        setPlayhead(0);
        setEnded(false);
      }
      if (video.paused) await video.play();
      else video.pause();
    } catch (reason) {
      setPlaybackError(reason instanceof Error ? reason.message : 'Playback could not start.');
    }
  }

  function point(event: PointerEvent<HTMLDivElement>): MaskPoint | null {
    const video = videoRef.current;
    if (!video || !videoWidth || !videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const x = Math.max(0, Math.min(videoWidth, (event.clientX - rect.left) / rect.width * videoWidth));
    const y = Math.max(0, Math.min(videoHeight, (event.clientY - rect.top) / rect.height * videoHeight));
    return { x: Math.round(x), y: Math.round(y) };
  }

  function normalizeCrop(rect: { x: number; y: number; width: number; height: number }) {
    const width = Math.max(2, Math.round(rect.width / 2) * 2);
    const height = Math.max(2, Math.round(rect.height / 2) * 2);
    const x = Math.max(0, Math.min(videoWidth - width, Math.round(rect.x)));
    const y = Math.max(0, Math.min(videoHeight - height, Math.round(rect.y)));
    return { x, y, width, height };
  }

  function writeCrop(rect: { x: number; y: number; width: number; height: number }) {
    const next = normalizeCrop(rect);
    setValues(current => ({ ...current, cropX: String(next.x), cropY: String(next.y), cropWidth: String(next.width), cropHeight: String(next.height) }));
  }

  function setCropRatio(value: string) {
    setRatio(value);
    const target = ratios[value];
    if (!target || !videoWidth || !videoHeight) return;
    const sourceRatio = videoWidth / videoHeight;
    const width = sourceRatio > target ? Math.floor(videoHeight * target / 2) * 2 : Math.floor(videoWidth / 2) * 2;
    const height = sourceRatio > target ? Math.floor(videoHeight / 2) * 2 : Math.floor(videoWidth / target / 2) * 2;
    writeCrop({ x: (videoWidth - width) / 2, y: (videoHeight - height) / 2, width, height });
  }

  function beginCrop(event: PointerEvent<HTMLDivElement>) {
    if (!videoWidth || !videoHeight) return;
    const target = point(event);
    if (!target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = cropRect(values, videoWidth, videoHeight);
    const handle = (event.target as HTMLElement).dataset.cropHandle;
    const explicit = values.cropWidth !== undefined && values.cropHeight !== undefined;
    const inside = explicit
      && target.x >= current.x && target.x <= current.x + current.width
      && target.y >= current.y && target.y <= current.y + current.height;
    cropDragRef.current = { mode: handle ? 'resize' : inside ? 'move' : 'draw', handle, startX: target.x, startY: target.y, ...current };
    if (!handle && !inside) writeCrop({ x: target.x, y: target.y, width: 2, height: 2 });
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || !videoWidth || !videoHeight) return;
    const target = point(event);
    if (!target) return;
    const dx = target.x - drag.startX;
    const dy = target.y - drag.startY;
    let { x, y, width, height } = drag;
    if (drag.mode === 'move') {
      x = Math.max(0, Math.min(videoWidth - width, x + dx));
      y = Math.max(0, Math.min(videoHeight - height, y + dy));
    } else if (drag.mode === 'draw') {
      x = Math.min(drag.startX, target.x);
      y = Math.min(drag.startY, target.y);
      width = Math.max(2, Math.abs(dx));
      height = Math.max(2, Math.abs(dy));
    } else {
      if (drag.handle?.includes('w')) { x = Math.max(0, Math.min(drag.x + drag.width - 2, drag.x + dx)); width = drag.x + drag.width - x; }
      if (drag.handle?.includes('e')) width = Math.max(2, Math.min(videoWidth - drag.x, drag.width + dx));
      if (drag.handle?.includes('n')) { y = Math.max(0, Math.min(drag.y + drag.height - 2, drag.y + dy)); height = drag.y + drag.height - y; }
      if (drag.handle?.includes('s')) height = Math.max(2, Math.min(videoHeight - drag.y, drag.height + dy));
    }
    setRatio('Free');
    writeCrop({ x, y, width, height });
  }

  function beginDraw(event: PointerEvent<HTMLDivElement>) {
    const target = point(event);
    if (!target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = [target];
    setDraft({ shape, points: [target] });
  }

  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    const points = drawRef.current;
    const target = point(event);
    if (!points || !target) return;
    if (shape === 'path') {
      const last = points[points.length - 1];
      if (Math.abs(last.x - target.x) + Math.abs(last.y - target.y) >= 2) {
        points.push(target);
        setDraft({ shape, points: [...points] });
      }
    } else {
      drawRef.current = [points[0], target];
      setDraft({ shape, points: [points[0], target] });
    }
  }

  function finishDraw(event: PointerEvent<HTMLDivElement>) {
    const points = drawRef.current;
    const target = point(event);
    drawRef.current = null;
    setDraft(null);
    if (!points?.length) return;
    const collected = shape === 'path' ? points : [points[0], target || points[points.length - 1]];
    if (shape === 'path' && collected.length < 2) return;
    const xs = collected.map(item => item.x);
    const ys = collected.map(item => item.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(2, Math.max(...xs) - x);
    const height = Math.max(2, Math.max(...ys) - y);
    if (width < 4 || height < 4) return;
    if (masks.length >= 16) return;
    const filled = values.maskFilled !== 'false';
    const stroke = Math.max(1, Math.min(64, Number(values.maskStroke) || 4));
    const maskEnd = Math.max(playhead + 0.03, duration || playhead + 5);
    setMasks(current => [...current, {
      shape,
      x,
      y,
      width,
      height,
      points: shape === 'path' ? collected : undefined,
      start: playhead,
      end: maskEnd,
      color: values.maskColor || '#000000',
      filled,
      stroke,
    }]);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (operation === 'crop-resize') beginCrop(event);
    else if (operation === 'redact') beginDraw(event);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (operation === 'crop-resize') moveCrop(event);
    else if (operation === 'redact') moveDraw(event);
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (operation === 'crop-resize') cropDragRef.current = null;
    else if (operation === 'redact') finishDraw(event);
  }

  const cropInvalid = operation === 'crop-resize' && (!videoWidth || !videoHeight || crop.width < 2 || crop.height < 2 || !isEven(crop.width) || !isEven(crop.height) || crop.x < 0 || crop.y < 0 || crop.x + crop.width > videoWidth || crop.y + crop.height > videoHeight);
  const resizeSet = values.width !== undefined || values.height !== undefined;
  const resizeInvalid = operation === 'crop-resize' && resizeSet && (Number(values.width) < 2 || Number(values.height) < 2 || !isEven(Number(values.width)) || !isEven(Number(values.height)));
  const splitInvalid = operation === 'split' && (clips.length === 0 || clips.some(clip => clipError(clip, duration)));
  const trimInvalid = operation === 'trim' && (!(end > start) || start < 0 || (duration > 0 && end > duration + 0.02));
  const gifRangeInvalid = operation === 'frames-gif' && format === 'gif' && (!(end > start) || start < 0 || (duration > 0 && end > duration + 0.02));
  const framesInvalid = operation === 'frames-gif' && format !== 'gif' && frames.length === 0;
  const redactInvalid = operation === 'redact' && (masks.length === 0 || masks.some(mask => maskError(mask, duration)));

  const validation = useMemo(() => {
    if (!files.length) return 'No video file is selected.';
    if (trimInvalid) return 'Choose a valid start and end within the video duration.';
    if (splitInvalid) return 'Every clip needs a valid start and end. Clips can overlap or sit on any track.';
    if (framesInvalid) return 'Add at least one frame before exporting.';
    if (gifRangeInvalid) return 'Choose a valid GIF range within the video.';
    if (cropInvalid) return 'Choose an even-sized crop rectangle inside the video frame.';
    if (resizeInvalid) return 'Output width and height must both be even and at least 2 pixels, or both blank.';
    if (redactInvalid) return masks.length === 0 ? 'Draw at least one redaction shape over the video.' : 'Each redaction track needs a valid time range within the video.';
    if (operation === 'merge' && files.length < 2) return 'Choose at least two video clips to join.';
    return '';
  }, [files.length, trimInvalid, splitInvalid, framesInvalid, gifRangeInvalid, cropInvalid, resizeInvalid, redactInvalid, masks.length, operation]);

  async function apply() {
    if (busy || validation) return;
    setBusy(true); setError('');
    try {
      const options: Record<string, unknown> = { quality: Number(values.quality || 75), bitrate: Number(values.bitrate || 128), stripMetadata: values.stripMetadata === 'true' };
      if (operation === 'trim') Object.assign(options, { start, duration: end - start });
      if (operation === 'split') Object.assign(options, { segments: clips.map(clip => `${Number(clip.start)}-${Number(clip.end)}`).join(',') });
      if (operation === 'frames-gif') {
        if (format === 'gif') Object.assign(options, { start, duration: end - start, fps: Number(values.fps || 12), width: Number(values.width || 480) });
        else Object.assign(options, { times: frames });
      }
      if (operation === 'crop-resize') {
        Object.assign(options, { cropX: crop.x, cropY: crop.y, cropWidth: crop.width, cropHeight: crop.height });
        if (resizeSet) Object.assign(options, { width: Number(values.width), height: Number(values.height) });
      }
      if (operation === 'rotate-flip') Object.assign(options, { angle: Number(values.angle || 0), direction: values.direction || 'none' });
      if (operation === 'speed') Object.assign(options, { factor: Number(values.factor || 1) });
      if (operation === 'merge') Object.assign(options, { reencode: values.reencode !== 'false' });
      if (operation === 'redact') Object.assign(options, {
        masks: masks.map(mask => ({
          x: Math.round(mask.x),
          y: Math.round(mask.y),
          width: Math.max(2, Math.round(mask.width)),
          height: Math.max(2, Math.round(mask.height)),
          start: mask.start,
          end: mask.end,
          color: mask.color,
          shape: maskShape(mask),
          points: mask.points,
          filled: mask.filled !== false,
          stroke: Math.max(1, Math.min(64, Number(mask.stroke) || 4)),
        })),
      });
      await onApply(format, options, files.map(item => item.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  function reset() {
    setValues(Object.fromEntries(Object.entries(initialOptions).map(([key, value]) => [key, String(value)])));
    setFiles(originalFiles);
    setFormat(operation === 'frames-gif' && !['png', 'gif'].includes(initialFormat) ? 'png' : initialFormat);
    setFrames([]);
    setMasks(Array.isArray(initialOptions.masks) ? initialOptions.masks as Mask[] : []);
    setClips(initialClips(initialOptions, duration));
    setRatio('Free');
    setError('');
    seek(0);
  }

  const selectionStyle = (rectangle: { x: number; y: number; width: number; height: number }): CSSProperties => ({
    left: bounds.left + rectangle.x / (videoWidth || 1) * bounds.width,
    top: bounds.top + rectangle.y / (videoHeight || 1) * bounds.height,
    width: rectangle.width / (videoWidth || 1) * bounds.width,
    height: rectangle.height / (videoHeight || 1) * bounds.height,
  });

  const maskStyle = (mask: Mask): CSSProperties => selectionStyle(mask);

  const renderShape = (mask: Mask, key: string, outline: boolean) => {
    const color = mask.color || '#000000';
    const filled = mask.filled !== false;
    const stroke = mask.stroke || 4;
    const active = playhead >= mask.start && playhead <= mask.end;
    const common = {
      fill: filled ? color : 'none',
      stroke: filled ? '#ff5a00' : color,
      strokeWidth: filled ? 1 : stroke,
      opacity: active ? 0.86 : 0.3,
    };
    if (maskShape(mask) === 'circle') {
      return <ellipse key={key} cx={mask.x + mask.width / 2} cy={mask.y + mask.height / 2} rx={mask.width / 2} ry={mask.height / 2} {...common}/>;
    }
    if (maskShape(mask) === 'triangle') {
      const points = mask.points && mask.points.length >= 3
        ? mask.points
        : [{ x: mask.x + mask.width / 2, y: mask.y }, { x: mask.x, y: mask.y + mask.height }, { x: mask.x + mask.width, y: mask.y + mask.height }];
      return <polygon key={key} points={points.map(item => `${item.x},${item.y}`).join(' ')} {...common}/>;
    }
    if (maskShape(mask) === 'path') {
      const points = (mask.points || []).map(item => `${item.x},${item.y}`).join(' ');
      if (!points) return null;
      return filled
        ? <polygon key={key} points={points} {...common}/>
        : <polyline key={key} points={points} fill="none" stroke={color} strokeWidth={stroke} opacity={active ? 0.86 : 0.3}/>;
    }
    return <rect key={key} x={mask.x} y={mask.y} width={mask.width} height={mask.height} {...common}/>;
  };

  const draftPoints = draft ? draft.shape === 'path' ? draft.points : [draft.points[0], draft.points[draft.points.length - 1]].filter(Boolean) : [];
  const draftBounds = draftPoints.length >= 2 ? {
    x: Math.min(...draftPoints.map(item => item.x)),
    y: Math.min(...draftPoints.map(item => item.y)),
    width: Math.max(2, Math.abs(draftPoints[draftPoints.length - 1].x - draftPoints[0].x)),
    height: Math.max(2, Math.abs(draftPoints[draftPoints.length - 1].y - draftPoints[0].y)),
  } : null;

  const previewNode = <>
    <div className="video-preview-shell">
      <div className={`video-tool-stage ${operation === 'redact' ? 'is-drawing' : ''}`} ref={stageRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { cropDragRef.current = null; drawRef.current = null; setDraft(null); }}>
        {preview?.url
          ? <video
              ref={videoRef}
              src={preview.url}
              playsInline
              preload="metadata"
              aria-label={`Local video preview of ${file?.name}`}
              onLoadedMetadata={event => {
                const video = event.currentTarget;
                setIntrinsic({ width: video.videoWidth, height: video.videoHeight });
                const total = Number.isFinite(video.duration) ? video.duration : 0;
                setPreviewTotal(total);
                setReady(Boolean(video.videoWidth));
                if (!duration && Number.isFinite(video.duration)) setDuration(video.duration);
                setPlayhead(video.currentTime);
              }}
              onCanPlay={() => setReady(true)}
              onPlay={() => { setPlaying(true); setEnded(false); setPlaybackError(''); }}
              onPause={() => setPlaying(false)}
              onEnded={() => { setPlaying(false); setEnded(true); }}
              onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)}
              onError={() => { setReady(false); setPlaying(false); setPlaybackError('This video could not be played locally.'); }}
            />
          : <div className="video-tool-preview-empty">{previewError || 'Preparing local preview…'}</div>}
        {operation === 'crop-resize' && videoWidth > 0 && videoHeight > 0 && bounds.width > 0 && (
          <div className="video-crop-frame" style={selectionStyle(crop)} aria-label="Crop area">
            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <span key={handle} data-crop-handle={handle} className={`crop-handle ${handle}`} aria-hidden="true"/>)}
          </div>
        )}
        {operation === 'redact' && videoWidth > 0 && videoHeight > 0 && bounds.width > 0 && (
          <svg className="video-mask-layer" viewBox={`0 0 ${videoWidth} ${videoHeight}`} preserveAspectRatio="none" style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }} aria-hidden="true">
            {masks.map((mask, index) => renderShape(mask, `mask-${index}`, false))}
            {draft && draftBounds && (draft.shape === 'path'
              ? <polyline points={draft.points.map(item => `${item.x},${item.y}`).join(' ')} fill="none" stroke={values.maskColor || '#000000'} strokeWidth={values.maskStroke || 4} opacity={0.7}/>
              : draft.shape === 'circle'
                ? <ellipse cx={draftBounds.x + draftBounds.width / 2} cy={draftBounds.y + draftBounds.height / 2} rx={draftBounds.width / 2} ry={draftBounds.height / 2} fill={values.maskColor || '#000000'} opacity={0.55}/>
                : draft.shape === 'triangle'
                  ? <polygon points={`${draftBounds.x + draftBounds.width / 2},${draftBounds.y} ${draftBounds.x},${draftBounds.y + draftBounds.height} ${draftBounds.x + draftBounds.width},${draftBounds.y + draftBounds.height}`} fill={values.maskColor || '#000000'} opacity={0.55}/>
                  : <rect x={draftBounds.x} y={draftBounds.y} width={draftBounds.width} height={draftBounds.height} fill={values.maskColor || '#000000'} opacity={0.55}/>)}
          </svg>
        )}
        {playbackError && <div className="video-playback-error" role="alert">{playbackError}</div>}
        {!preview?.url && previewError && <div className="video-playback-error" role="alert">{previewError}</div>}
        {videoWidth > 0 && videoHeight > 0 && <span className="video-tool-dimensions">{videoWidth} × {videoHeight} px</span>}
      </div>
      <div className="video-preview-bar">
        <div className="video-tool-transport">
          <button type="button" aria-label="Seek backward one second" disabled={!ready} onClick={() => seek(playhead - 1)}><SkipBack size={14}/></button>
          <button type="button" className="video-play-toggle" aria-label={ended ? 'Replay video' : playing ? 'Pause video' : 'Play video'} disabled={!ready} onClick={() => void togglePlayback()}>{ended ? <RotateCcw size={15}/> : playing ? <Pause size={15}/> : <Play size={15}/>}</button>
          <button type="button" aria-label="Seek forward one second" disabled={!ready} onClick={() => seek(playhead + 1)}><SkipForward size={14}/></button>
          <span className="video-time">{clock(playhead)} / {clock(previewTotal || duration)}</span>
        </div>
        <input className="video-tool-seek" aria-label="Video preview timeline" type="range" min="0" max={Math.max(previewTotal || duration, 0.01)} step="0.01" value={Math.min(playhead, previewTotal || duration || playhead)} onChange={event => seek(Number(event.target.value))} disabled={!ready}/>
        <p className="video-tool-fileinfo">{file?.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ''}{videoWidth && videoHeight ? ` · ${videoWidth} × ${videoHeight}` : ''}{duration ? ` · ${clock(duration)}` : ''}{preview?.previewDuration && duration > preview.previewDuration ? ' · previews first 30 s' : ''}</p>
      </div>
    </div>
  </>;

  const settingsNode = <div className="video-settings-grid">
    {outputFormats.length > 1 && <label className="video-tool-field">Output format
      <select aria-label="Output format" value={format} onChange={event => setFormat(event.target.value)}>{outputFormats.map(output => <option key={output} value={output}>{output.toUpperCase()}</option>)}</select>
    </label>}
    {operation === 'compress' && <CompressControls values={values} set={set}/>}
    {operation === 'trim' && <TrimControls duration={duration} values={values} set={set} playhead={playhead}/>}
    {operation === 'split' && <SplitTracks clips={clips} setClips={setClips} duration={duration} playhead={playhead}/>}
    {operation === 'crop-resize' && <CropResizeControls values={values} set={set} videoWidth={videoWidth} videoHeight={videoHeight} ratio={ratio} setRatio={setRatio} setCropRatio={setCropRatio}/>}
    {operation === 'rotate-flip' && <RotateFlipControls values={values} set={set}/>}
    {operation === 'speed' && <SpeedControls values={values} set={set}/>}
    {operation === 'frames-gif' && <FramesGifControls format={format} values={values} set={set} frames={frames} setFrames={setFrames} playhead={playhead} seek={seek} duration={duration}/>}
    {operation === 'audio-output' && <AudioOutputControls format={format} outputs={outputFormats} setFormat={setFormat}/>}
    {operation === 'merge' && <MergeControls values={values} set={set} files={files} setFiles={setFiles}/>}
    {operation === 'redact' && <RedactTracks masks={masks} setMasks={setMasks} duration={duration} values={values} set={set} playhead={playhead}/>}
    {operation === 'strip-metadata' && <StripMetadataControls preview={preview} previewError={previewError}/>}
    {operation === 'compress' && <label className="video-tool-check video-settings-wide"><input type="checkbox" checked={values.stripMetadata === 'true'} onChange={event => set('stripMetadata', String(event.target.checked))}/> Remove copied metadata</label>}
  </div>;

  return <ReferenceEditor
    title={title}
    ariaLabel={title}
    subtitle={<>{file?.name}{videoWidth && videoHeight ? ` · ${videoWidth} × ${videoHeight}` : ''}{duration ? ` · ${clock(duration)}` : ''}</>}
    layout="stacked"
    preview={previewNode}
    settings={settingsNode}
    notice={validation || error || capability.warning || 'The original is kept. Output is processed locally.'}
    error={Boolean(error)}
    output={`New ${format.toUpperCase()} copy · ${file?.name || 'selection'}`}
    busy={busy}
    disabled={Boolean(validation)}
    onClose={onClose}
    onReset={reset}
    onSubmit={apply}
  />;
}
