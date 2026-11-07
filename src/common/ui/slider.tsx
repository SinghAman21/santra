import * as SliderPrimitive from '@radix-ui/react-slider';
import type { ComponentProps } from 'react';
import { cn } from './utils';
import './ui.css';

type Props = ComponentProps<typeof SliderPrimitive.Root> & { 'aria-label': string };
export function Slider({ className, 'aria-label': label, value, defaultValue, min = 0, max = 100, ...props }: Props) {
  const count = (value ?? defaultValue ?? [min]).length;
  return <SliderPrimitive.Root data-slot="slider" className={cn('santra-slider', className)} value={value} defaultValue={defaultValue} min={min} max={max} {...props}>
    <SliderPrimitive.Track data-slot="slider-track" className="santra-slider-track"><SliderPrimitive.Range data-slot="slider-range" className="santra-slider-range"/></SliderPrimitive.Track>
    {Array.from({length: count}, (_, i) => <SliderPrimitive.Thumb key={i} aria-label={label} data-slot="slider-thumb" className="santra-slider-thumb"/>)}
  </SliderPrimitive.Root>;
}
