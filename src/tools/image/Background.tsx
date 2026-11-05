import { Field } from '../../common/EditorFields';
import { Select } from '../../common/Select';
import type { ImageControls } from './controls';

export default function Background({ values, set, originalDimensions }: ImageControls) {
 const source = originalDimensions.current;
 const setBackground = (backgroundType: string) => {
  set('backgroundType', backgroundType);
  if (!source) return;
  if (backgroundType === 'landscape') { const width = Math.max(source.width, Math.round(source.height * 16 / 9)); set('width', String(width)); set('height', String(Math.round(width * 9 / 16))); }
  if (backgroundType === 'portrait') { const height = Math.max(source.height, Math.round(source.width * 4 / 3)); set('height', String(height)); set('width', String(Math.round(height * 3 / 4))); }
 };
 const custom = values.backgroundType === 'custom';
 return <><Select label="Background" value={values.backgroundType} onChange={setBackground} options={[{ value: 'solid', label: 'Single colour' }, { value: 'image', label: 'Image' }, { value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }, { value: 'custom', label: 'Custom' }]}/>
 {values.backgroundType === 'image' ? <label className="image-tool-field"><span>Local image</span><input aria-label="Choose local background image" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0] as (File & { path?: string }) | undefined; set('backgroundImage', file?.path || ''); }}/><small className="image-tool-hint">Choose a local image. Built-in image swatches are not shipped.</small></label> : <><div className="image-tool-color-row"><label>Colour<input type="color" value={values.backgroundColor} onChange={event => set('backgroundColor', event.target.value)}/></label></div><div className="image-tool-swatches" aria-label="Background colour presets">{['#fff4e8','#f4d6be','#ffd166','#ff5a00','#6cc4b8','#94a8ff','#ffffff','#242424'].map(color => <button key={color} aria-label={`Choose ${color} background`} aria-pressed={values.backgroundColor.toLowerCase() === color} className={values.backgroundColor.toLowerCase() === color ? 'selected' : ''} style={{ background: color }} onClick={() => set('backgroundColor', color)}/>)}</div></>}
 <Field label="Padding" value={values.padding} onChange={value => set('padding', value)}/><Select label="Image fit" value={values.fit} onChange={value => set('fit', value)} options={[{ value: 'contain', label: 'Contain on canvas' }, { value: 'cover', label: 'Cover canvas' }, { value: 'fill', label: 'Stretch to canvas' }]}/>
 {custom && <div className="image-tool-field-grid"><Field label="Canvas width" value={values.width || String(source?.width || '')} onChange={value => set('width', value)} min={1}/><Field label="Canvas height" value={values.height || String(source?.height || '')} onChange={value => set('height', value)} min={1}/></div>}</>;
}
