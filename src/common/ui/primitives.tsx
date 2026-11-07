import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';
import './ui.css';
const buttonVariants = cva('inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { unstyled: '', default: 'bg-[#ff5a00] text-white hover:bg-[#df5000]', outline: 'border border-[#e0e3dd] bg-white text-[#33372e] hover:bg-[#f5f6f2]', ghost: 'text-[#33372e] hover:bg-[#f5f6f2]' }, size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3', icon: 'size-9 p-0' } }, defaultVariants: { variant: 'outline', size: 'default' } });
export function Button({ className, variant, size, type='button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) { return <button data-slot="button" type={type} className={variant === 'unstyled' ? className : cn(buttonVariants({ variant, size }), className)} {...props}/>; }
export function Input({ className, unstyled = false, ...props }: ComponentProps<'input'> & { unstyled?: boolean }) { return <input data-slot="input" className={unstyled ? className : cn(!['checkbox','range','color','file'].includes(props.type || '') && !props.hidden && 'flex h-9 w-full min-w-0 rounded-md border border-[#e0e3dd] bg-transparent px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 aria-invalid:border-red-600', className)} {...props}/>; }
export function Card({ className, ...props }: ComponentProps<'div'>) { return <div data-slot="card" className={cn('flex flex-col gap-4 rounded-xl border border-[#e0e3dd] bg-white p-4 text-[#33372e]', className)} {...props}/>; }

// Unstyled variants retain the layout of custom tools while sharing the same
// shadcn component boundary and native form semantics.
export function NativeButton(props: ComponentProps<'button'>) { return <Button variant="unstyled" {...props} type={props.type ?? 'submit'} />; }
export function NativeInput(props: ComponentProps<'input'>) { return <Input unstyled {...props}/>; }
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) { return <select data-slot="native-select" className={cn("santra-native-select", className)} {...props}/>; }
export function NativeTextarea(props: ComponentProps<'textarea'>) { return <textarea data-slot="textarea" {...props}/>; }

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) { return <textarea data-slot="textarea" className={cn("flex w-full min-w-0 rounded-md border border-[#e0e3dd] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50", className)} {...props}/>; }
