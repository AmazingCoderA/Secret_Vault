import { describe, expect, it } from 'vitest';
import { calculator, initialCalculator } from './calculator';
function enter(keys: string[]) { return keys.reduce(calculator, initialCalculator); }
describe('calculator', () => {
  it('handles decimal arithmetic and repeated equals', () => {
    expect(enter(['0', '.', '1', '+', '0', '.', '2', '=']).display).toBe('0.3');
    expect(enter(['2', '+', '3', '=', '=']).display).toBe('8');
  });
  it('uses ordinary sequential calculator operations', () => {
    expect(enter(['2', '+', '3', '×', '4', '=']).display).toBe('20');
    expect(enter(['2', '+', '×', '3', '=']).display).toBe('6');
  });
  it('recovers from division by zero', () => {
    expect(enter(['8', '÷', '0', '=']).display).toBe('Error');
    expect(enter(['8', '÷', '0', '=', '2', '+', '1', '=']).display).toBe('3');
  });
  it('supports percentage, sign, backspace and fresh entry', () => {
    expect(enter(['5', '0', '%', '±']).display).toBe('-0.5');
    expect(enter(['1', '2', '⌫']).display).toBe('1');
    expect(enter(['2', '+', '3', '=', '7']).display).toBe('7');
  });
  it('switches between decimal and binary arithmetic', () => {
    expect(enter(['5', 'BIN']).display).toBe('101');
    expect(enter(['BIN', '1', '0', '+', '1', '1', '=']).display).toBe('101');
    expect(enter(['BIN', '1', '0', '2', '+', '1', '=']).display).toBe('11');
    expect(enter(['BIN', '1', '0', '+', '1', '=', 'DEC']).display).toBe('3');
  });
});
