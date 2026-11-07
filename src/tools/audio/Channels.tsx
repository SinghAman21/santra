import { NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import type { AudioControlsProps } from './controls';
export default function Channels({values,set}: AudioControlsProps) {
 return <label className="image-tool-select">Output channels<UiNativeSelect value={values.channels ?? '1'} onChange={e=>set('channels',e.target.value)}><option value="1">Mono</option><option value="2">Stereo</option></UiNativeSelect><span className="image-tool-hint">The local encoder determines channel mapping.</span></label>;
}
