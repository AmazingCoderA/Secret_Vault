export interface CalculatorState {
  display: string;
  base: 2 | 10;
  accumulator: number | null;
  operation: string | null;
  waiting: boolean;
  previous: { operation: string; operand: number } | null;
  history: string;
}
export const initialCalculator: CalculatorState = { display: '0', base: 10, accumulator: null, operation: null, waiting: false, previous: null, history: '' };
function calculate(a: number, b: number, operation: string): number {
  switch (operation) { case '+': return a + b; case '−': return a - b; case '×': return a * b; case '÷': return a / b; default: return b; }
}
function read(display: string, base: 2 | 10): number { return base === 2 ? (display.startsWith('-') ? -parseInt(display.slice(1), 2) : parseInt(display, 2)) : Number(display); }
function format(value: number, base: 2 | 10): string {
  if (!Number.isFinite(value)) return 'Error';
  if (base === 2) return Number.isInteger(value) && Math.abs(value) <= 0xffffffff ? `${value < 0 ? '-' : ''}${Math.abs(value).toString(2)}` : 'Error';
  return String(Number(value.toPrecision(12)));
}
export function calculator(state: CalculatorState, key: string): CalculatorState {
  if (key === 'AC') return { ...initialCalculator };
  if (state.display === 'Error') state = { ...initialCalculator };
  if (key === 'DEC' || key === 'BIN') {
    const base = key === 'BIN' ? 2 : 10;
    if (state.base === base) return state;
    const display = format(read(state.display, state.base), base);
    return { ...initialCalculator, base, display };
  }
  if (/^\d$/.test(key) || key === '.') {
    if (state.base === 2 && !/^[01]$/.test(key)) return state;
    const current = state.waiting ? '0' : state.display;
    if (key === '.' && current.includes('.')) return state;
    if (key === '.' && state.base === 2) return state;
    if (current.replace(/[-.]/g, '').length >= (state.base === 2 ? 32 : 12) && !state.waiting) return state;
    return { ...state, display: key === '.' ? current + '.' : current === '0' ? key : current + key, waiting: false, previous: null, history: state.operation ? state.history : '' };
  }
  if (key === '⌫') return { ...state, display: state.waiting ? '0' : state.display.slice(0, -1).replace(/^-$/, '') || '0', waiting: false };
  if (key === '±') return { ...state, display: format(-read(state.display, state.base), state.base) };
  if (key === '%') return { ...state, display: format(read(state.display, state.base) / 100, state.base) };
  if (['+', '−', '×', '÷'].includes(key)) {
    const result = state.operation && !state.waiting && state.accumulator !== null
      ? calculate(state.accumulator, read(state.display, state.base), state.operation) : read(state.display, state.base);
    const display = format(result, state.base);
    if (display === 'Error') return { ...initialCalculator, display };
    return { ...state, display, accumulator: result, operation: key, waiting: true, previous: null, history: `${display} ${key}` };
  }
  if (key === '=') {
    const operation = state.operation ?? state.previous?.operation;
    const operand = state.operation ? read(state.display, state.base) : state.previous?.operand;
    const first = state.operation ? state.accumulator : read(state.display, state.base);
    if (!operation || operand === undefined || first === null) return state;
    const display = format(calculate(first, operand, operation), state.base);
    return { ...initialCalculator, base: state.base, display, waiting: true, previous: { operation, operand }, history: `${format(first, state.base)} ${operation} ${format(operand, state.base)} =` };
  }
  return state;
}
