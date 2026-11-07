import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { en as t } from './strings';
import { Button } from './ui/primitives';

export default function Modal({ title, children, onClose, wide = false, className = '', subtitle, ariaLabel }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; subtitle?: ReactNode; ariaLabel?: string }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay asChild><div className="modal-backdrop">
        <Dialog.Content aria-label={ariaLabel || title} {...(ariaLabel ? { 'aria-labelledby': undefined } : {})} {...(!subtitle ? { 'aria-describedby': undefined } : {})} className={`modal ${wide ? 'wide' : ''} ${className}`}>
          <header className="modal-header"><div><Dialog.Title asChild><h2>{title}</h2></Dialog.Title>{subtitle && <Dialog.Description asChild><p>{subtitle}</p></Dialog.Description>}</div>
            <Dialog.Close asChild><Button variant="ghost" size="icon" className="icon-button" aria-label={t.close}><X size={20}/></Button></Dialog.Close>
          </header>{children}
        </Dialog.Content>
      </div></Dialog.Overlay>
    </Dialog.Portal>
  </Dialog.Root>;
}
