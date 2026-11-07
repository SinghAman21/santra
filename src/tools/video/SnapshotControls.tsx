import { Button as UiNativeButton } from '../../common/ui/primitives';
import { Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { clock } from './media';
type Props = {
    setFrames: Dispatch<SetStateAction<number[]>>;
    playhead: number;
    frames: number[];
    seek: (value: number) => void;
};
export default function SnapshotControls({ setFrames, playhead, frames, seek }: Props) { return <><p className="video-tool-note">Seek to a frame and add it. Selected frames export at source resolution as PNG copies.</p><div className="video-tool-range-actions"><UiNativeButton type="button" onClick={() => setFrames(current => current.includes(playhead) ? current : [...current, playhead].sort((a, b) => a - b))}><Plus size={13}/> Add frame at {clock(playhead)}</UiNativeButton></div><div className="video-tool-frame-list">{frames.map((time, index) => <div key={`${time}-${index}`}><UiNativeButton type="button" aria-label={`Seek to frame ${index + 1}`} onClick={() => seek(time)}>{clock(time)}</UiNativeButton><UiNativeButton type="button" aria-label={`Remove frame ${index + 1}`} onClick={() => setFrames(current => current.filter((_, position) => position !== index))}><Trash2 size={13}/></UiNativeButton></div>)}</div></>; }
