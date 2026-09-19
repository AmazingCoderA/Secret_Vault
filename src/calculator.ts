export interface CalculatorState {
  display: string;
  accumulator: number | null;
  operation: string | null;
  waiting: boolean;
  previous: { operation: string; operand: number } | null;
  history: string;
}
export const initialCalculator: CalculatorState = { display: '0', accumulator: null, operation: null, waiting: false, previous: null, history: '' };
function calculate(a: number, b: number, operation: string): number {
  switch (operation) { case '+': return a + b; case '−': return a - b; case '×': return a * b; case '÷': return a / b; default: return b; }
}
function format(value: number): string { return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : 'Ошибка'; }
export function calculator(state: CalculatorState, key: string): CalculatorState {
  if (key === 'AC') return { ...initialCalculator };
  if (state.display === 'Ошибка') state = { ...initialCalculator };
  if (/^\d$/.test(key) || key === '.') {
    const current = state.waiting ? '0' : state.display;
    if (key === '.' && current.includes('.')) return state;
    if (current.replace(/[-.]/g, '').length >= 12 && !state.waiting) return state;
    return { ...state, display: key === '.' ? current + '.' : current === '0' ? key : current + key, waiting: false, previous: null, history: state.operation ? state.history : '' };
  }
  if (key === '⌫') return { ...state, display: state.waiting ? '0' : state.display.slice(0, -1).replace(/^-$/, '') || '0', waiting: false };
  if (key === '±') return { ...state, display: format(-Number(state.display)) };
  if (key === '%') return { ...state, display: format(Number(state.display) / 100) };
  if (['+', '−', '×', '÷'].includes(key)) {
    const result = state.operation && !state.waiting && state.accumulator !== null
      ? calculate(state.accumulator, Number(state.display), state.operation) : Number(state.display);
    const display = format(result);
    if (display === 'Ошибка') return { ...initialCalculator, display };
    return { ...state, display, accumulator: result, operation: key, waiting: true, previous: null, history: `${display} ${key}` };
  }
  if (key === '=') {
    const operation = state.operation ?? state.previous?.operation;
    const operand = state.operation ? Number(state.display) : state.previous?.operand;
    const first = state.operation ? state.accumulator : Number(state.display);
    if (!operation || operand === undefined || first === null) return state;
    const display = format(calculate(first, operand, operation));
    return { ...initialCalculator, display, waiting: true, previous: { operation, operand }, history: `${first} ${operation} ${operand} =` };
  }
  return state;
}
