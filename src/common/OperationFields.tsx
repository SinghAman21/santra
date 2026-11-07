import { Input as UiNativeInput, NativeSelect as UiNativeSelect } from './ui/primitives';
import type { Capability } from './types';

interface Props { capability: Capability; values: Record<string, string>; onChange: (values: Record<string, string>) => void }
const labels: Record<string, string> = { width: 'Width (px)', height: 'Height (px)', x: 'Left offset (px)', y: 'Top offset (px)', start: 'Start time (seconds)', duration: 'Duration (seconds)', end: 'End time (seconds)', angle: 'Rotation', direction: 'Flip direction', dpi: 'Render resolution (DPI)', page: 'Page number', pages: 'Page range', fps: 'Frames per second', bitrate: 'Audio bitrate (kbps)', sampleRate: 'Sample rate (Hz)', channels: 'Audio channels', quality: 'Quality' };
const defaults: Record<string, string> = { width: '1280', height: '720', x: '0', y: '0', start: '0', duration: '10', angle: '90', direction: 'horizontal', dpi: '300', page: '1', pages: '1-z', fps: '12', bitrate: '128', sampleRate: '44100', channels: '2' };
export default function OperationFields({ capability, values, onChange }: Props) {
  const schema = (capability.options && typeof capability.options === 'object' ? capability.options : {}) as Record<string, unknown>;
  const fields = Object.entries(schema).filter(([key]) => !['quality', 'stripMetadata', 'autoOrient'].includes(key));
  return <div className="operation-fields">{fields.map(([key, definition]) => {
    const choices = Array.isArray(definition) ? definition : null;
    const range = definition && typeof definition === 'object' && !Array.isArray(definition) ? definition as { min?: number; max?: number } : null;
    const value = values[key] ?? defaults[key] ?? '';
    return <label className="field-label" key={key}>{labels[key] || key}
      {choices ? <UiNativeSelect aria-label={labels[key] || key} value={value} onChange={event => onChange({ ...values, [key]: event.target.value })}>{choices.map(choice => <option value={String(choice)} key={String(choice)}>{String(choice)}</option>)}</UiNativeSelect> : <UiNativeInput aria-label={labels[key] || key} type={range ? 'number' : 'text'} min={range?.min} max={range?.max} step={['start','duration','end'].includes(key) ? '0.1' : '1'} placeholder={defaults[key] || String(definition || '')} value={value} onChange={event => onChange({ ...values, [key]: event.target.value })}/>}
    </label>;
  })}</div>;
}
