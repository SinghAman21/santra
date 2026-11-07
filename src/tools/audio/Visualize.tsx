import { NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import { Field } from '../../common/EditorFields';
import type { AudioControlsProps } from './controls';
export default function Visualize({values,set}: AudioControlsProps) {
 return <div className="audio-fields"><label className="image-tool-select">Waveform style<UiNativeSelect value={values.style ?? 'line'} onChange={e=>set('style',e.target.value)}><option value="line">Line</option><option value="point">Points</option><option value="p2p">Connected points</option><option value="cline">Centered line</option></UiNativeSelect></label><Field label="Width (px)" min={2} max={4096} value={values.width ?? '1280'} onChange={v=>set('width',v)}/><Field label="Height (px)" min={2} max={4096} value={values.height ?? '720'} onChange={v=>set('height',v)}/><p className="image-tool-hint">Exports an MP4 with the source audio. This preview plays the original audio.</p></div>;
}
