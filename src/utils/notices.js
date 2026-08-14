import { escapeHtml } from './html.js';

export function readParentNotice(raw) {
  const fallback = { general: typeof raw === 'string' ? raw : '', subject: '', specific: '' };
  if (!raw || typeof raw !== 'string' || raw.trim()[0] !== '{') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2) {
      return {
        general: String(parsed.general || ''),
        subject: String(parsed.subject || ''),
        specific: String(parsed.specific || '')
      };
    }
  } catch (error) {}
  return fallback;
}

export function writeParentNotice(general, subject, specific) {
  return JSON.stringify({
    version: 2,
    general: general || '',
    subject: specific ? subject : '',
    specific: specific || ''
  });
}

export function noticeHistoryMarkup(raw, teacherSubject = '') {
  const notice = readParentNotice(raw);
  const rows = [];
  if (notice.general) rows.push('<p><strong>Për të gjithë:</strong> ' + escapeHtml(notice.general) + '</p>');
  if (notice.specific && (!teacherSubject || notice.subject === teacherSubject)) {
    rows.push('<p><strong>Vetëm për ' + escapeHtml(notice.subject) + ':</strong> ' + escapeHtml(notice.specific) + '</p>');
  }
  return rows.join('');
}
