import { Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { clock, decimal, type SplitClip } from './media';

type Props = {
  clips: SplitClip[];
  setClips: Dispatch<SetStateAction<SplitClip[]>>;
  duration: number;
  playhead: number;
};

const clipError = (clip: SplitClip, duration: number) => {
  const start = Number(clip.start);
  const end = Number(clip.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return 'Enter a start time of 0 or more.';
  if (!(end > start)) return 'End must be after start.';
  if (duration > 0 && end > duration + 0.02) return `End must be within ${clock(duration)}.`;
  return '';
};

export default function SplitTracks({ clips, setClips, duration, playhead }: Props) {
  const total = duration || Math.max(1, ...clips.map(clip => Number(clip.end) || 0));
  function update(index: number, key: 'start' | 'end', value: string) {
    setClips(current => current.map((clip, position) => position === index ? { ...clip, [key]: value } : clip));
  }
  function add() {
    const start = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, playhead));
    const end = Math.min(duration || start + 5, start + 5);
    setClips(current => [...current, { id: `clip-${Date.now()}-${current.length}`, start: decimal(start), end: decimal(Math.max(start + 0.01, end)) }]);
  }
  return <>
    <div className="video-track-toolbar video-settings-wide">
      <span>{clips.length} {clips.length === 1 ? 'clip' : 'clips'} · each on its own track</span>
      <button type="button" onClick={add}><Plus size={13}/> Add clip track</button>
    </div>
    <div className="video-track-timeline video-settings-wide" aria-label="Split timeline">
      {clips.length === 0 && <p className="video-tool-empty">No clip ranges yet.</p>}
      {clips.map((clip, index) => {
        const start = Number(clip.start) || 0;
        const end = Number(clip.end) || 0;
        const left = Math.max(0, Math.min(100, start / total * 100));
        const width = Math.max(0.5, Math.min(100 - left, (Math.max(0, end - start)) / total * 100));
        const error = clipError(clip, duration);
        return <div className="video-track-group" key={clip.id}>
          <div className="video-track-row">
            <span className="video-track-index">Clip {index + 1}</span>
            <div className="video-track-rail">
              <div className="video-track-clip" style={{ left: `${left}%`, width: `${width}%` }}>{decimal(Math.max(0, end - start))}s</div>
              <span className="video-track-playhead" style={{ left: `${Math.max(0, Math.min(100, playhead / total * 100))}%` }}/>
            </div>
            <span className="video-track-output">Output {String(index + 1).padStart(2, '0')}</span>
            <button type="button" className="video-track-delete" aria-label={`Delete clip ${index + 1}`} onClick={() => setClips(current => current.filter((_, position) => position !== index))}><Trash2 size={13}/></button>
          </div>
          <div className="video-track-fields">
            <label className="video-tool-field">Start (s)
              <input aria-label={`Clip ${index + 1} start`} aria-invalid={Boolean(error)} type="number" min="0" max={duration || 604800} step="0.01" value={clip.start} onChange={event => update(index, 'start', event.target.value)}/>
            </label>
            <label className="video-tool-field">End (s)
              <input aria-label={`Clip ${index + 1} end`} aria-invalid={Boolean(error)} type="number" min="0" max={duration || 604800} step="0.01" value={clip.end} onChange={event => update(index, 'end', event.target.value)}/>
            </label>
            <span className="video-track-duration">Duration <b>{decimal(Math.max(0, end - start))}s</b></span>
          </div>
          {error && <p className="video-field-error" role="alert">{error}</p>}
        </div>;
      })}
    </div>
  </>;
}

export { clipError };
