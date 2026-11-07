import { Checkbox } from '../../common/ui/checkbox';
import { Button as UiNativeButton, Input as UiNativeInput } from '../../common/ui/primitives';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { LocalFile } from '../../common/types';
import type { Dispatch, SetStateAction } from 'react';
type Props = {
    values: Record<string, string>;
    set: (key: string, value: string) => void;
    files: LocalFile[];
    setFiles: Dispatch<SetStateAction<LocalFile[]>>;
};
export default function MergeControls({ values, set, files, setFiles }: Props) { return <><p className="video-tool-note">Clips are joined in this order. Santra validates stream compatibility before export; re-encoding is enabled by default.</p><label className="video-tool-check"><Checkbox checked={values.reencode !== 'false'} onCheckedChange={checked => set('reencode', String(checked === true))}/> Re-encode clips for compatibility</label><ol className="video-tool-clip-list">{files.map((clip, index) => <li key={clip.path}><span>{index + 1}. {clip.name}</span><div><UiNativeButton type="button" aria-label={`Move ${clip.name} up`} disabled={index === 0} onClick={() => setFiles(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={14}/></UiNativeButton><UiNativeButton type="button" aria-label={`Move ${clip.name} down`} disabled={index === files.length - 1} onClick={() => setFiles(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}><ArrowDown size={14}/></UiNativeButton></div></li>)}</ol></>; }
