import { Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { clock } from './media';

type Props = {
  format: string;
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  frames: number[];
  setFrames: Dispatch<SetStateAction<number[]>>;
  playhead: number;
  seek: (value: number) => void;
  duration: number;
};

export default function FramesGifControls({ format, values, set, frames, setFrames, playhead, seek, duration }: Props) {
  if (format === 'gif') {
    const start = Number(values.start ?? 0);
    const end = Number(values.end ?? (duration || 5));
    const rangeInvalid = !(end > start) || start < 0 || (duration > 0 && end > duration);
    const fps = Number(values.fps || 12);
    const width = Number(values.width || 480);
    return <>
      <label className="video-tool-field">Range start (seconds)
        <input aria-label="GIF range start" aria-invalid={rangeInvalid} type="number" min="0" max={duration || 604800} step="0.01" value={values.start ?? '0'} onChange={event => set('start', event.target.value)}/>
      </label>
      <label className="video-tool-field">Range end (seconds)
        <input aria-label="GIF range end" aria-invalid={rangeInvalid} type="number" min="0" max={duration || 604800} step="0.01" value={values.end ?? String(duration || 5)} onChange={event => set('end', event.target.value)}/>
      </label>
      <label className="video-tool-field">Width (px)
        <input aria-label="GIF width (px)" aria-invalid={width < 2 || width > 2048} type="number" min="2" max="2048" step="2" value={values.width ?? '480'} onChange={event => set('width', event.target.value)}/>
      </label>
      <label className="video-tool-field">Frames per second
        <input aria-label="GIF frames per second" aria-invalid={fps < 1 || fps > 60} type="number" min="1" max="60" value={values.fps ?? '12'} onChange={event => set('fps', event.target.value)}/>
      </label>
      <div className="video-tool-range-actions video-settings-wide">
        <button type="button" onClick={() => set('start', String(Math.max(0, Number((playhead).toFixed(2)))))}>Start at playhead</button>
        <button type="button" onClick={() => set('end', String(Math.max(0, Number((playhead).toFixed(2)))))}>End at playhead</button>
      </div>
      {rangeInvalid && <p className="video-field-error video-settings-wide" role="alert">Choose an end after the start, inside the video.</p>}
      {(width < 2 || width > 2048) && <p className="video-field-error video-settings-wide" role="alert">GIF width must be between 2 and 2048 pixels.</p>}
      {(fps < 1 || fps > 60) && <p className="video-field-error video-settings-wide" role="alert">GIF frame rate must be between 1 and 60.</p>}
    </>;
  }
  return <>
    <div className="video-tool-range-actions video-settings-wide">
      <button type="button" onClick={() => setFrames(current => current.includes(playhead) ? current : [...current, playhead].sort((a, b) => a - b))}><Plus size={13}/> Add frame at {clock(playhead)}</button>
    </div>
    <div className="video-tool-frame-list video-settings-wide">
      {frames.length === 0 && <p className="video-tool-empty">No frames selected. Move the playhead and add a frame.</p>}
      {frames.map((time, index) => <div key={`${time}-${index}`}>
        <button type="button" aria-label={`Seek to frame ${index + 1}`} onClick={() => seek(time)}>{clock(time)}</button>
        <button type="button" aria-label={`Remove frame ${index + 1}`} onClick={() => setFrames(current => current.filter((_, position) => position !== index))}><Trash2 size={12}/></button>
      </div>)}
    </div>
  </>;
}
