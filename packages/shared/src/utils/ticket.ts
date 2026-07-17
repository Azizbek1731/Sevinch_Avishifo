import { TICKET_NUMBER_PAD } from '../constants';

/** Build display ticket number: ("A", 13) → "A-013". */
export function formatTicketNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(TICKET_NUMBER_PAD, '0')}`;
}
