import { Circle, Pencil, Square, Trash2, Triangle } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { clock, maskShape, type Mask, type MaskShape } from './media';

const shapes: { id: MaskShape; label: string; icon: typeof Square }[] = [
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'path', label: 'Freehand', icon: Pencil },
];

type Props = {
  masks: Mask[];
  setMasks: Dispatch<SetStateAction<Mask[]>>;
  duration: number;
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  playhead: number;
};

const maskError = (mask: Mask, duration: number) => {
  if (mask.end <= mask.start || mask.start < 0) return 'From must be before To.';
  if (duration > 0 && mask.end > duration + 0.02) return `To must be within ${clock(duration)}.`;
  return '';
};

export default function RedactTracks({ masks, setMasks, duration, values, set, playhead }: Props) {
  const shape = (values.redactShape || 'rect') as MaskShape;
  const filled = values.maskFilled !== 'false';
  return <>
    <div className="video-shape-toolbar video-settings-wide" role="group" aria-label="Redaction shape">
      {shapes.map(item => {
        const Icon = item.icon;
        return <button key={item.id} type="button" aria-pressed={shape === item.id} className={shape === item.id ? 'selected' : ''} onClick={() => set('redactShape', item.id)}><Icon size={14}/> {item.label}</button>;
      })}
    </div>
    <label className="video-tool-field">Mask color
      <input aria-label="Redaction color" type="color" value={values.maskColor || '#000000'} onChange={event => set('maskColor', event.target.value)}/>
    </label>
    <label className="video-tool-check">Outline only
      <input type="checkbox" checked={!filled} onChange={event => set('maskFilled', String(!event.target.checked))}/>
    </label>
    {!filled && <label className="video-tool-field">Outline width (px)
      <input aria-label="Redaction outline width" type="number" min="1" max="64" value={values.maskStroke || '4'} onChange={event => set('maskStroke', event.target.value)}/>
    </label>}
    <p className="video-tool-empty video-settings-wide">Draw on the preview with {shapes.find(item => item.id === shape)?.label.toLowerCase()}.</p>
    <div className="video-tool-mask-list video-settings-wide">
      {masks.length === 0 && <p className="video-tool-empty">No masks yet. Choose a shape and draw on the video.</p>}
      {masks.map((mask, index) => {
        const error = maskError(mask, duration);
        return <div key={`${index}-${mask.x}-${mask.y}-${mask.shape}`}>
          <span className="video-mask-title">Mask {index + 1} · {maskShape(mask)}{mask.filled === false ? ' · outline' : ''} · {Math.round(mask.width)}×{Math.round(mask.height)}</span>
          <label>From
            <input aria-label={`Mask ${index + 1} start`} aria-invalid={Boolean(error)} type="number" min="0" max={duration || 604800} step="0.01" value={mask.start} onChange={event => setMasks(current => current.map((item, position) => position === index ? { ...item, start: Number(event.target.value) } : item))}/>
          </label>
          <label>To
            <input aria-label={`Mask ${index + 1} end`} aria-invalid={Boolean(error)} type="number" min="0" max={duration || 604800} step="0.01" value={mask.end} onChange={event => setMasks(current => current.map((item, position) => position === index ? { ...item, end: Number(event.target.value) } : item))}/>
          </label>
          <button type="button" className="video-mask-delete" aria-label={`Delete mask ${index + 1}`} onClick={() => setMasks(current => current.filter((_, position) => position !== index))}><Trash2 size={13}/></button>
          {error && <p className="video-field-error" role="alert">{error}</p>}
          <button type="button" className="video-mask-seek" onClick={() => setMasks(current => current.map((item, position) => position === index ? { ...item, start: playhead, end: Math.max(playhead + 0.01, item.end) } : item))}>Start at playhead</button>
        </div>;
      })}
    </div>
  </>;
}

export { maskError };
