import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog className="modal" ref={ref} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
