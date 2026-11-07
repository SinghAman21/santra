import { Button as UiNativeButton, Textarea as UiNativeTextarea } from '../../common/ui/primitives';
import { Plus } from 'lucide-react';
import { decimal } from './media';
type Props = {
    segmentsText: string;
    set: (key: string, value: string) => void;
    playhead: number;
    duration: number;
};
export default function SplitControls({ segmentsText, set, playhead, duration }: Props) { return <><p className="video-tool-note">Enter each start–end range in seconds. Each range exports as a numbered clip.</p><label className="video-tool-field">Segments (seconds)<UiNativeTextarea aria-label="Segments (seconds)" rows={4} value={segmentsText} onChange={event => set('segments', event.target.value)}/></label><div className="video-tool-range-actions"><UiNativeButton type="button" onClick={() => set('segments', `${segmentsText ? `${segmentsText}, ` : ''}${decimal(playhead)}-${decimal(Math.min(duration || playhead + 5, playhead + 5))}`)}><Plus size={13}/> Add segment at playhead</UiNativeButton></div></>; }
