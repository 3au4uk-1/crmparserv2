import { extractBookingNumbers } from './booking-numbers.js';
import { fetchEvents } from './parser.js';
import { toInputDate } from '../utils/crm-dates.js';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Find calendar events whose title contains bookingNumber.
 * Searches ±daysRadius from today.
 */
export async function findCalendarEventsByBooking(bookingNumber, daysRadius = 90) {
  const now = new Date();
  const start = addDays(now, -daysRadius);
  const end = addDays(now, daysRadius);

  const events = await fetchEvents(toInputDate(start), toInputDate(end));
  return events.filter((ev) => {
    const title = ev.title || ev.NAME || '';
    return extractBookingNumbers(title).includes(bookingNumber);
  });
}
