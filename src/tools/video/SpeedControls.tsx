import { Slider as ShadcnSlider } from '../../common/ui/slider';
import { Button as UiNativeButton, Input as UiNativeInput } from '../../common/ui/primitives';
type Props = {
    values: Record<string, string>;
    set: (key: string, value: string) => void;
};
export default function SpeedControls({ values, set }: Props) { return <><label className="video-tool-slider">Playback speed <b>{values.factor || '1'}×</b><ShadcnSlider aria-label="Playback speed" min={0.25} max={4} step={0.05} value={[Number(values.factor || 1)]} onValueChange={([value]) => set('factor', String(value))}/></label><div className="video-tool-presets">{[0.5, 1, 1.5, 2, 4].map(factor => <UiNativeButton type="button" className={Number(values.factor || 1) === factor ? 'selected' : ''} key={factor} onClick={() => set('factor', String(factor))}>{factor}×</UiNativeButton>)}</div><p className="video-tool-note">The export is re-encoded. Audio pitch correction is not currently offered; audio tempo changes with the clip.</p></>; }
