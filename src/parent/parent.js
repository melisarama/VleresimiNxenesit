import { parentMoodIcons, parentMoods } from '../data/staticData.js';
import { createMaterialDownloadUrl } from '../services/teacherMaterialService.js';
import {
  archiveParentThread,
  fetchParentChildren,
  fetchParentWorkspaceData,
  markParentNotificationRead,
  markParentNotificationUnread,
  markParentThreadRead,
  saveParentDailyMood,
  saveParentNotificationPreferences,
  saveParentStudentPreferences,
  sendParentThreadMessage,
  startParentTeacherThread
} from '../services/parentService.js';
import { subscribeToUserNotifications } from '../services/realtimeService.js';
import { formatSqDate, todayIso } from '../utils/dates.js';
import { escapeHtml } from '../utils/html.js';

const viewLabels = {
  today: ['Perditesimi ditor', 'Sot'],
  progress: ['Vleresimet', 'Progresi'],
  materials: ['Materialet mesimore', 'Materialet'],
  messages: ['Komunikimi', 'Mesazhet'],
  notifications: ['Perditesimet', 'Njoftimet'],
  profile: ['Preferencat dhe llogaria', 'Profili']
};

const MAX_SUPPORT_PREFERENCES = 3;

function initials(name) {
  return name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(value, withTime = false) {
  return formatSqDate(value, { includeTime: withTime });
}

function notificationIcon(kind) {
  return {
    message: 'MSG',
    assessment: 'OK',
    final_grade: 'FG',
    material: 'MAT',
    teacher_notice: 'NR',
    daily_mood: 'DITA',
    pia: 'PIA'
  }[kind] || 'NEW';
}

function piaRatingLabel(rating) {
  return {
    1: 'Sapofilluar',
    2: 'Ne zhvillim',
    3: 'Po avancon',
    4: 'Shume afer',
    5: 'I arritur'
  }[Number(rating)] || 'Pa status';
}

function normalizeView(view) {
  return view === 'pia' ? 'progress' : view;
}

function normalizeSupportSelections(preferences = {}) {
  return preferences.support_preferences || preferences.learning_preferences || [];
}

function profileErrorMessage(error) {
  if (/MAX_PREFERENCES_EXCEEDED/i.test(error?.message || '')) {
    return 'Zgjidhni deri ne 3 preference kryesore.';
  }
  return error?.message || 'Profili nuk u ruajt.';
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
  let activeProgressTab = 'assessments';
  let moodHistoryOpen = false;
  let stopRealtime = null;
  let realtimeRefreshTimer = null;
  let realtimeRefreshVersion = 0;

  function showProgressTab(tab = activeProgressTab) {
    activeProgressTab = tab === 'pia' ? 'pia' : 'assessments';
    root.querySelectorAll('[data-parent-progress-tab]').forEach(button => {
      const active = button.dataset.parentProgressTab === activeProgressTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    root.querySelectorAll('[data-parent-progress-pane]').forEach(pane => {
      pane.classList.toggle('active', pane.dataset.parentProgressPane === activeProgressTab);
    });
    if (activeProgressTab === 'pia') renderPia();
  }

  function showView(view, { progressTab } = {}) {
    const normalizedView = normalizeView(view);
    root.querySelectorAll('[data-parent-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.parentPanel === normalizedView));
    root.querySelectorAll('[data-parent-view]').forEach(button => button.classList.toggle('active', button.dataset.parentView === normalizedView));
    document.getElementById('parentViewKicker').textContent = viewLabels[normalizedView][0];
    document.getElementById('parentViewTitle').textContent = viewLabels[normalizedView][1];
    if (normalizedView === 'progress') showProgressTab(progressTab || (view === 'pia' ? 'pia' : activeProgressTab));
    if (normalizedView === 'notifications') renderNotifications();
  }

  root.querySelectorAll('[data-parent-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.parentView)));
  root.querySelectorAll('[data-parent-progress-tab]').forEach(button => {
    button.addEventListener('click', () => showProgressTab(button.dataset.parentProgressTab));
  });

  function updateNotificationCounts() {
    const unread = (workspace?.notifications || []).filter(item => !item.read_at).length;
    root.querySelectorAll('[data-parent-view="notifications"]').forEach(button => {
      button.dataset.unreadCount = String(unread);
      button.title = unread ? `Njoftimet (${unread})` : 'Njoftimet';
    });
  }

  function renderChildOptions() {
    const options = children.map(item => `<option value="${item.id}"${item.id === child?.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    ['parentChildSelect', 'parentChildSelectMobile'].forEach(id => {
      document.getElementById(id).innerHTML = options;
    });
  }

  function renderIdentity() {
    const parentName = `${workspace.profile.first_name} ${workspace.profile.last_name}`.trim();
    document.getElementById('parentWelcomeName').textContent = parentName;
    document.getElementById('parentHeaderAvatar').textContent = initials(parentName);
    document.getElementById('parentSidebarAvatar').textContent = initials(parentName);
    root.querySelectorAll('[data-parent-name]').forEach(element => {
      element.textContent = parentName;
    });
    document.getElementById('parentChildName').textContent = child.name;
    document.getElementById('parentChildInitials').textContent = initials(child.name);
    document.getElementById('parentChildClass').textContent = child.className;
    document.getElementById('parentMoodQuestion').textContent = `Si eshte ${child.firstName} sot?`;
    document.getElementById('parentTodayDate').textContent = formatSqDate(new Date(), { weekday: true });
  }

  function renderMoodChoices() {
    const box = document.getElementById('parentMoodChoices');
    box.innerHTML = parentMoods.map(mood => `
      <button class="parent-mood-choice${mood === selectedMood ? ' active' : ''}" type="button" data-mood="${escapeHtml(mood)}">
        <img src="${parentMoodIcons[mood]}" alt="">
        <span>${escapeHtml(mood.substring(mood.indexOf(' ') + 1))}</span>
      </button>
    `).join('');
    box.querySelectorAll('[data-mood]').forEach(button => button.addEventListener('click', () => {
      selectedMood = button.dataset.mood;
      renderMoodChoices();
    }));
  }

  function renderToday() {
    const today = workspace.moods.find(item => item.reported_on === todayIso());
    const previousEntries = workspace.moods.filter(item => item.reported_on !== todayIso());
    selectedMood = today?.mood || parentMoods[0];
    document.getElementById('parentMoodComment').value = today?.general_comment || today?.parent_comment || '';
    document.getElementById('parentMoodStatus').textContent = today ? 'Perditesimi i sotem eshte ruajtur. Mund ta ridergoni.' : '';
    document.getElementById('parentMoodSubmit').textContent = today ? 'Ridergo perditesimin' : 'Dergo perditesimin';
    document.getElementById('parentHistoryToggle').textContent = moodHistoryOpen ? 'Fshih historikun' : 'Shiko historikun';
    renderMoodChoices();

    const history = document.getElementById('parentMoodHistory');
    history.classList.toggle('hidden', !moodHistoryOpen);
    history.innerHTML = `
      <div class="parent-section-heading">
        <div><p>Historiku</p><h2>Gjendjet e meparshme</h2></div>
        <button type="button" data-close-parent-history>Mbyll</button>
      </div>
      <div class="parent-history-list">
        ${previousEntries.length ? previousEntries.map(item => `
          <article class="parent-history-entry">
            <time>${escapeHtml(formatDate(`${item.reported_on}T12:00:00`))}</time>
            <strong>${escapeHtml(item.mood)}</strong>
            <p>${escapeHtml(item.general_comment || item.parent_comment || 'Pa koment shtese.')}</p>
          </article>
        `).join('') : '<div class="parent-empty-state"><strong>Pa hyrje te meparshme</strong><p>Gjendjet e kaluara do te shfaqen ketu per femijen e zgjedhur.</p></div>'}
      </div>
    `;
    history.querySelector('[data-close-parent-history]').addEventListener('click', () => {
      moodHistoryOpen = false;
      renderToday();
    });
  }

  function periodRows() {
    const rows = [...workspace.grades, ...workspace.finalGrades].map(item => item.academic_periods).filter(Boolean);
    return [...new Map(rows.map(item => [item.id, item])).values()];
  }

  function matchesSelectedPeriod(item) {
    return !selectedPeriodId || item.academic_period_id === selectedPeriodId;
  }

  function availableProgressSubjects() {
    const assignedSubjects = (workspace.teacherOptions || []).map(item => ({
      id: item.subject_id,
      name: item.subject_name
    }));
    const gradedSubjects = [...workspace.grades, ...workspace.finalGrades]
      .filter(matchesSelectedPeriod)
      .filter(item => item.subject_id && item.subjects?.name)
      .map(item => ({
        id: item.subject_id,
        name: item.subjects.name
      }));
    return [...new Map([...assignedSubjects, ...gradedSubjects].map(item => [item.id, item])).values()];
  }

  function renderProgressFilters() {
    const periods = periodRows();
    if (!periods.some(item => item.id === selectedPeriodId)) {
      selectedPeriodId = periods.find(item => item.status === 'active')?.id || periods[0]?.id || '';
    }

    const subjects = availableProgressSubjects();
    if (!subjects.some(item => item.id === selectedSubjectId)) {
      selectedSubjectId = subjects[0]?.id || '';
    }

    document.getElementById('parentProgressPeriod').innerHTML = periods.length
      ? periods.map(item => `<option value="${item.id}"${item.id === selectedPeriodId ? ' selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.school_year)}</option>`).join('')
      : '<option value="">Pa periudha</option>';
    document.getElementById('parentProgressSubject').innerHTML = subjects.length
      ? subjects.map(item => `<option value="${item.id}"${item.id === selectedSubjectId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
      : '<option value="">Pa lende</option>';
  }

  function renderProgress() {
    renderProgressFilters();
    const grades = workspace.grades.filter(item => matchesSelectedPeriod(item) && item.subject_id === selectedSubjectId);
    const finalGrade = workspace.finalGrades.find(item => matchesSelectedPeriod(item) && item.subject_id === selectedSubjectId);
    const average = grades.length ? grades.reduce((sum, item) => sum + Number(item.score), 0) / grades.length : null;

    document.getElementById('parentProgressSummary').innerHTML = `
      <article><span>Mesatarja</span><strong>${average === null ? '--' : `${average.toFixed(1).replace('.', ',')} / 5`}</strong></article>
      <article><span>Kapituj te vleresuar</span><strong>${grades.length}</strong></article>
      <article><span>Nota perfundimtare</span><strong>${finalGrade ? `${finalGrade.grade} / 5` : '--'}</strong></article>
    `;

    document.getElementById('parentAssessmentList').innerHTML = `
      ${finalGrade ? `
        <article class="parent-assessment-row parent-final-grade">
          <div>
            <strong>Nota perfundimtare</strong>
            <p>${escapeHtml(finalGrade.parent_message || 'Pa koment shtese.')}</p>
          </div>
          <span class="parent-assessment-score">${finalGrade.grade}/5</span>
        </article>
      ` : ''}
      ${grades.length ? grades.map(item => `
        <article class="parent-assessment-row">
          <div>
            <strong>${escapeHtml(item.chapters?.name || 'Kapitulli')}</strong>
            <p>${escapeHtml(item.parent_message || 'Pa koment nga mesimdhenesi.')}</p>
            <p>${escapeHtml(formatDate(item.updated_at || item.graded_at))}</p>
          </div>
          <span class="parent-assessment-score">${Number(item.score).toFixed(1).replace('.', ',')}</span>
        </article>
      `).join('') : '<div class="parent-empty-state"><strong>Pa vleresime</strong><p>Nuk ka ende vleresime per kete lende dhe periudhe.</p></div>'}
    `;
  }

  function renderPia() {
    const box = document.getElementById('parentPiaList');
    const objectives = (workspace.piaObjectives || []).slice().sort((left, right) => {
      if (left.active !== right.active) return Number(right.active) - Number(left.active);
      return new Date(right.updated_at) - new Date(left.updated_at);
    });

    box.innerHTML = objectives.length ? objectives.map(objective => {
      const updates = (workspace.piaUpdates || [])
        .filter(item => item.objective_id === objective.id)
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
      const latest = updates[0];

      return `
        <article class="parent-assessment-row${objective.active ? '' : ' parent-final-grade'}">
          <div>
            <strong>${escapeHtml(objective.title)}</strong>
            <p>${escapeHtml(objective.details || 'Pa pershkrim shtese.')}</p>
            <p>${escapeHtml(objective.assistantName || 'Asistenti')} · ${objective.active ? 'Objektiv aktiv' : 'Objektiv i mbyllur'}</p>
            ${latest ? `
              <p>Statusi i fundit: ${escapeHtml(formatDate(latest.created_at, true))} · ${latest.rating}/5 · ${escapeHtml(piaRatingLabel(latest.rating))}</p>
              <p>${escapeHtml(latest.comment)}</p>
            ` : '<p>Ende nuk ka raportim te ruajtur per kete objektiv.</p>'}
            ${updates.length > 1 ? `
              <div class="parent-history-list">
                ${updates.slice(1, 4).map(item => `
                  <article class="parent-history-entry">
                    <time>${escapeHtml(formatDate(item.created_at, true))}</time>
                    <strong>${item.rating}/5 · ${escapeHtml(piaRatingLabel(item.rating))}</strong>
                    <p>${escapeHtml(item.comment)}</p>
                  </article>
                `).join('')}
              </div>
            ` : ''}
          </div>
          <span class="parent-assessment-score">${latest ? `${latest.rating}/5` : '--'}</span>
        </article>
      `;
    }).join('') : '<div class="parent-empty-state"><strong>Pa objektiva PIA</strong><p>Asistenti ende nuk ka shtuar objektiva ose raportime per kete femije.</p></div>';
  }

  function renderMaterials() {
    const box = document.getElementById('parentMaterialList');
    box.innerHTML = workspace.materials.length ? workspace.materials.map(material => `
      <article class="parent-material-row">
        <span class="parent-material-icon">${material.class_material_files?.[0]?.mime_type === 'application/pdf' ? 'PDF' : material.class_material_files?.length ? 'IMG' : 'TXT'}</span>
        <div>
          <strong>${escapeHtml(material.title)}</strong>
          <p>${escapeHtml(material.subjects?.name || 'Lenda')} · ${escapeHtml(material.description || 'Pa pershkrim shtese.')}</p>
          <p>Publikuar: ${escapeHtml(formatDate(material.created_at))} · Fshihet: ${escapeHtml(formatDate(material.expires_at))}</p>
          <div class="parent-material-downloads">
            ${(material.class_material_files || []).map(file => `<button type="button" data-material-path="${escapeHtml(file.storage_path)}">Shkarko ${escapeHtml(file.original_name)}</button>`).join('')}
          </div>
        </div>
        <time>${escapeHtml(formatDate(material.created_at))}</time>
      </article>
    `).join('') : '<div class="parent-empty-state"><strong>Pa materiale</strong><p>Nuk ka ende materiale te publikuara per kete femije.</p></div>';

    box.querySelectorAll('[data-material-path]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        window.open(await createMaterialDownloadUrl(button.dataset.materialPath), '_blank', 'noopener,noreferrer');
      } catch (error) {
        window.alert(error.message || 'Skedari nuk mund te hapet. Provoni perseri.');
      } finally {
        button.disabled = false;
      }
    }));
  }

  function teacherLabel(thread) {
    const option = workspace.teacherOptions.find(item => item.teacher_id === thread.teacher_id && item.subject_id === thread.subject_id);
    return option ? `${option.teacher_name} · ${option.subject_name}` : thread.subjects?.name || 'Mesimdhenesi';
  }

  function teacherLabel(thread) {
    if (thread.assistant_teacher_id) {
      const assistantName = `${thread.assistant_profiles?.first_name || ''} ${thread.assistant_profiles?.last_name || ''}`.trim();
      return assistantName || 'Asistenti';
    }
    const option = workspace.teacherOptions.find(item => item.teacher_id === thread.teacher_id && item.subject_id === thread.subject_id);
    if (option) return `${option.teacher_name} - ${option.subject_name}`;
    const teacherName = `${thread.teacher_profiles?.first_name || ''} ${thread.teacher_profiles?.last_name || ''}`.trim();
    return teacherName ? `${teacherName}${thread.subjects?.name ? ` - ${thread.subjects.name}` : ''}` : (thread.subjects?.name || 'Mesimdhenesi');
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
      return `
        <button class="parent-thread-preview${unread ? ' unread' : ''}${thread.id === selectedThreadId ? ' active' : ''}" type="button" data-thread-id="${thread.id}">
          <strong>${escapeHtml(thread.title)}</strong>
          <time>${escapeHtml(formatDate(thread.updated_at))}</time>
          <span>${escapeHtml(teacherLabel(thread))}</span>
          <p>${escapeHtml(latest?.body || '')}</p>
        </button>
      `;
    }).join('') : '<div class="parent-empty-state"><strong>Pa biseda</strong><p>Filloni nje mesazh te ri per te kontaktuar nje mesimdhenes.</p></div>';

    box.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => openThread(button.dataset.threadId)));
  }

  async function openThread(threadId, markRead = true) {
    selectedThreadId = threadId;
    const thread = workspace.threads.find(item => item.id === threadId);
    if (!thread) return;

    if (markRead) {
      await markParentThreadRead(threadId);
      threadMessages(threadId).forEach(item => {
        if (item.sender_id !== user.id) item.read_at ||= new Date().toISOString();
      });
      workspace.notifications
        .filter(item => item.kind === 'message' && item.entity_id === threadId)
        .forEach(item => { item.read_at ||= new Date().toISOString(); });
    }

    const detail = document.getElementById('parentThreadDetail');
    detail.innerHTML = `
      <button class="teacher-back-button parent-message-mobile-back" type="button"><- Kthehu</button>
      <div class="parent-thread-heading">
        <div>
          <h2>${escapeHtml(thread.title)}</h2>
          <p>${escapeHtml(teacherLabel(thread))}</p>
        </div>
        <button type="button" data-archive-thread>Fshi nga kutia ime</button>
      </div>
      <div class="parent-message-stream">
        ${threadMessages(threadId).map(message => `
          <article class="parent-message-bubble${message.sender_id === user.id ? ' mine' : ''}">
            <p>${escapeHtml(message.body)}</p>
            <time>${escapeHtml(formatDate(message.created_at, true))}</time>
          </article>
        `).join('')}
      </div>
      <form class="parent-reply-form">
        <textarea maxlength="2000" required placeholder="Shkruani pergjigjen..."></textarea>
        <button class="parent-primary-button" type="submit">Dergo</button>
      </form>
    `;

    detail.classList.add('mobile-open');
    detail.querySelector('.parent-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('[data-archive-thread]').addEventListener('click', async () => {
      if (!window.confirm('Ta hiqni kete bisede nga kutia juaj?')) return;
      await archiveParentThread(threadId);
      workspace.threads = workspace.threads.filter(item => item.id !== threadId);
      selectedThreadId = null;
      detail.classList.remove('mobile-open');
      detail.innerHTML = '<div class="parent-empty-state"><span>MSG</span><strong>Zgjidhni nje bisede</strong></div>';
      renderThreads();
    });
    detail.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector('textarea');
      const saved = await sendParentThreadMessage(threadId, textarea.value);
      workspace.messages.push(saved);
      thread.updated_at = saved.created_at;
      await openThread(threadId);
    });

    renderThreads();
    updateNotificationCounts();
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
        <button type="button" data-notification-toggle="${item.id}" data-action="${item.read_at ? 'unread' : 'read'}">${item.read_at ? 'Sheno si te palexuar' : 'Sheno si te lexuar'}</button>
      </article>
    `).join('') : '<div class="parent-empty-state"><strong>Pa njoftime</strong><p>Nuk ka perditesime te reja.</p></div>';

    box.querySelectorAll('[data-notification-row]').forEach(row => {
      row.addEventListener('click', event => {
        if (event.target.closest('[data-notification-toggle]')) return;
        const item = workspace.notifications.find(result => result.id === row.dataset.notificationRow);
        if (!item) return;
        if (item.kind === 'message' && item.entity_id) {
          showView('messages');
          openThread(item.entity_id);
          return;
        }
        if (item.kind === 'pia') {
          showView('progress', { progressTab: 'pia' });
        }
      });
    });

    box.querySelectorAll('[data-notification-toggle]').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const notificationId = button.dataset.notificationToggle;
        const action = button.dataset.action;
        const item = workspace.notifications.find(result => result.id === notificationId);
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
        } catch (error) {
          console.error('Failed to toggle notification status:', error);
        } finally {
          renderNotifications();
          updateNotificationCounts();
        }
      });
    });
  }

  function syncSupportPreferenceLimit() {
    const inputs = [...document.querySelectorAll('[name="supportPreference"]')];
    const selectedCount = inputs.filter(input => input.checked).length;
    const helper = document.getElementById('parentPreferenceLimit');
    helper.textContent = selectedCount >= MAX_SUPPORT_PREFERENCES
      ? `Zgjedhur ${selectedCount}/${MAX_SUPPORT_PREFERENCES}`
      : `Zgjidhni deri ne ${MAX_SUPPORT_PREFERENCES}`;
    inputs.forEach(input => {
      input.disabled = !input.checked && selectedCount >= MAX_SUPPORT_PREFERENCES;
    });
  }

  function renderProfile() {
    const preferences = workspace.supportProfile?.preferences || {};
    const selected = normalizeSupportSelections(preferences);
    document.querySelectorAll('[name="supportPreference"]').forEach(input => {
      input.checked = selected.includes(input.value);
    });
    document.getElementById('parentCommunicationMethod').value = preferences.communication_method || '';
    document.getElementById('parentAdditionalSupportNotes').value = preferences.additional_notes || '';
    document.getElementById('parentNotificationEmail').value = workspace.preferences?.notification_email || workspace.profile.email || user.email || '';
    document.getElementById('parentTeacherMessageEmails').checked = workspace.preferences?.teacher_message_emails || false;
    document.getElementById('parentAssessmentEmails').checked = workspace.preferences?.assessment_emails || false;
    document.getElementById('parentMaterialEmails').checked = workspace.preferences?.material_emails || false;
    syncSupportPreferenceLimit();
  }

  function renderTeacherOptions() {
    document.getElementById('parentMessageTeacher').innerHTML = workspace.teacherOptions.length
      ? workspace.teacherOptions.map(option => `<option value="${option.teacher_id}|${option.subject_id}">${escapeHtml(option.teacher_name)} · ${escapeHtml(option.subject_name)}</option>`).join('')
      : '<option value="">Nuk ka mesimdhenes te caktuar</option>';
  }

  function renderAll() {
    renderChildOptions();
    renderIdentity();
    renderToday();
    renderProgress();
    renderPia();
    renderMaterials();
    renderThreads();
    renderNotifications();
    renderProfile();
    renderTeacherOptions();
    showProgressTab(activeProgressTab);
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
    moodHistoryOpen = false;
    renderAll();
  }

  ['parentChildSelect', 'parentChildSelectMobile'].forEach(id => {
    document.getElementById(id).addEventListener('change', event => {
      selectChild(event.target.value).catch(console.warn);
    });
  });
  document.getElementById('parentProgressPeriod').addEventListener('change', event => {
    selectedPeriodId = event.target.value;
    selectedSubjectId = '';
    renderProgress();
  });
  document.getElementById('parentProgressSubject').addEventListener('change', event => {
    selectedSubjectId = event.target.value;
    renderProgress();
  });
  document.querySelectorAll('[name="supportPreference"]').forEach(input => {
    input.addEventListener('change', () => {
      syncSupportPreferenceLimit();
      document.getElementById('parentProfileStatus').textContent = '';
    });
  });
  document.getElementById('parentHistoryToggle').addEventListener('click', () => {
    moodHistoryOpen = !moodHistoryOpen;
    renderToday();
  });
  document.getElementById('parentMoodForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentMoodStatus');
    const button = document.getElementById('parentMoodSubmit');
    button.disabled = true;
    try {
      const saved = await saveParentDailyMood({
        studentId: child.id,
        parentId: user.id,
        mood: selectedMood,
        comment: document.getElementById('parentMoodComment').value,
        reportedOn: todayIso()
      });
      workspace.moods = [saved, ...workspace.moods.filter(item => item.id !== saved.id && item.reported_on !== saved.reported_on)];
      renderToday();
      status.textContent = 'Perditesimi i sotem u ruajt. Mund ta ridergoni.';
    } catch (error) {
      status.textContent = error.message || 'Perditesimi nuk u ruajt.';
    } finally {
      button.disabled = false;
    }
  });

  const composer = document.getElementById('parentMessageComposer');
  document.getElementById('parentNewMessage').addEventListener('click', () => composer.classList.remove('hidden'));
  document.getElementById('parentCancelMessage').addEventListener('click', () => composer.classList.add('hidden'));
  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentMessageComposerStatus');
    const [teacherId, subjectId] = document.getElementById('parentMessageTeacher').value.split('|');
    if (!teacherId) {
      status.textContent = 'Ky femije nuk ka ende mesimdhenes te caktuar.';
      return;
    }
    try {
      const saved = await startParentTeacherThread({
        studentId: child.id,
        teacherId,
        subjectId,
        title: document.getElementById('parentMessageTitle').value,
        body: document.getElementById('parentMessageBody').value
      });
      composer.reset();
      composer.classList.add('hidden');
      workspace = await fetchParentWorkspaceData(child.id, user.id);
      renderAll();
      await openThread(saved.id);
    } catch (error) {
      status.textContent = error.message || 'Mesazhi nuk u dergua.';
    }
  });

  document.getElementById('parentMarkAllRead').addEventListener('click', async () => {
    await Promise.all(workspace.notifications.filter(item => !item.read_at).map(item => markParentNotificationRead(item.id)));
    workspace.notifications.forEach(item => {
      item.read_at ||= new Date().toISOString();
    });
    renderNotifications();
    updateNotificationCounts();
  });
  document.getElementById('parentChildProfileForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentProfileStatus');
    const selectedPreferences = [...document.querySelectorAll('[name="supportPreference"]:checked')].map(input => input.value);
    if (selectedPreferences.length > MAX_SUPPORT_PREFERENCES) {
      status.textContent = `Zgjidhni deri ne ${MAX_SUPPORT_PREFERENCES} preference kryesore.`;
      return;
    }
    try {
      workspace.supportProfile = await saveParentStudentPreferences({
        studentId: child.id,
        learningPreferences: selectedPreferences,
        communicationLanguage: '',
        communicationMethod: document.getElementById('parentCommunicationMethod').value,
        supportSummary: '',
        accessibilityInformation: '',
        additionalNotes: document.getElementById('parentAdditionalSupportNotes').value
      });
      renderProfile();
      status.textContent = 'Profili i femijes u ruajt.';
    } catch (error) {
      status.textContent = profileErrorMessage(error);
    }
  });
  document.getElementById('parentNotificationSettings').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('parentSettingsStatus');
    try {
      workspace.preferences = await saveParentNotificationPreferences({
        profileId: user.id,
        email: document.getElementById('parentNotificationEmail').value,
        teacherMessageEmails: document.getElementById('parentTeacherMessageEmails').checked,
        assessmentEmails: document.getElementById('parentAssessmentEmails').checked,
        materialEmails: document.getElementById('parentMaterialEmails').checked
      });
      status.textContent = 'Cilesimet e email-it u ruajten.';
    } catch (error) {
      status.textContent = error.message || 'Cilesimet nuk u ruajten.';
    }
  });

  const logoutDialog = document.getElementById('parentLogoutDialog');
  root.querySelectorAll('[data-parent-logout]').forEach(button => button.addEventListener('click', () => logoutDialog.showModal()));
  logoutDialog.addEventListener('close', () => {
    if (logoutDialog.returnValue === 'confirm') onLogout?.();
  });

  return {
    async login(nextUser) {
      stop();
      user = nextUser;
      const rows = await fetchParentChildren(user.id);
      children = rows.map(row => ({
        id: row.students.id,
        firstName: row.students.first_name,
        name: `${row.students.first_name} ${row.students.last_name}`,
        className: row.students.classes?.name || row.students.class_name || 'Pa klase'
      }));
      await selectChild(children[0]?.id);
      showView('today');
      startRealtime();
    },
    stop
  };
}
