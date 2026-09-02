const SQ_MONTHS = [
  'janar',
  'shkurt',
  'mars',
  'prill',
  'maj',
  'qershor',
  'korrik',
  'gusht',
  'shtator',
  'tetor',
  'nentor',
  'dhjetor'
];

const SQ_WEEKDAYS = [
  'e diel',
  'e hene',
  'e marte',
  'e merkure',
  'e enjte',
  'e premte',
  'e shtune'
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(`${value.trim()}T12:00:00`);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function schoolDayIso(reference = new Date()) {
  const date = parseDateInput(reference) || new Date();
  const normalized = new Date(date.getTime());
  const day = normalized.getDay();
  if (day === 6) normalized.setDate(normalized.getDate() - 1);
  if (day === 0) normalized.setDate(normalized.getDate() - 2);
  return normalized.toISOString().slice(0, 10);
}

export function formatSqDate(value, { includeTime = false, weekday = false } = {}) {
  const date = parseDateInput(value);
  if (!date) return '';
  const prefix = weekday ? `${SQ_WEEKDAYS[date.getDay()]}, ` : '';
  const dateLabel = `${date.getDate()} ${SQ_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  if (!includeTime) return `${prefix}${dateLabel}`;
  return `${prefix}${dateLabel}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
