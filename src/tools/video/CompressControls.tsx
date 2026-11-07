import { Slider as ShadcnSlider } from '../../common/ui/slider';
import { Input as UiNativeInput } from '../../common/ui/primitives';
type Props = {
    values: Record<string, string>;
    set: (key: string, value: string) => void;
};
export default function CompressControls({ values, set }: Props) { return <><p className="video-tool-note">Re-encodes the video locally. Compression may increase file size; the source is kept untouched.</p><label className="video-tool-slider">Video quality <b>{values.quality || '75'}</b><ShadcnSlider aria-label="Video quality" min={1} max={100} value={[Number(values.quality || 75)]} onValueChange={([value]) => set('quality', String(value))}/></label><label className="video-tool-field">Audio bitrate (kbps)<UiNativeInput aria-label="Audio bitrate" type="number" min="16" max="512" step="16" value={values.bitrate || '128'} onChange={event => set('bitrate', event.target.value)}/></label></>; }
