import { Input as UiNativeInput } from '../../common/ui/primitives';
type Props = {
    values: Record<string, string>;
    videoWidth: number;
    videoHeight: number;
    set: (key: string, value: string) => void;
};
export default function CropControls({ values, videoWidth, videoHeight, set }: Props) { return <><p className="video-tool-note">Drag on the frame to set a crop. Width and height must be even for common video codecs.</p><div className="video-tool-grid">{[['x', 'Left (px)'], ['y', 'Top (px)'], ['width', 'Width (px)'], ['height', 'Height (px)']].map(([key, label]) => <label className="video-tool-field" key={key}>{label}<UiNativeInput aria-label={label} type="number" min="0" step="2" value={values[key] || (key === 'width' ? String(videoWidth) : key === 'height' ? String(videoHeight) : '0')} onChange={event => set(key, event.target.value)}/></label>)}</div></>; }
