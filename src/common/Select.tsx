import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { useId } from 'react';

type Option = { value: string; label: string };

/** Shadcn-style Radix select for compact image controls. */
export function Select({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="image-tool-select">
    <span id={`${id}-label`}>{label}</span>
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger className="image-tool-select-trigger" aria-labelledby={`${id}-label ${id}-value`}>
        <SelectPrimitive.Value id={`${id}-value`} placeholder={label}/><SelectPrimitive.Icon><ChevronDown size={15} aria-hidden="true"/></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Content position="popper" sideOffset={4} className="santra-select-content">
        <SelectPrimitive.Viewport>{options.map(option => <SelectPrimitive.Item key={option.value} value={option.value} className="santra-select-item"><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText></SelectPrimitive.Item>)}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Root>
  </div>;
}
