import { useEffect, useReducer, useRef } from 'react';
import { Calculator as CalculatorIcon, ArrowUpRight } from 'lucide-react';
import { calculator, initialCalculator } from '../calculator';
import { LanguageSwitch, useI18n } from '../i18n';

export function Calculator({ onOpen, equalHoldEnabled }: { onOpen: () => void; equalHoldEnabled: boolean }) {
  const [state, press] = useReducer(calculator, initialCalculator);
  const { language, t } = useI18n();
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const binaryDisabled = (key: string) => state.base === 2 && (/^[2-9.]$/.test(key) || key === '%');
  function cancelHold() { if (hold.current) clearTimeout(hold.current); }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'KeyV') { event.preventDefault(); onOpen(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLButtonElement && ['Enter', ' '].includes(event.key)) return;
      const key = ({ '*': '×', '/': '÷', '-': '−', ',': '.', Enter: '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC' } as Record<string, string>)[event.key] ?? event.key;
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); press(state.base === 2 ? 'DEC' : 'BIN'); return; }
      if (/^[0-9.+%=]$/.test(key) || ['×', '÷', '−', '⌫', 'AC'].includes(key)) { event.preventDefault(); press(key); }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); cancelHold(); };
  }, [onOpen, state.base]);
  return <main className="calculator-page">
    <header className="calculator-header"><div className="brand-mark"><CalculatorIcon size={22} /></div><span>{t('Calculator')}</span><span className="muted small">{t('Standard')}</span><LanguageSwitch /></header>
    <section className="calculator-body">
      <div className="calculator-intro"><span className="eyebrow">{t('SIMPLE. EVERY DAY.')}</span><h1>{t('It all adds up.')}</h1><p>{t('A little order\nin everyday numbers.').split('\n').map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</p><div className="decorative-sum" aria-hidden="true">24<span>+</span>76<span>=</span><strong>100</strong></div></div>
      <div className="calculator-device">
        <div className="base-switch" role="group" aria-label={t('Number base')}><button type="button" className={state.base === 10 ? 'active' : ''} aria-pressed={state.base === 10} onClick={() => press('DEC')}>DEC</button><button type="button" className={state.base === 2 ? 'active' : ''} aria-pressed={state.base === 2} onClick={() => press('BIN')}>BIN</button></div>
        <div className="calc-display"><div className="calc-history">{state.history || ' '}</div><output aria-label={t('Result')} className={state.display.length > 10 ? 'compact' : ''}>{(state.display === 'Error' ? t('Error') : state.display).replace('.', language === 'ru' ? ',' : '.')}</output></div>
        <div className="calc-keys">{['AC', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '⌫', '0', '.', '='].map(key => <button
          key={key} className={`calc-key ${['÷', '×', '−', '+'].includes(key) ? 'operator' : ''} ${['AC', '±', '%'].includes(key) ? 'utility' : ''} ${key === '=' ? 'equals' : ''}`}
          disabled={binaryDisabled(key)}
          aria-label={key === '⌫' ? t('Delete digit') : key === '.' ? t('Decimal point') : key}
          onClick={() => { if (key === '=' && held.current) { held.current = false; return; } press(key); }}
          onPointerDown={key === '=' && equalHoldEnabled ? event => { if (event.button !== 0) return; held.current = false; cancelHold(); hold.current = setTimeout(() => { held.current = true; onOpen(); }, 900); } : undefined}
          onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
          onContextMenu={event => event.preventDefault()}
        >{key === '.' && language === 'ru' ? ',' : key}</button>)}</div>
        <button className="calc-hint" onClick={onOpen} title="Alt+V">{equalHoldEnabled ? t('Hold = · ') : ''}{t('additional functions')} <ArrowUpRight size={14} /></button>
      </div>
    </section><footer className="calculator-footer">{t('Less clutter. More clarity.')}</footer>
  </main>;
}
