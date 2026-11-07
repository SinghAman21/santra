import { Button as UiNativeButton, Input as UiNativeInput } from '../../common/ui/primitives';
import { Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Mask } from './media';
type Props = {
    masks: Mask[];
    duration: number;
    setMasks: Dispatch<SetStateAction<Mask[]>>;
    values: Record<string, string>;
    set: (key: string, value: string) => void;
};
export default function RedactControls({ masks, duration, setMasks, values, set }: Props) { return <><p className="video-tool-note">Draw solid masks over the preview. Masks use fixed frame coordinates—not motion tracking. A moving subject can leave the covered area.</p><div className="video-tool-mask-list">{masks.map((mask, index) => <div key={`${index}-${mask.x}-${mask.y}`}><span>Mask {index + 1} · {mask.width}×{mask.height}</span><label>From<UiNativeInput aria-label={`Mask ${index + 1} start`} type="number" min="0" max={duration || 604800} step="0.01" value={mask.start} onChange={event => setMasks(current => current.map((item, position) => position === index ? { ...item, start: Number(event.target.value) } : item))}/></label><label>To<UiNativeInput aria-label={`Mask ${index + 1} end`} type="number" min="0" max={duration || 604800} step="0.01" value={mask.end} onChange={event => setMasks(current => current.map((item, position) => position === index ? { ...item, end: Number(event.target.value) } : item))}/></label><UiNativeButton type="button" aria-label={`Remove mask ${index + 1}`} onClick={() => setMasks(current => current.filter((_, position) => position !== index))}><Trash2 size={13}/></UiNativeButton></div>)}</div><label className="video-tool-field">New mask color<UiNativeInput aria-label="New mask color" type="color" value={values.maskColor || '#000000'} onChange={event => set('maskColor', event.target.value)}/></label></>; }
