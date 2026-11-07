import { Checkbox } from '../../common/ui/checkbox';
import { Input as UiNativeInput } from '../../common/ui/primitives';
import type { ImageControls } from './controls';
export default function Metadata({values,set}:ImageControls) {
 return <><label className="image-tool-field">Artist<UiNativeInput type="text" maxLength={512} value={values.artist} onChange={event=>set('artist',event.target.value)}/></label><label className="image-tool-field">Copyright<UiNativeInput type="text" maxLength={512} value={values.copyright} onChange={event=>set('copyright',event.target.value)}/></label><label className="image-tool-field">Description<UiNativeInput type="text" maxLength={512} value={values.description} onChange={event=>set('description',event.target.value)}/></label><label className="image-tool-field">Date taken (EXIF)<UiNativeInput type="text" maxLength={512} placeholder="YYYY:MM:DD HH:MM:SS" value={values.dateTime} onChange={event=>set('dateTime',event.target.value)}/></label><label className="image-tool-check"><Checkbox checked={values.stripMetadata==='true'} onCheckedChange={checked=>set('stripMetadata',String(checked === true))}/>Clear all supported metadata</label></>;
}
