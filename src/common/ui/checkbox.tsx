import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './utils';
import './ui.css';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn('santra-checkbox', className)} {...props}>
    <CheckboxPrimitive.Indicator data-slot="checkbox-indicator"><Check size={13}/></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
