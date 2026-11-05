import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

type Option = { value: string; label: string };

/** A compact, keyboard-operable select that does not rely on platform popup bounds. */
export function Select({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value) || options[0];
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className="image-tool-select" ref={root}>
    <span id={`${id}-label`}>{label}</span>
    <button type="button" className="image-tool-select-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <span id={`${id}-value`}>{selected?.label || label}</span><ChevronDown size={15} aria-hidden="true"/>
    </button>
    {open && <div className="image-tool-select-menu" role="listbox" aria-labelledby={`${id}-label`}>
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>}
  </div>;
}
