import { useEffect, useReducer, useRef } from 'react';
import { Calculator as CalculatorIcon, ArrowUpRight } from 'lucide-react';
import { calculator, initialCalculator } from '../calculator';

export function Calculator({ onOpen, equalHoldEnabled }: { onOpen: () => void; equalHoldEnabled: boolean }) {
  const [state, press] = useReducer(calculator, initialCalculator);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  function cancelHold() { if (hold.current) clearTimeout(hold.current); }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'KeyV') { event.preventDefault(); onOpen(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLButtonElement && ['Enter', ' '].includes(event.key)) return;
      const key = ({ '*': '×', '/': '÷', '-': '−', ',': '.', Enter: '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC' } as Record<string, string>)[event.key] ?? event.key;
      if (/^[0-9.+%=]$/.test(key) || ['×', '÷', '−', '⌫', 'AC'].includes(key)) { event.preventDefault(); press(key); }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); cancelHold(); };
  }, [onOpen]);
  return <main className="calculator-page">
    <header className="calculator-header"><div className="brand-mark"><CalculatorIcon size={22} /></div><span>Калькулятор</span><span className="muted small">Стандартный</span></header>
    <section className="calculator-body">
      <div className="calculator-intro"><span className="eyebrow">ПРОСТО. КАЖДЫЙ ДЕНЬ.</span><h1>Всё сходится.</h1><p>Немного порядка<br />в повседневных числах.</p><div className="decorative-sum" aria-hidden="true">24<span>+</span>76<span>=</span><strong>100</strong></div></div>
      <div className="calculator-device">
        <div className="calc-display"><div className="calc-history">{state.history || ' '}</div><output aria-label="Результат" className={state.display.length > 10 ? 'compact' : ''}>{state.display.replace('.', ',')}</output></div>
        <div className="calc-keys">{['AC', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '⌫', '0', '.', '='].map(key => <button
          key={key} className={`calc-key ${['÷', '×', '−', '+'].includes(key) ? 'operator' : ''} ${['AC', '±', '%'].includes(key) ? 'utility' : ''} ${key === '=' ? 'equals' : ''}`}
          aria-label={key === '⌫' ? 'Удалить цифру' : key === '.' ? 'Десятичная точка' : key}
          onClick={() => { if (key === '=' && held.current) { held.current = false; return; } press(key); }}
          onPointerDown={key === '=' && equalHoldEnabled ? event => { if (event.button !== 0) return; held.current = false; cancelHold(); hold.current = setTimeout(() => { held.current = true; onOpen(); }, 900); } : undefined}
          onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
          onContextMenu={event => event.preventDefault()}
        >{key === '.' ? ',' : key}</button>)}</div>
        <button className="calc-hint" onClick={onOpen} title="Alt+V">{equalHoldEnabled ? 'Удерживайте = · ' : ''}дополнительные функции <ArrowUpRight size={14} /></button>
      </div>
    </section><footer className="calculator-footer">Меньше лишнего. Больше ясности.</footer>
  </main>;
}
