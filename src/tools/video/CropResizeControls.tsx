import { cropRect, isEven } from './media';

const ratios: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '3:2': 3 / 2 };
const presets = ['Free', '1:1', '4:3', '16:9', '3:2'];

type Props = {
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  videoWidth: number;
  videoHeight: number;
  ratio: string;
  setRatio: (value: string) => void;
  setCropRatio: (value: string) => void;
};

export default function CropResizeControls({ values, set, videoWidth, videoHeight, ratio, setRatio, setCropRatio }: Props) {
  const crop = cropRect(values, videoWidth, videoHeight);
  const cropInvalid = videoWidth > 0 && (
    crop.width < 2
    || crop.height < 2
    || !isEven(crop.width)
    || !isEven(crop.height)
    || crop.x < 0
    || crop.y < 0
    || crop.x + crop.width > videoWidth
    || crop.y + crop.height > videoHeight
  );
  const resizeWidth = values.width ?? '';
  const resizeHeight = values.height ?? '';
  const resizeInvalid = (resizeWidth !== '' || resizeHeight !== '') && (
    Number(resizeWidth) < 2
    || Number(resizeHeight) < 2
    || !isEven(Number(resizeWidth))
    || !isEven(Number(resizeHeight))
  );
  return <>
    <div className="video-settings-wide">
      <span className="video-field-label">Aspect ratio</span>
      <div className="video-tool-presets">{presets.map(item => <button key={item} type="button" aria-pressed={ratio === item} className={ratio === item ? 'selected' : ''} onClick={() => setCropRatio(item)}>{item}</button>)}</div>
    </div>
    <label className="video-tool-field">Crop width (px)
      <input aria-label="Crop width (px)" aria-invalid={cropInvalid} type="number" min="2" max="16384" step="2" value={values.cropWidth ?? (videoWidth ? String(videoWidth) : '')} onChange={event => { setRatio('Free'); set('cropWidth', event.target.value); }}/>
    </label>
    <label className="video-tool-field">Crop height (px)
      <input aria-label="Crop height (px)" aria-invalid={cropInvalid} type="number" min="2" max="16384" step="2" value={values.cropHeight ?? (videoHeight ? String(videoHeight) : '')} onChange={event => { setRatio('Free'); set('cropHeight', event.target.value); }}/>
    </label>
    <label className="video-tool-field">Left (px)
      <input aria-label="Crop left (px)" aria-invalid={cropInvalid} type="number" min="0" max="16384" step="2" value={values.cropX ?? '0'} onChange={event => { setRatio('Free'); set('cropX', event.target.value); }}/>
    </label>
    <label className="video-tool-field">Top (px)
      <input aria-label="Crop top (px)" aria-invalid={cropInvalid} type="number" min="0" max="16384" step="2" value={values.cropY ?? '0'} onChange={event => { setRatio('Free'); set('cropY', event.target.value); }}/>
    </label>
    {cropInvalid && <p className="video-field-error video-settings-wide" role="alert">Crop must be even-sized and stay inside the {videoWidth} × {videoHeight} frame.</p>}
    <div className="video-settings-wide video-group-divider"><span>Resize output</span><small>Leave both blank to keep the crop size.</small></div>
    <label className="video-tool-field">Output width (px)
      <input aria-label="Output width (px)" aria-invalid={resizeInvalid} type="number" min="2" max="16384" step="2" placeholder="Keep crop" value={resizeWidth} onChange={event => set('width', event.target.value)}/>
    </label>
    <label className="video-tool-field">Output height (px)
      <input aria-label="Output height (px)" aria-invalid={resizeInvalid} type="number" min="2" max="16384" step="2" placeholder="Keep crop" value={resizeHeight} onChange={event => set('height', event.target.value)}/>
    </label>
    {resizeInvalid && <p className="video-field-error video-settings-wide" role="alert">Output width and height must both be even numbers of at least 2 pixels.</p>}
  </>;
}

export { ratios };
