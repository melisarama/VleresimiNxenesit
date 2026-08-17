import { parentMoodIcons, parentMoods } from '../data/staticData.js';
import { createMaterialDownloadUrl } from '../services/teacherMaterialService.js';
import {
  archiveParentThread,
  fetchParentChildren,
  fetchParentWorkspaceData,
  markParentNotificationRead,
  markParentNotificationUnread,
  markParentThreadRead,
  markParentThreadUnread,
  saveParentDailyMood,
  saveParentNotificationPreferences,
  saveParentStudentPreferences,
  sendParentThreadMessage,
  startParentTeacherThread
} from '../services/parentService.js';
import { subscribeToUserNotifications } from '../services/realtimeService.js';
import { todayIso } from '../utils/dates.js';
import { escapeHtml } from '../utils/html.js';

const viewLabels = {
  today: ['Përditësimi ditor', 'Sot'],
  progress: ['Vlerësimet', 'Progresi'],
  materials: ['Materialet mësimore', 'Materialet'],
  messages: ['Komunikimi', 'Mesazhet'],
  notifications: ['Përditësimet', 'Njoftimet'],
  profile: ['Preferencat dhe llogaria', 'Profili']
};

function initials(name) {
  return name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(value, withTime = false) {
  if (!value) return '';
  return new Intl.DateTimeFormat('sq-AL', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function notificationIcon(kind) {
  return { message: '◇', assessment: '✓', final_grade: '★', material: '▤', teacher_notice: '✉', daily_mood: '☀' }[kind] || '●';
}

export function initializeParentWorkflow({ onLogout } = {}) {
  const root = document.getElementById('parentDashboard');
  let user = null;
  let children = [];
  let child = null;
  let workspace = null;
  let selectedMood = parentMoods[0];
  let selectedThreadId = null;
  let selectedPeriodId = '';
  let selectedSubjectId = '';
  let stopRealtime = null;
  let realtimeRefreshTimer = null;
  let realtimeRefreshVersion = 0;

  function showView(view) {
    root.querySelectorAll('[data-parent-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.parentPanel === view));
    root.querySelectorAll('[data-parent-view]').forEach(button => button.classList.toggle('active', button.dataset.parentView === view));
    document.getElementById('parentViewKicker').textContent = viewLabels[view][0];
    document.getElementById('parentViewTitle').textContent = viewLabels[view][1];
    if (view === 'notifications') renderNotifications();
  }

  root.querySelectorAll('[data-parent-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.parentView)));

  function renderChildOptions() {
    const options = children.map(item => `<option value="${item.id}"${item.id === child?.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    ['parentChildSelect', 'parentChildSelectMobile'].forEach(id => { document.getElementById(id).innerHTML = options; });
  }

  function renderIdentity() {
    const parentName = `${workspace.profile.first_name} ${workspace.profile.last_name}`;
    document.getElementById('parentWelcomeName').textContent = parentName;
    document.getElementById('parentHeaderAvatar').textContent = initials(parentName);
    document.getElementById('parentSidebarAvatar').textContent = initials(parentName);
    root.querySelectorAll('[data-parent-name]').forEach(element => { element.textContent = parentName; });
    document.getElementById('parentChildName').textContent = child.name;
    document.getElementById('parentChildInitials').textContent = initials(child.name);
    document.getElementById('parentChildClass').textContent = child.className;
    document.getElementById('parentMoodQuestion').textContent = `Si është ${child.firstName} sot?`;
    document.getElementById('parentTodayDate').textContent = new Intl.DateTimeFormat('sq-AL', { dateStyle: 'full' }).format(new Date());
  }

  function renderMoodChoices() {
    const box = document.getElementById('parentMoodChoices');
    box.innerHTML = parentMoods.map(mood => `<button class="parent-mood-choice${mood === selectedMood ? ' active' : ''}" type="button" data-mood="${escapeHtml(mood)}"><img src="${parentMoodIcons[mood]}" alt=""><span>${escapeHtml(mood.substring(mood.indexOf(' ') + 1))}</span></button>`).join('');
    box.querySelectorAll('[data-mood]').forEach(button => button.addEventListener('click', () => { selectedMood = button.dataset.mood; renderMoodChoices(); }));
  }

  function renderToday() {
    const today = workspace.moods.find(item => item.reported_on === todayIso());
    selectedMood = today?.mood || parentMoods[0];
    document.getElementById('parentMoodComment').value = today?.general_comment || today?.parent_comment || '';
    document.getElementById('parentMoodStatus').textContent = today ? 'Përditësimi i sotëm është ruajtur. Mund ta ndryshoni.' : '';
    renderMoodChoices();
    const history = document.getElementById('parentMoodHistory');
    history.innerHTML = `<div class="parent-section-heading"><div><p>Historiku</p><h2>Gjendjet e mëparshme</h2></div><button type="button" data-close-parent-history>Mbyll</button></div><div class="parent-history-list">${workspace.moods.length ? workspace.moods.map(item => `<article class="parent-history-entry"><time>${escapeHtml(formatDate(`${item.reported_on}T12:00:00`))}</time><strong>${escapeHtml(item.mood)}</strong><p>${escapeHtml(item.general_comment || item.parent_comment || 'Pa koment shtesë.')}</p></article>`).join('') : '<p class="parent-empty-state">Nuk ka ende hyrje në historik.</p>'}</div>`;
    history.querySelector('[data-close-parent-history]').addEventListener('click', () => history.classList.add('hidden'));
  }

  function periodRows() {
    const rows = [...workspace.grades, ...workspace.finalGrades].map(item => item.academic_periods).filter(Boolean);
    return [...new Map(rows.map(item => [item.id, item])).values()];
  }

  function renderProgressFilters() {
    const periods = periodRows();
    if (!periods.some(item => item.id === selectedPeriodId)) selectedPeriodId = periods.find(item => item.status === 'active')?.id || periods[0]?.id || '';
    const relevant = workspace.grades.filter(item => !selectedPeriodId || item.academic_period_id === selectedPeriodId);
    const subjectRows = [...relevant, ...workspace.finalGrades.filter(item => !selectedPeriodId || item.academic_period_id === selectedPeriodId)];
    const subjects = [...new Map(subjectRows.filter(item => item.subjects).map(item => [item.subject_id, { id: item.subject_id, name: item.subjects.name }])).values()];
    if (!subjects.some(item => item.id === selectedSubjectId)) selectedSubjectId = subjectRows.find(item => item.subjects)?.subject_id || '';
    document.getElementById('parentProgressPeriod').innerHTML = periods.length ? periods.map(item => `<option value="${item.id}"${item.id === selectedPeriodId ? ' selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.school_year)}</option>`).join('') : '<option value="">Pa periudha</option>';
    document.getElementById('parentProgressSubject').innerHTML = subjects.length ? subjects.map(item => `<option value="${item.id}"${item.id === selectedSubjectId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('') : '<option value="">Pa lëndë</option>';
  }

  function renderProgress() {
    renderProgressFilters();
    const grades = workspace.grades.filter(item => item.academic_period_id === selectedPeriodId && item.subject_id === selectedSubjectId);
    const finalGrade = workspace.finalGrades.find(item => item.academic_period_id === selectedPeriodId && item.subject_id === selectedSubjectId);
    const average = grades.length ? grades.reduce((sum, item) => sum + Number(item.score), 0) / grades.length : null;
    document.getElementById('parentProgressSummary').innerHTML = `<article><span>Mesatarja</span><strong>${average === null ? '—' : `${average.toFixed(1).replace('.', ',')} / 5`}</strong></article><article><span>Kapituj të vlerësuar</span><strong>${grades.length}</strong></article><article><span>Nota përfundimtare</span><strong>${finalGrade ? `${finalGrade.grade} / 5` : '—'}</strong></article>`;
    document.getElementById('parentAssessmentList').innerHTML = `${finalGrade ? `<article class="parent-assessment-row parent-final-grade"><div><strong>Nota përfundimtare</strong><p>${escapeHtml(finalGrade.parent_message || 'Pa koment shtesë.')}</p></div><span class="parent-assessment-score">${finalGrade.grade}/5</span></article>` : ''}${grades.length ? grades.map(item => `<article class="parent-assessment-row"><div><strong>${escapeHtml(item.chapters?.name || 'Kapitulli')}</strong><p>${escapeHtml(item.parent_message || 'Pa koment nga mësimdhënësi.')}</p><p>${escapeHtml(formatDate(item.updated_at || item.graded_at))}</p></div><span class="parent-assessment-score">${Number(item.score).toFixed(1).replace('.', ',')}</span></article>`).join('') : '<div class="parent-empty-state"><strong>Pa vlerësime</strong><p>Nuk ka ende vlerësime për këtë lëndë dhe periudhë.</p></div>'}`;
  }

  function renderMaterials() {
    const box = document.getElementById('parentMaterialList');
    box.innerHTML = workspace.materials.length ? workspace.materials.map(material => `<article class="parent-material-row"><span class="parent-material-icon">${material.class_material_files?.[0]?.mime_type === 'application/pdf' ? 'PDF' : material.class_material_files?.length ? 'IMG' : 'TXT'}</span><div><strong>${escapeHtml(material.title)}</strong><p>${escapeHtml(material.subjects?.name || 'Lënda')} · ${escapeHtml(material.description || 'Pa përshkrim shtesë.')}</p><p>Publikuar: ${escapeHtml(formatDate(material.created_at))} · Fshihet: ${escapeHtml(formatDate(material.expires_at))}</p><div class="parent-material-downloads">${(material.class_material_files || []).map(file => `<button type="button" data-material-path="${escapeHtml(file.storage_path)}">↓ ${escapeHtml(file.original_name)}</button>`).join('')}</div></div><time>${escapeHtml(formatDate(material.created_at))}</time></article>`).join('') : '<div class="parent-empty-state"><strong>Pa materiale</strong><p>Nuk ka ende materiale të publikuara për këtë fëmijë.</p></div>';
    box.querySelectorAll('[data-material-path]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        window.open(await createMaterialDownloadUrl(button.dataset.materialPath), '_blank', 'noopener,noreferrer');
      } catch (error) {
        window.alert(error.message || 'Skedari nuk mund të hapet. Provoni përsëri.');
      } finally {
        button.disabled = false;
      }
    }));
  }

  function teacherLabel(thread) {
    const option = workspace.teacherOptions.find(item => item.teacher_id === thread.teacher_id && item.subject_id === thread.subject_id);
    return option ? `${option.teacher_name} · ${option.subject_name}` : thread.subjects?.name || 'Mësimdhënësi';
  }

  function threadMessages(threadId) {
    return workspace.messages.filter(item => item.thread_id === threadId);
  }

  function renderThreads() {
    const box = document.getElementById('parentThreadList');
    box.innerHTML = workspace.threads.length ? workspace.threads.map(thread => {
      const messages = threadMessages(thread.id);
      const latest = messages[messages.length - 1];
      const unread = messages.some(item => item.sender_id !== user.id && !item.read_at);
      return `<button class="parent-thread-preview${unread ? ' unread' : ''}${thread.id === selectedThreadId ? ' active' : ''}" type="button" data-thread-id="${thread.id}"><strong>${escapeHtml(thread.title)}</strong><time>${escapeHtml(formatDate(thread.updated_at))}</time><span>${escapeHtml(teacherLabel(thread))}</span><p>${escapeHtml(latest?.body || '')}</p></button>`;
    }).join('') : '<div class="parent-empty-state"><strong>Pa biseda</strong><p>Filloni një mesazh të ri për të kontaktuar një mësimdhënës.</p></div>';
    box.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => openThread(button.dataset.threadId)));
  }

  async function openThread(threadId, markRead = true) {
    selectedThreadId = threadId;
    const thread = workspace.threads.find(item => item.id === threadId);
    if (!thread) return;
    if (markRead) {
      await markParentThreadRead(threadId);
      threadMessages(threadId).forEach(item => { if (item.sender_id !== user.id) item.read_at ||= new Date().toISOString(); });
      workspace.notifications.filter(item => item.kind === 'message' && item.entity_id === threadId).forEach(item => { item.read_at ||= new Date().toISOString(); });
    }
    const detail = document.getElementById('parentThreadDetail');
    detail.innerHTML = `<button class="teacher-back-button parent-message-mobile-back" type="button">← Kthehu</button><div class="parent-thread-heading"><div><h2>${escapeHtml(thread.title)}</h2><p>${escapeHtml(teacherLabel(thread))}</p></div><button type="button" data-archive-thread>Fshi nga kutia ime</button></div><div class="parent-message-stream">${threadMessages(threadId).map(message => `<article class="parent-message-bubble${message.sender_id === user.id ? ' mine' : ''}"><p>${escapeHtml(message.body)}</p><time>${escapeHtml(formatDate(message.created_at, true))}</time></article>`).join('')}</div><form class="parent-reply-form"><textarea maxlength="2000" required placeholder="Shkruani përgjigjen..."></textarea><button class="parent-primary-button" type="submit">Dërgo</button></form>`;
    detail.classList.add('mobile-open');
    detail.querySelector('.parent-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('[data-archive-thread]').addEventListener('click', async () => {
      if (!window.confirm('Ta hiqni këtë bisedë nga kutia juaj?')) return;
      await archiveParentThread(threadId);
      workspace.threads = workspace.threads.filter(item => item.id !== threadId);
      selectedThreadId = null;
      detail.classList.remove('mobile-open');
      detail.innerHTML = '<div class="parent-empty-state"><span>◇</span><strong>Zgjidhni një bisedë</strong></div>';
      renderThreads();
    });
    detail.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector('textarea');
      const saved = await sendParentThreadMessage(threadId, textarea.value);
      workspace.messages.push(saved);
      thread.updated_at = saved.created_at;
      openThread(threadId);
    });
    renderThreads();
  }

  function renderNotifications() {
    const box = document.getElementById('parentNotificationList');
    box.innerHTML = workspace.notifications.length ? workspace.notifications.map(item => `
      <article class="parent-notification-row${item.read_at ? '' : ' unread'}" data-notification-row="${item.id}">
        <span>${notificationIcon(item.kind)}</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
        </div>
        <time>${escapeHtml(formatDate(item.created_at, true))}</time>
        <button type="button" data-notification-toggle="${item.id}" data-action="${item.read_at ? 'unread' : 'read'}">${item.read_at ? 'Shëno si të palexuar' : 'Shëno si të lexuar'}</button>
      </article>`).join('') : '<div class="parent-empty-state"><strong>Pa njoftime</strong><p>Nuk ka përditësime të reja.</p></div>';

    box.querySelectorAll('[data-notification-row]').forEach(row => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('[data-notification-toggle]')) return;
        const item = workspace.notifications.find(r => r.id === row.dataset.notificationRow);
        if (!item) return;
        if (item.kind === 'message' && item.entity_id) {
          showView('messages');
          openThread(item.entity_id);
        }
      });
    });

    box.querySelectorAll('[data-notification-toggle]').forEach(button => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const notificationId = button.dataset.notificationToggle;
        const action = button.dataset.action;
        const item = workspace.notifications.find(r => r.id === notificationId);
        if (!item) return;
        button.disabled = true;
        try {
          if (action === 'unread') {
            await markParentNotificationUnread(notificationId);
            item.read_at = null;
          } else {
            await markParentNotificationRead(notificationId);
            item.read_at = new Date().toISOString();
          }
        } catch (e) {
          console.error('Failed to toggle notification status:', e);
        } finally {
          renderNotifications();
        }
      });
    });
  }

  function renderProfile() {
    const preferences = workspace.supportProfile?.preferences || {};
    const selected = preferences.learning_preferences || [];
    document.querySelectorAll('[name="learningPreference"]').forEach(input => { input.checked = selected.includes(input.value); });
    document.getElementById('parentCommunicationLanguage').value = preferences.communication_language || '';
    document.getElementById('parentCommunicationMethod').value = preferences.communication_method || '';
    document.getElementById('parentNotificationEmail').value = workspace.preferences?.notification_email || workspace.profile.email || user.email || '';
    document.getElementById('parentTeacherMessageEmails').checked = workspace.preferences?.teacher_message_emails || false;
    document.getElementById('parentAssessmentEmails').checked = workspace.preferences?.assessment_emails || false;
    document.getElementById('parentMaterialEmails').checked = workspace.preferences?.material_emails || false;
  }

  function renderTeacherOptions() {
    document.getElementById('parentMessageTeacher').innerHTML = workspace.teacherOptions.length
      ? workspace.teacherOptions.map(option => `<option value="${option.teacher_id}|${option.subject_id}">${escapeHtml(option.teacher_name)} · ${escapeHtml(option.subject_name)}</option>`).join('')
      : '<option value="">Nuk ka mësimdhënës të caktuar</option>';
  }

  function renderAll() {
    renderChildOptions();
    renderIdentity();
    renderToday();
    renderProgress();
    renderMaterials();
    renderThreads();
    renderNotifications();
    renderProfile();
    renderTeacherOptions();
    updateNotificationCounts();
  }

  async function refreshFromRealtime(expectedStudentId, version) {
    try {
      const nextWorkspace = await fetchParentWorkspaceData(expectedStudentId, user.id);
      if (version !== realtimeRefreshVersion || child?.id !== expectedStudentId) return;
      const openThreadId = selectedThreadId;
      workspace = nextWorkspace;
      renderAll();
      if (openThreadId && workspace.threads.some(thread => thread.id === openThreadId)) {
        selectedThreadId = openThreadId;
        await openThread(openThreadId, false);
      }
    } catch (error) {
      console.warn('Parent Realtime refresh:', error.message);
    }
  }

  function scheduleRealtimeRefresh(payload) {
    if (!user || !child || (payload.new?.student_id && payload.new.student_id !== child.id)) return;
    if (payload.eventType === 'INSERT' && payload.new?.kind === 'message' && payload.new.entity_id === selectedThreadId) {
      markParentThreadRead(selectedThreadId).catch(error => console.warn('Parent Realtime read:', error.message));
    }
    clearTimeout(realtimeRefreshTimer);
    const expectedStudentId = child.id;
    const version = ++realtimeRefreshVersion;
    realtimeRefreshTimer = setTimeout(() => refreshFromRealtime(expectedStudentId, version), 180);
  }

  function startRealtime() {
    stopRealtime?.();
    stopRealtime = subscribeToUserNotifications(user.id, scheduleRealtimeRefresh);
  }

  function stop() {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshVersion += 1;
    stopRealtime?.();
    stopRealtime = null;
  }

  async function selectChild(studentId) {
    child = children.find(item => item.id === studentId) || children[0];
    if (!child) throw new Error('PARENT_STUDENT_MISSING');
    workspace = await fetchParentWorkspaceData(child.id, user.id);
    selectedThreadId = null;
    selectedPeriodId = '';
    selectedSubjectId = '';
    renderAll();
  }

  ['parentChildSelect', 'parentChildSelectMobile'].forEach(id => document.getElementById(id).addEventListener('change', event => selectChild(event.target.value).catch(console.warn)));
  document.getElementById('parentProgressPeriod').addEventListener('change', event => { selectedPeriodId = event.target.value; selectedSubjectId = ''; renderProgress(); });
  document.getElementById('parentProgressSubject').addEventListener('change', event => { selectedSubjectId = event.target.value; renderProgress(); });
  document.getElementById('parentHistoryToggle').addEventListener('click', () => document.getElementById('parentMoodHistory').classList.toggle('hidden'));
  document.getElementById('parentMoodForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentMoodStatus');
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const saved = await saveParentDailyMood({ studentId: child.id, parentId: user.id, mood: selectedMood, comment: document.getElementById('parentMoodComment').value, reportedOn: todayIso() });
      workspace.moods = [saved, ...workspace.moods.filter(item => item.id !== saved.id && item.reported_on !== saved.reported_on)];
      status.textContent = 'Përditësimi iu dërgua mësimdhënësve të fëmijës.';
      renderToday();
    } catch (error) { status.textContent = error.message || 'Përditësimi nuk u ruajt.'; } finally { button.disabled = false; }
  });

  const composer = document.getElementById('parentMessageComposer');
  document.getElementById('parentNewMessage').addEventListener('click', () => composer.classList.remove('hidden'));
  document.getElementById('parentCancelMessage').addEventListener('click', () => composer.classList.add('hidden'));
  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentMessageComposerStatus');
    const [teacherId, subjectId] = document.getElementById('parentMessageTeacher').value.split('|');
    if (!teacherId) {
      status.textContent = 'Ky fëmijë nuk ka ende mësimdhënës të caktuar.';
      return;
    }
    try {
      const saved = await startParentTeacherThread({ studentId: child.id, teacherId, subjectId, title: document.getElementById('parentMessageTitle').value, body: document.getElementById('parentMessageBody').value });
      composer.reset();
      composer.classList.add('hidden');
      workspace = await fetchParentWorkspaceData(child.id, user.id);
      renderAll();
      openThread(saved.id);
    } catch (error) { status.textContent = error.message || 'Mesazhi nuk u dërgua.'; }
  });

  document.getElementById('parentMarkAllRead').addEventListener('click', async () => {
    await Promise.all(workspace.notifications.filter(item => !item.read_at).map(item => markParentNotificationRead(item.id)));
    workspace.notifications.forEach(item => { item.read_at ||= new Date().toISOString(); });
    renderNotifications();
    updateNotificationCounts();
  });
  document.getElementById('parentChildProfileForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentProfileStatus');
    try {
      workspace.supportProfile = await saveParentStudentPreferences({ studentId: child.id, learningPreferences: [...document.querySelectorAll('[name="learningPreference"]:checked')].map(input => input.value), communicationLanguage: document.getElementById('parentCommunicationLanguage').value, communicationMethod: document.getElementById('parentCommunicationMethod').value });
      status.textContent = 'Profili i fëmijës u ruajt.';
    } catch (error) { status.textContent = error.message || 'Profili nuk u ruajt.'; }
  });
  document.getElementById('parentNotificationSettings').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentSettingsStatus');
    try {
      workspace.preferences = await saveParentNotificationPreferences({ profileId: user.id, email: document.getElementById('parentNotificationEmail').value, teacherMessageEmails: document.getElementById('parentTeacherMessageEmails').checked, assessmentEmails: document.getElementById('parentAssessmentEmails').checked, materialEmails: document.getElementById('parentMaterialEmails').checked });
      status.textContent = 'Cilësimet e email-it u ruajtën.';
    } catch (error) { status.textContent = error.message || 'Cilësimet nuk u ruajtën.'; }
  });

  const logoutDialog = document.getElementById('parentLogoutDialog');
  root.querySelectorAll('[data-parent-logout]').forEach(button => button.addEventListener('click', () => logoutDialog.showModal()));
  logoutDialog.addEventListener('close', () => { if (logoutDialog.returnValue === 'confirm') onLogout?.(); });

  return {
    async login(nextUser) {
      stop();
      user = nextUser;
      const rows = await fetchParentChildren(user.id);
      children = rows.map(row => ({ id: row.students.id, firstName: row.students.first_name, name: `${row.students.first_name} ${row.students.last_name}`, className: row.students.classes?.name || row.students.class_name || 'Pa klasë' }));
      await selectChild(children[0]?.id);
      showView('today');
      startRealtime();
    },
    stop
  };
}
