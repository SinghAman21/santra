import { Input as UiNativeInput } from '../../common/ui/primitives';
type Props = {
    values: Record<string, string>;
    videoWidth: number;
    set: (key: string, value: string) => void;
    videoHeight: number;
};
export default function ResizeControls({ values, videoWidth, set, videoHeight }: Props) { return <><div className="video-tool-grid"><label className="video-tool-field">Width (px)<UiNativeInput aria-label="Width (px)" type="number" min="2" max="16384" step="2" value={values.width || String(videoWidth || 1280)} onChange={event => set('width', event.target.value)}/></label><label className="video-tool-field">Height (px)<UiNativeInput aria-label="Height (px)" type="number" min="2" max="16384" step="2" value={values.height || String(videoHeight || 720)} onChange={event => set('height', event.target.value)}/></label></div><p className="video-tool-note">Resizing re-encodes the video and can change its quality.</p></>; }
