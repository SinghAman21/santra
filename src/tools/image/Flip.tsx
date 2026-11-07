import { NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import type { ImageControls } from './controls';
export default function Flip({ values, set, preview, originalDimensions, ratio, setRatio, setCropRatio, file, format }: ImageControls) { return <><div className="image-tool-section-title">Flip direction</div><label className="image-tool-select">Direction<UiNativeSelect value={values.direction} onChange={event => set('direction', event.target.value)}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></UiNativeSelect></label></>; }
