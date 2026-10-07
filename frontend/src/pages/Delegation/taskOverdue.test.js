import { describe, test, expect } from 'vitest';
import { isTaskOverdue, isWebUrl, relationTo } from './taskOverdue';

const at = (iso) => new Date(iso).getTime();

describe('isTaskOverdue', () => {
  // Stored the way a date-only due date is: 00:00 UTC, 05:30 in the office.
  const dueOct1 = { status: 'Pending', dueDate: '2026-10-01T00:00:00.000Z' };

  test('a hand-made task is not late on the day it is due', () => {
    expect(isTaskOverdue(dueOct1, at('2026-10-01T10:00:00+05:30'))).toBe(false);
  });

  test('it is late once that day is over', () => {
    expect(isTaskOverdue(dueOct1, at('2026-10-02T09:00:00+05:30'))).toBe(true);
  });

  test('an O2D stage deadline is a real moment', () => {
    const stage = { status: 'Pending', sourceType: 'o2d_stage', dueDate: '2026-10-01T06:00:00.000Z' };
    expect(isTaskOverdue(stage, at('2026-10-01T07:00:00.000Z'))).toBe(true);
  });

  test('closed, handed-over and placeholder-dated tasks are never overdue', () => {
    const later = at('2026-12-01T00:00:00Z');
    for (const status of ['Completed', 'Awaiting Verification', 'Reassigned']) {
      expect(isTaskOverdue({ ...dueOct1, status }, later)).toBe(false);
    }
    expect(isTaskOverdue({ ...dueOct1, scheduleTbd: true }, later)).toBe(false);
  });
});

describe('isWebUrl', () => {
  test('only http(s) links are rendered as links', () => {
    expect(isWebUrl('https://drive.example/x.pdf')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('uploaded://receipt.pdf')).toBe(false);
  });
});

describe('relationTo', () => {
  const task = { assignerId: 'a1', doerId: 'd1' };

  test('the assigner owns the task; the doer does not', () => {
    expect(relationTo(task, { _id: 'a1', role: 'Billing' })).toEqual({ owner: true, assigner: true, doer: false });
    expect(relationTo(task, { _id: 'd1', role: 'Billing' })).toEqual({ owner: false, assigner: false, doer: true });
  });

  test('a manager owns every task', () => {
    expect(relationTo(task, { _id: 'm1', role: 'HR' }).owner).toBe(true);
  });
});
