import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors } from 'lucide-react';
import { api } from '../../common/bridge';
import { Button, Input } from '../../common/ui/primitives';
import { clock } from './media';

export type TimelineSelection = { start: number; end: number };
export type SplitPoint = { id: string; timeSeconds: number };
type Props = {
  duration: number; currentTime: number; fps?: number; variableFrameRate?: boolean; frameTimestamps?: number[];
  mode?: 'view' | 'trim' | 'split' | 'select' | 'snapshot' | 'redact'; selection?: TimelineSelection;
  splitPoints?: SplitPoint[]; onSeek?: (time: number) => void; onSelectionChange?: (start: number, end: number) => void;
  onAddSplit?: (time: number) => void; onSplitPointChange?: (id: string, time: number) => void;
};

const thumbnailCache = new Map<string, { time: number; url: string }[]>();
const FrameStrip = memo(function FrameStrip({ start, end, count }: { start: number; end: number; count: number }) {
  const key = `${start.toFixed(3)}:${end.toFixed(3)}:${count}`;
  const [frames, setFrames] = useState(() => thumbnailCache.get(key) || []);
  const [error, setError] = useState('');
  useEffect(() => {
    const cached = thumbnailCache.get(key);
    if (cached) { setFrames(cached); setError(''); return; }
    let active = true;
    setFrames([]); setError('');
    if (!api.videoTimelineThumbnails) { setError('Timeline thumbnails require the desktop FFmpeg backend.'); return; }
    void api.videoTimelineThumbnails({ start, end, count, width: 160 }).then(result => {
      if (!active) return;
      thumbnailCache.set(key, result.frames);
      while (thumbnailCache.size > 24) thumbnailCache.delete(thumbnailCache.keys().next().value!);
      setFrames(result.frames);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [key, start, end, count]);
  if (error) return <span className="timeline-thumbnail-error" role="status">{error}</span>;
  return <div className="video-timeline-frames" aria-label="FFmpeg timeline thumbnails">{frames.map(frame => <span key={`${frame.time}-${frame.url.length}`} style={{ left: `${(frame.time - start) / Math.max(.001, end - start) * 100}%`, width: `${100 / count + .5}%`, backgroundImage: `url("${frame.url}")` }} />)}</div>;
});

export const timeToFrame = (time: number, fps: number) => Math.max(0, Math.round(time * fps));
export const frameToTime = (frame: number, fps: number) => fps > 0 ? Math.max(0, frame) / fps : 0;
export const formatTime = clock;
export const positionToTime = (position: number, duration: number) => Math.max(0, Math.min(1, position)) * duration;
export const timeToPosition = (time: number, duration: number) => duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;

export default function VideoTimeline({ duration, currentTime, fps, variableFrameRate = false, frameTimestamps = [], mode = 'view', selection, splitPoints = [], onSeek, onSelectionChange, onAddSplit, onSplitPointChange }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'seek' | 'start' | 'end' | `split:${string}` | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 800, left: 0 });
  const averageStep = fps && fps > 0 ? 1 / fps : .04;
  const trackWidth = Math.max(viewport.width, duration * zoom);
  const scale = trackWidth / Math.max(duration, .001);
  const visibleStart = viewport.left / scale;
  const visibleEnd = Math.min(duration, (viewport.left + viewport.width) / scale);
  const quantum = Math.max(averageStep, (visibleEnd - visibleStart) / 4);
  const sampleStart = Math.max(0, Math.floor(visibleStart / quantum) * quantum);
  const sampleEnd = Math.min(duration, Math.max(sampleStart + averageStep, Math.ceil(visibleEnd / quantum) * quantum));
  const thumbnailCount = Math.max(6, Math.min(32, Math.ceil((sampleEnd - sampleStart) * scale / 72)));
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const resize = () => setViewport(value => ({ ...value, width: scroll.clientWidth }));
    const observer = new ResizeObserver(resize); observer.observe(scroll); resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || dragRef.current) return;
    const x = currentTime * scale;
    if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 20) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
  }, [currentTime, scale, viewport.width]);
  const frameTicks = !!fps && scale * averageStep >= 8;
  const target = 80 / Math.max(scale, .001);
  const interval = frameTicks ? averageStep : [ .01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 86400 ].find(value => value >= target) || 86400;
  const ticks = useMemo(() => {
    const first = Math.floor(visibleStart / interval), last = Math.ceil(visibleEnd / interval);
    return Array.from({ length: Math.min(300, Math.max(0, last - first + 1)) }, (_, i) => (first + i) * interval);
  }, [visibleStart, visibleEnd, interval]);
  const snap = (time: number) => {
    const clamped = Math.max(0, Math.min(duration, time));
    if (variableFrameRate && frameTimestamps.length && clamped <= frameTimestamps[frameTimestamps.length - 1] + .1) return frameTimestamps.reduce((nearest, value) => Math.abs(value - clamped) < Math.abs(nearest - clamped) ? value : nearest, frameTimestamps[0]);
    return fps ? Math.round(clamped * fps) / fps : clamped;
  };
  function move(clientX: number) {
    const rect = stripRef.current?.getBoundingClientRect(); if (!rect) return;
    const time = snap((clientX - rect.left) / scale);
    if (dragRef.current === 'start' && selection) onSelectionChange?.(Math.min(time, Math.max(0, selection.end - averageStep)), selection.end);
    else if (dragRef.current === 'end' && selection) onSelectionChange?.(selection.start, Math.max(time, Math.min(duration, selection.start + averageStep)));
    else if (dragRef.current?.startsWith('split:')) onSplitPointChange?.(dragRef.current.slice(6), time);
    else onSeek?.(time);
  }
  function begin(event: React.PointerEvent<HTMLElement>, kind: typeof dragRef.current) {
    event.preventDefault(); event.stopPropagation(); dragRef.current = kind; event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX);
  }
  function changeZoom(next: number) {
    const minimum = viewport.width / Math.max(duration, 1), maximum = Math.max(minimum * 32, (fps || 25) * 12);
    const value = Math.max(minimum, Math.min(maximum, next)); setZoom(value);
    if (scrollRef.current) requestAnimationFrame(() => { const scroll = scrollRef.current!; scroll.scrollLeft = Math.max(0, currentTime * value - scroll.clientWidth / 2); });
  }
  return <section className="video-timeline" aria-label="Video timeline">
    <div className="video-timeline-toolbar"><span>{mode === 'trim' ? 'Trim range' : 'Timeline'}{selection && <small>{clock(Math.max(0, selection.end - selection.start))} selected</small>}</span><div><label className="timeline-exact-time">Seek (s)<Input aria-label="Seek to time in seconds" type="number" min={0} max={duration} step={averageStep} value={Number(currentTime.toFixed(3))} onChange={event => onSeek?.(snap(Number(event.target.value)))}/></label>{mode === 'split' && <Button disabled={!duration} onClick={() => onAddSplit?.(snap(currentTime))}><Scissors size={13}/> Add Split</Button>}<Button aria-label="Zoom out timeline" onClick={() => changeZoom(Math.max(scale / 1.6, .01))}>−</Button><Button aria-label="Zoom in timeline" onClick={() => changeZoom(scale * 1.6)}>+</Button></div></div>
    <div ref={scrollRef} className="video-timeline-scroll" onScroll={event => { const left = event.currentTarget.scrollLeft; setViewport(value => ({ ...value, left })); }}>
      <div ref={stripRef} className="video-timeline-track" style={{ width: trackWidth }} onPointerDown={event => begin(event, 'seek')} onPointerMove={event => { if (dragRef.current) move(event.clientX); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} role="slider" tabIndex={0} aria-label="Seek video timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} onKeyDown={event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); onSeek?.(snap(currentTime + (event.key === 'ArrowRight' ? averageStep : -averageStep))); } }}>
        <div className="timeline-ruler" aria-hidden="true">{ticks.map((time, index) => <i key={time} style={{ left: time * scale }}><span>{!frameTicks || index % Math.max(1, Math.ceil(70 / (scale * averageStep))) === 0 ? clock(time) : ''}</span></i>)}</div>
        <div className="timeline-visible-frames" style={{ left: sampleStart * scale, width: (sampleEnd - sampleStart) * scale }}><FrameStrip start={sampleStart} end={sampleEnd} count={thumbnailCount}/></div>
        {selection && <><div className="video-timeline-dim" style={{left:0,width:selection.start * scale}}/><div className="video-timeline-dim" style={{left:selection.end * scale,right:0}}/><div className="video-timeline-selection" style={{ left: selection.start * scale, width: Math.max(0, selection.end - selection.start) * scale }}/></>}
        {mode === 'trim' && selection && (['start','end'] as const).map(kind => <button key={kind} type="button" role="slider" className="timeline-trim-grip" aria-label={`Trim ${kind}`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={selection[kind]} style={{left:selection[kind] * scale}} onPointerDown={event => begin(event, kind)}>⋮</button>)}
        {mode === 'split' && [...splitPoints].sort((a,b) => a.timeSeconds - b.timeSeconds).map((point,index) => <button key={point.id} type="button" role="slider" className="timeline-split-marker" aria-label={`Split ${index + 1} marker`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={point.timeSeconds} style={{left:point.timeSeconds * scale}} onPointerDown={event => begin(event, `split:${point.id}`)}><span>{index + 1}</span></button>)}
        <div className="video-timeline-playhead" style={{ left: currentTime * scale }} aria-hidden="true"/>
      </div>
    </div>
    {variableFrameRate && <span className="timeline-timing-note">Variable frame rate detected. Marker snapping uses FFprobe frame timestamps within the preview range.</span>}
  </section>;
}
