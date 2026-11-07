import { Input as UiNativeInput } from '../../common/ui/primitives';
type Props = {
    values: Record<string, string>;
    set: (key: string, value: string) => void;
};
export default function GifControls({ values, set }: Props) { return <><p className="video-tool-note">Creates a silent animated GIF. High resolutions and frame rates can produce large files.</p><div className="video-tool-grid"><label className="video-tool-field">Width (px)<UiNativeInput aria-label="Width (px)" type="number" min="2" max="2048" step="2" value={values.width || '480'} onChange={event => set('width', event.target.value)}/></label><label className="video-tool-field">Frames per second<UiNativeInput aria-label="Frames per second" type="number" min="1" max="60" value={values.fps || '12'} onChange={event => set('fps', event.target.value)}/></label></div></>; }
