import {
  archiveAssistantThread,
  deleteAssistantNotification,
  markAssistantNotificationRead,
  markAssistantNotificationUnread,
  markAssistantThreadRead,
  markAssistantThreadUnread,
  recordAssistantPiaUpdate,
  saveAssistantNotificationPreferences,
  saveAssistantPiaObjective,
  sendAssistantThreadMessage,
  startAssistantThread
} from '../services/teacherService.js';
import { formatSqDate, schoolDayIso } from '../utils/dates.js';

const titles = {
  students: ['Femijet e caktuar', 'Nxenesit'],
  'student-folder': ['Dosja e nxenesit', 'Dosja'],
  'folder-detail': ['Historiku dhe mbeshtetja', 'Detajet'],
  pia: ['Plani individual', 'PIA'],
  messages: ['Komunikimi me familjen dhe stafin', 'Mesazhet'],
  settings: ['Llogaria dhe preferencat', 'Cilesimet']
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'AT';
}

function formatDate(value, includeTime = true) {
  return formatSqDate(value, { includeTime });
}

function ratingLabel(rating) {
  return {
    1: 'Sapofilluar',
    2: 'Ne zhvillim',
    3: 'Po avancon',
    4: 'Shume afer',
    5: 'I qendrueshem'
  }[Number(rating)] || 'Pa status';
}

function notificationBody(item) {
  return item.notification?.body || item.body || '';
}

function messageSenderLabel(thread, senderId, assistantId) {
  if (senderId === assistantId) return 'Ju';
  if (thread.parent_id && senderId === thread.parent_id) return 'Prindi';
  if (thread.teacher_id && senderId === thread.teacher_id) return 'Mesimdhenesi';
  return 'Kontakti';
}

function recipientRoleLabel(role) {
  return role === 'teacher' ? 'Mesimdhenesi' : 'Prindi';
}

function recipientValue(option) {
  return [option.recipient_role, option.recipient_id, option.subject_id || ''].join('|');
}

function parseRecipientValue(value = '') {
  const [role = '', recipientId = '', subjectId = ''] = value.split('|');
  return {
    role,
    recipientId,
    subjectId: subjectId || null
  };
}

function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function ensureAssistantStructure(root) {
  const sidebarNav = root.querySelector('.teacher-prototype-nav');
  const mobileNav = root.querySelector('.teacher-mobile-nav');
  const headerActions = root.querySelector('.teacher-header-actions');
  const main = root.querySelector('.teacher-prototype-main');

  if (sidebarNav && !sidebarNav.querySelector('[data-assistant-view="messages"]')) {
    sidebarNav.insertAdjacentHTML('beforeend', `
      <button type="button" data-assistant-view="messages"><span class="tp-icon" aria-hidden="true">◇</span><span>Mesazhet</span><span class="teacher-nav-count" data-assistant-message-count hidden>0</span></button>
      <button type="button" data-assistant-view="settings"><span class="tp-icon" aria-hidden="true">⚙</span><span>Cilesimet</span></button>
    `);
  }

  if (headerActions && !headerActions.querySelector('[data-open-assistant-messages]')) {
    headerActions.insertAdjacentHTML('afterbegin', '<button type="button" data-open-assistant-messages aria-label="Hap mesazhet" title="Mesazhet">◇<span data-assistant-message-count hidden>0</span></button>');
  }

  if (main && !main.querySelector('[data-assistant-panel="messages"]')) {
    main.insertAdjacentHTML('beforeend', `
      <section class="teacher-prototype-view" data-assistant-panel="messages">
        <div class="teacher-section-heading">
          <div><p>Komunikimi</p><h2>Mesazhet</h2></div>
          <div class="assistant-message-toolbar">
            <button class="teacher-filter-button" type="button" id="assistantUnreadFilter">Vetem te palexuarat</button>
            <button class="teacher-primary-button" type="button" id="assistantNewMessage">+ Mesazh i ri</button>
          </div>
        </div>
        <form class="teacher-composer hidden" id="assistantMessageComposer">
          <div class="teacher-form-grid">
            <label>Nxenesi<select id="assistantMessageStudent"></select></label>
            <label>Marresi<select id="assistantMessageRecipient" required></select></label>
          </div>
          <p class="assistant-message-recipient-note" id="assistantMessageRecipientNote"></p>
          <label>Subjekti<input id="assistantMessageTitle" required maxlength="160" placeholder="P.sh. Perditesim i shkurter per diten"></label>
          <label>Mesazhi<textarea id="assistantMessageBody" required maxlength="2000" rows="5" placeholder="Shkruani nje permbledhje te shkurter per progresin ose nje ceshtje qe duhet ndare."></textarea></label>
          <p class="teacher-message-action-status" id="assistantMessageComposerStatus" aria-live="polite"></p>
          <div class="teacher-form-actions">
            <button type="button" id="assistantCancelMessage">Anulo</button>
            <button class="teacher-primary-button" type="submit">Dergo</button>
          </div>
        </form>
        <div class="teacher-email-callout">
          <span>✉</span>
          <div>
            <strong>Komunikim i sigurt me familjen dhe stafin</strong>
            <p>Perdoreni kete hapesire per perditesime te qarta rreth progresit dhe mbeshtetjes se nxenesit.</p>
          </div>
          <button type="button" data-assistant-view="settings">Konfiguro</button>
        </div>
        <div class="teacher-inbox-layout">
          <div class="teacher-message-list" id="assistantMessageList"></div>
          <article class="teacher-message-detail" id="assistantMessageDetail">
            <div class="teacher-empty-message"><span>◇</span><strong>Zgjidhni nje mesazh</strong><p>Biseda dhe pergjigjet do te shfaqen ketu.</p></div>
          </article>
        </div>
      </section>

      <section class="teacher-prototype-view" data-assistant-panel="settings">
        <div class="teacher-settings-layout">
          <section>
            <h2>Njoftimet me email</h2>
            <p>Zgjidhni si deshironi te njoftoheni jashte platformes.</p>
            <label class="teacher-setting-field">Email-i per njoftime<input id="assistantNotificationEmail" type="email" placeholder="emri@shkolla.edu"></label>
            <label class="teacher-toggle-row"><span><strong>Mesazhet e reja</strong><small>Dergo email sa here qe nje prind ose mesimdhenes ju shkruan.</small></span><input id="assistantParentMessageEmails" type="checkbox" role="switch"></label>
            <label class="teacher-toggle-row"><span><strong>Permbledhje ditore</strong><small>Ky opsion do te vije me vone bashke me sistemin e plote te email-eve.</small></span><input id="assistantDailyDigestEmails" type="checkbox" role="switch" disabled></label>
            <button class="teacher-primary-button" id="assistantSaveSettings" type="button">Ruaj cilesimet</button>
            <p class="teacher-save-status" id="assistantSettingsStatus"></p>
          </section>
          <section>
            <h2>Rreth rolit</h2>
            <p>Ky panel ndihmon asistentin te ndjeke objektivat PIA dhe te komunikoje shpejt me familjen dhe mesimdhenesit per te njejtin nxenes.</p>
            <dl>
              <div><dt>Versioni</dt><dd>Prototip 0.1</dd></div>
              <div><dt>Ekipi</dt><dd>Hackathon Project</dd></div>
            </dl>
          </section>
        </div>
      </section>
    `);
  }

  if (mobileNav && !mobileNav.querySelector('[data-assistant-view="messages"]')) {
    mobileNav.insertAdjacentHTML('beforeend', `
      <button type="button" data-assistant-view="messages"><span class="mobile-badge-icon">◇<b data-assistant-message-count hidden>0</b></span><small>Mesazhet</small></button>
      <button type="button" data-assistant-view="settings"><span>⚙</span><small>Cilesimet</small></button>
    `);
  }

  if (!root.querySelector('#assistantPiaCommentDialog')) {
    root.insertAdjacentHTML('beforeend', `
      <dialog class="assistant-pia-dialog" id="assistantPiaCommentDialog" aria-labelledby="assistantPiaCommentTitle">
        <form method="dialog" class="assistant-pia-dialog-form" id="assistantPiaCommentForm">
          <div class="assistant-pia-dialog-head">
            <div>
              <span class="assistant-pia-kicker" id="assistantPiaCommentKicker">Jep koment</span>
              <h2 id="assistantPiaCommentTitle">Objektivi</h2>
            </div>
            <button type="button" id="assistantPiaCommentClose" aria-label="Mbyll">×</button>
          </div>
          <p class="assistant-pia-dialog-copy" id="assistantPiaCommentDetails"></p>
          <label>Statusi i objektives
            <select id="assistantPiaCommentRating" required></select>
          </label>
          <label>Komenti per mesimdhenesin dhe prindin
            <textarea id="assistantPiaCommentText" rows="5" maxlength="2000" required placeholder="Shkruani cfare u vu re sot, cfare funksionoi dhe ku ndodhet femija me kete objektiv."></textarea>
          </label>
          <p class="teacher-save-status" id="assistantPiaCommentStatus" aria-live="polite"></p>
          <div class="assistant-pia-dialog-actions">
            <button type="button" id="assistantPiaCommentCancel">Anulo</button>
            <button class="teacher-primary-button" type="submit" id="assistantPiaCommentSubmit">Ruaj</button>
          </div>
        </form>
      </dialog>
    `);
  }
}

export function initializeAssistantTeacherPrototype({ onLogout } = {}) {
  const root = document.getElementById('assistantTeacherPrototype');
  if (!root) return { setData() {} };

  ensureAssistantStructure(root);

  let students = [];
  let selectedStudent = null;
  let moodHistories = {};
  let assistantName = 'Asistent';
  let assistantEmail = '';
  let assistantId = null;
  let piaObjectives = [];
  let piaUpdates = [];
  let piaStudentId = '';
  let piaStatus = '';
  let piaError = '';
  let updateObjectiveId = null;
  let achievementObjectiveId = null;
  let messages = [];
  let activeMessageId = null;
  let unreadOnly = false;
  let messageRecipients = {};
  let messageStudentId = '';
  let notificationPreferences = null;

  const panels = [...root.querySelectorAll('[data-assistant-panel]')];
  const navButtons = [...root.querySelectorAll('[data-assistant-view]')];
  const title = document.getElementById('assistantViewTitle');
  const kicker = document.getElementById('assistantViewKicker');
  const logoutDialog = document.getElementById('assistantTeacherLogoutDialog');
  const commentDialog = document.getElementById('assistantPiaCommentDialog');

  function commentObjective() {
    return piaObjectives.find(item => item.id === updateObjectiveId) || null;
  }

  function activePanelName() {
    return panels.find(panel => panel.classList.contains('active'))?.dataset.assistantPanel || 'students';
  }

  function showPanel(name, updateNavigation = true) {
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.assistantPanel === name));
    if (updateNavigation) {
      navButtons.forEach(button => button.classList.toggle('active', button.dataset.assistantView === name));
    }
    if (titles[name]) {
      kicker.textContent = titles[name][0];
      title.textContent = titles[name][1];
    }
    if (name === 'pia') renderPiaPanel();
    if (name === 'messages') renderMessages();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function studentsForQuery(query = '') {
    const normalized = query.trim().toLocaleLowerCase('sq');
    return students.filter(student => student.name.toLocaleLowerCase('sq').includes(normalized));
  }

  function objectiveUpdates(objectiveId) {
    return piaUpdates
      .filter(item => item.objective_id === objectiveId)
      .sort((left, right) => {
        const leftDate = left.reported_on || left.created_at;
        const rightDate = right.reported_on || right.created_at;
        return new Date(rightDate) - new Date(leftDate) || new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at);
      });
  }

  function currentSchoolDayUpdate(objectiveId) {
    return objectiveUpdates(objectiveId).find(item => item.reported_on === schoolDayIso()) || null;
  }

  function closeCommentDialog() {
    const status = document.getElementById('assistantPiaCommentStatus');
    const form = document.getElementById('assistantPiaCommentForm');
    if (status) status.textContent = '';
    if (form) form.reset();
    if (commentDialog?.open) commentDialog.close('cancel');
  }

  function openCommentDialog(objectiveId) {
    updateObjectiveId = objectiveId;
    const objective = commentObjective();
    if (!objective || !commentDialog) return;
    const currentUpdate = currentSchoolDayUpdate(objective.id);
    document.getElementById('assistantPiaCommentKicker').textContent = currentUpdate ? 'Perditeso komentin' : 'Jep koment';
    document.getElementById('assistantPiaCommentTitle').textContent = objective.title;
    document.getElementById('assistantPiaCommentDetails').textContent = objective.details || 'Pa pershkrim shtese.';
    document.getElementById('assistantPiaCommentRating').innerHTML = [5, 4, 3, 2, 1]
      .map(value => `<option value="${value}"${Number(currentUpdate?.rating || 3) === value ? ' selected' : ''}>${value} - ${escapeHtml(ratingLabel(value))}</option>`)
      .join('');
    document.getElementById('assistantPiaCommentText').value = currentUpdate?.comment || '';
    document.getElementById('assistantPiaCommentStatus').textContent = '';
    commentDialog.showModal();
  }

  function objectivesForStudent(studentId) {
    return piaObjectives
      .filter(item => item.student_id === studentId)
      .sort((left, right) => {
        if (left.active !== right.active) return Number(right.active) - Number(left.active);
        return new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at);
      });
  }

  function piaStudent() {
    return students.find(student => student.id === piaStudentId) || selectedStudent || students[0] || null;
  }

  function detailHeading(titleText, description) {
    return `<div class="teacher-detail-heading"><h2>${escapeHtml(titleText)}</h2><p>${escapeHtml(description)}</p></div>`;
  }

  function renderStudents(query = '') {
    const box = document.getElementById('assistantStudentGroups');
    const filtered = studentsForQuery(query);
    const groups = filtered.reduce((result, student) => {
      const className = student.className || 'Pa klase';
      (result[className] ||= []).push(student);
      return result;
    }, {});

    document.getElementById('assistantStudentTotal').textContent = `${filtered.length} nxenes`;
    box.innerHTML = '';
    if (!filtered.length) {
      box.innerHTML = '<p class="teacher-empty-students">Nuk u gjet asnje nxenes i caktuar.</p>';
      return;
    }

    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right, 'sq')).forEach(([className, classStudents]) => {
      const group = document.createElement('section');
      group.className = 'teacher-class-group';
      group.innerHTML = `<button type="button" aria-expanded="true"><span class="teacher-class-chevron">^</span><strong>Klasa ${escapeHtml(className)}</strong><small>${classStudents.length} nxenes</small></button><div class="teacher-class-students"></div>`;
      const toggle = group.querySelector(':scope > button');
      toggle.addEventListener('click', () => {
        group.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!group.classList.contains('collapsed')));
      });

      const list = group.querySelector('.teacher-class-students');
      classStudents.forEach(student => {
        const row = document.createElement('article');
        row.className = 'teacher-student-row';
        row.innerHTML = `<span>${initials(student.name)}</span><div><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.supportSummary || 'Pa shenime shtese')}</small></div><p class="teacher-student-mood">${escapeHtml(student.mood || 'Pa gjendje te raportuar sot')}</p><button type="button">Hap</button>`;
        row.querySelector('button').addEventListener('click', () => openFolder(student));
        list.appendChild(row);
      });

      box.appendChild(group);
    });
  }

  function openFolder(student) {
    selectedStudent = student;
    piaStudentId = student.id;
    messageStudentId = student.id;
    document.getElementById('assistantFolderAvatar').textContent = initials(student.name);
    document.getElementById('assistantFolderName').textContent = student.name;
    document.getElementById('assistantFolderMeta').textContent = `Klasa ${student.className || 'Pa klase'}`;
    showPanel('student-folder', false);
  }

  function renderHistoryDetail() {
    if (!selectedStudent) return;
    const history = moodHistories[selectedStudent.id] || [];
    const current = selectedStudent.mood
      ? `<article class="teacher-current-mood"><small>Sot</small><strong>${escapeHtml(selectedStudent.mood)}</strong><p>${escapeHtml(selectedStudent.moodComment || 'Pa koment shtese.')}</p></article>`
      : '<div class="teacher-detail-empty"><strong>Pa gjendje te raportuar sot</strong><p>Familja nuk ka derguar ende nje perditesim per sot.</p></div>';
    const previous = history.length
      ? `<div class="teacher-history-list">${history.map(item => `<article><time>${escapeHtml(formatDate(`${item.reported_on}T12:00:00`))}</time><strong>${escapeHtml(item.mood)}</strong><p>${escapeHtml(item.parent_comment || 'Pa koment shtese.')}</p></article>`).join('')}</div>`
      : '<div class="teacher-detail-empty"><strong>Historiku eshte bosh</strong><p>Nuk ka ende hyrje te meparshme.</p></div>';
    document.getElementById('assistantFolderDetail').innerHTML = `${detailHeading('Humori dhe historiku', `Vezhgimet ditore per ${selectedStudent.name}.`)}<div class="teacher-mood-summary">${current}${previous}</div>`;
    showPanel('folder-detail', false);
  }

  function renderSupportDetail() {
    if (!selectedStudent) return;
    const cards = [
      selectedStudent.supportSummary ? `<article><span>Permbledhja</span><p>${escapeHtml(selectedStudent.supportSummary)}</p></article>` : '',
      selectedStudent.communicationMethod ? `<article><span>Komunikimi</span><p>${escapeHtml(selectedStudent.communicationMethod)}</p></article>` : '',
      selectedStudent.learningPreferences?.length ? `<article><span>Preferencat</span><p>${escapeHtml(selectedStudent.learningPreferences.join(', '))}</p></article>` : '',
      selectedStudent.additionalNotes ? `<article><span>Shenime shtese</span><p>${escapeHtml(selectedStudent.additionalNotes)}</p></article>` : ''
    ].filter(Boolean);
    document.getElementById('assistantFolderDetail').innerHTML = `${detailHeading('Mbeshtetja dhe komunikimi', 'Informacion praktik qe ndihmon punen e perditshme me nxenesin.')}<div class="teacher-preference-grid">${cards.join('') || '<div class="teacher-detail-empty"><strong>Pa te dhena shtese</strong><p>Nuk jane ruajtur ende preference ose shenime mbeshtetese.</p></div>'}</div>`;
    showPanel('folder-detail', false);
  }

  function objectiveRow(objective) {
    const updates = objectiveUpdates(objective.id);
    const latest = updates[0];
    const todayUpdate = currentSchoolDayUpdate(objective.id);
    const achievementMenu = achievementObjectiveId === objective.id ? `
      <div class="assistant-pia-achievement-menu">
        <button type="button" data-assistant-achievement="${objective.id}|false">Kompletuar</button>
        <button type="button" data-assistant-achievement="${objective.id}|true">Pa kompletuar</button>
      </div>
    ` : '';

    return `
      <article class="assistant-pia-row${updateObjectiveId === objective.id ? ' active' : ''}">
        <div class="assistant-pia-row-main">
          <div class="assistant-pia-row-copy">
            <div class="assistant-pia-row-title">
              <strong>${escapeHtml(objective.title)}</strong>
              <span class="assistant-pia-badge${objective.active ? '' : ' muted'}">${objective.active ? 'Aktiv' : 'Kompletuar'}</span>
            </div>
            <p>${escapeHtml(objective.details || 'Pa pershkrim shtese.')}</p>
          </div>
          <div class="assistant-pia-row-meta">
            <span>${latest ? escapeHtml(ratingLabel(latest.rating)) : 'Pa status ende'}</span>
            <small>${latest ? escapeHtml(formatDate(latest.updated_at || latest.created_at)) : 'Pa koment ditor'}</small>
          </div>
        </div>
        <div class="assistant-pia-row-footer">
          <div class="assistant-pia-row-note">${latest ? escapeHtml(latest.comment) : 'Nuk ka ende koment te ruajtur per kete objektiv.'}</div>
          <div class="assistant-pia-row-actions">
            <button class="assistant-pia-primary-action" type="button" data-assistant-comment="${objective.id}">${todayUpdate ? 'Perditeso' : 'Jep koment'}</button>
            <button type="button" data-assistant-achievement-toggle="${objective.id}">Cakto arritjen</button>
          </div>
        </div>
        ${achievementMenu}
      </article>
    `;
  }

  function renderPiaPanel() {
    const target = document.getElementById('assistantPiaContent');
    const student = piaStudent();

    if (!student) {
      target.innerHTML = '<div class="teacher-detail-empty"><strong>Pa nxenes te caktuar</strong><p>Sapo te caktohet nje nxenes, ketu do te shfaqet paneli PIA.</p></div>';
      return;
    }

    piaStudentId = student.id;
    const objectives = objectivesForStudent(student.id);
    if (!updateObjectiveId || !objectives.some(item => item.id === updateObjectiveId)) {
      updateObjectiveId = objectives[0]?.id || null;
    }

    const activeObjectives = objectives.filter(item => item.active).length;

    target.innerHTML = `
      <section class="assistant-pia-shell">
        <div class="assistant-pia-header">
          <div>
            <span class="assistant-pia-kicker">Plan i vecante i asistences</span>
            <h2>${escapeHtml(student.name)}</h2>
          </div>
          <label class="assistant-pia-student-switcher">Nxenesi
            <select id="assistantPiaStudentSelect">
              ${students.map(item => `<option value="${item.id}"${item.id === student.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="assistant-pia-summary">
          <article><span>Klasa</span><strong>${escapeHtml(student.className || 'Pa klase')}</strong></article>
          <article><span>Objektiva aktive</span><strong>${activeObjectives}</strong></article>
        </div>

        <section class="assistant-pia-stage">
          <div class="assistant-pia-stage-head">
            <div>
              <span class="assistant-pia-kicker">Objektiv i ri</span>
              <h3>Planifikimi i objektivave</h3>
            </div>
            ${isWeekend() ? '<small class="assistant-pia-schoolday-note">Fundjavat ruhen si dita e fundit shkollore.</small>' : ''}
          </div>

          <form class="assistant-pia-form" id="assistantPiaObjectiveForm">
            <label>Objektivi
              <input id="assistantPiaObjectiveTitle" type="text" maxlength="160" required placeholder="P.sh. Te ndjeke udhezimin me dy hapa">
            </label>
            <label>Pershkrimi ose kriteret
              <textarea id="assistantPiaObjectiveDetails" rows="4" maxlength="2000" placeholder="Shkruani shkurt si do te ndiqet progresi dhe cfare pritet."></textarea>
            </label>
            <p class="teacher-save-status${piaError ? ' error' : ''}" id="assistantPiaStatus">${escapeHtml(piaError || piaStatus)}</p>
            <div class="teacher-form-actions">
              <button class="teacher-primary-button" type="submit">Ruaj objektivin</button>
            </div>
          </form>

          <div class="assistant-pia-list-block">
          <div class="assistant-pia-list-head">
              <h3>Objektivat</h3>
              <span>${objectives.length} gjithsej</span>
            </div>
            <div class="assistant-pia-list">
              ${objectives.length ? objectives.map(objectiveRow).join('') : '<div class="teacher-detail-empty"><strong>Pa objektiva ende</strong><p>Shtoni objektivin e pare PIA per kete nxenes.</p></div>'}
            </div>
          </div>
        </section>
      </section>
    `;

    document.getElementById('assistantPiaStudentSelect').addEventListener('change', event => {
      piaStudentId = event.currentTarget.value;
      selectedStudent = students.find(item => item.id === piaStudentId) || selectedStudent;
      updateObjectiveId = null;
      achievementObjectiveId = null;
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    });

    document.getElementById('assistantPiaObjectiveForm').addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      piaStatus = '';
      piaError = '';
      try {
        const saved = await saveAssistantPiaObjective({
          studentId: student.id,
          title: document.getElementById('assistantPiaObjectiveTitle').value,
          details: document.getElementById('assistantPiaObjectiveDetails').value,
          active: true
        });
        piaObjectives = [saved, ...piaObjectives.filter(item => item.id !== saved.id)];
        updateObjectiveId = saved.id;
        piaStatus = 'Objektivi u ruajt.';
      } catch (error) {
        piaError = error.message || 'Objektivi nuk u ruajt.';
      } finally {
        renderPiaPanel();
      }
    });

    target.querySelectorAll('[data-assistant-comment]').forEach(button => button.addEventListener('click', () => {
      achievementObjectiveId = null;
      piaStatus = '';
      piaError = '';
      openCommentDialog(button.dataset.assistantComment);
      renderPiaPanel();
    }));

    target.querySelectorAll('[data-assistant-achievement-toggle]').forEach(button => button.addEventListener('click', () => {
      achievementObjectiveId = achievementObjectiveId === button.dataset.assistantAchievementToggle ? null : button.dataset.assistantAchievementToggle;
      renderPiaPanel();
    }));

    target.querySelectorAll('[data-assistant-achievement]').forEach(button => button.addEventListener('click', async () => {
      const [objectiveId, nextActiveRaw] = button.dataset.assistantAchievement.split('|');
      const objective = piaObjectives.find(item => item.id === objectiveId);
      if (!objective) return;
      button.disabled = true;
      piaStatus = '';
      piaError = '';
      try {
        const saved = await saveAssistantPiaObjective({
          objectiveId: objective.id,
          studentId: objective.student_id,
          title: objective.title,
          details: objective.details,
          active: nextActiveRaw === 'true'
        });
        piaObjectives = [saved, ...piaObjectives.filter(item => item.id !== saved.id)];
        achievementObjectiveId = null;
        piaStatus = saved.active ? 'Objektivi u shenua si pa kompletuar.' : 'Objektivi u shenua si i kompletuar.';
      } catch (error) {
        piaError = error.message || 'Arritja nuk u ruajt.';
      } finally {
        renderPiaPanel();
      }
    }));

  }

  function availableRecipientsForStudent(studentId) {
    return Array.isArray(messageRecipients[studentId]) ? messageRecipients[studentId] : [];
  }

  function renderMessageComposerOptions() {
    const studentSelect = document.getElementById('assistantMessageStudent');
    const recipientSelect = document.getElementById('assistantMessageRecipient');
    const note = document.getElementById('assistantMessageRecipientNote');
    if (!studentSelect || !recipientSelect || !note) return;
    const previousRecipientValue = recipientSelect.value;

    if (!messageStudentId || !students.some(student => student.id === messageStudentId)) {
      messageStudentId = selectedStudent?.id || students[0]?.id || '';
    }

    studentSelect.innerHTML = students.map(student => `<option value="${student.id}"${student.id === messageStudentId ? ' selected' : ''}>${escapeHtml(student.name)}${student.className ? ` - ${escapeHtml(student.className)}` : ''}</option>`).join('');

    const recipients = availableRecipientsForStudent(messageStudentId);
    if (!recipients.length) {
      recipientSelect.innerHTML = '<option value="">Pa marres te disponueshem</option>';
      recipientSelect.disabled = true;
      note.textContent = 'Ky nxenes nuk ka ende prind ose mesimdhenes te gatshem per komunikim.';
      return;
    }

    recipientSelect.disabled = false;
    recipientSelect.innerHTML = recipients.map(option => {
      const roleLabel = recipientRoleLabel(option.recipient_role);
      const subjectSuffix = option.subject_name ? ` - ${option.subject_name}` : '';
      return `<option value="${escapeHtml(recipientValue(option))}">${escapeHtml(`${roleLabel}: ${option.recipient_name}${subjectSuffix}`)}</option>`;
    }).join('');

    const selected = recipients.find(option => recipientValue(option) === previousRecipientValue) || recipients[0];
    recipientSelect.value = recipientValue(selected);
    note.textContent = selected.recipient_role === 'teacher'
      ? `Mesazhi do te lidhet me lenden ${selected.subject_name}.`
      : 'Mesazhi do te shkoje drejt te prindi i nxenesit.';
  }

  function updateMessageCounts() {
    const unreadCount = messages.filter(message => message.unread).length;
    root.querySelectorAll('[data-assistant-message-count]').forEach(badge => {
      badge.textContent = String(unreadCount);
      badge.hidden = unreadCount === 0;
    });
  }

  function renderMessages() {
    const list = document.getElementById('assistantMessageList');
    if (!list) return;

    updateMessageCounts();
    const visible = messages.filter(message => !unreadOnly || message.unread);
    list.innerHTML = '';
    if (!visible.length) {
      list.innerHTML = `<p class="teacher-message-empty">${unreadOnly ? 'Nuk ka mesazhe te palexuara.' : 'Nuk ka ende biseda ose njoftime.'}</p>`;
      return;
    }

    visible.forEach(message => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `teacher-message-preview${message.unread ? '' : ' read'}`;
      button.classList.toggle('active', message.id === activeMessageId);
      button.innerHTML = `<span class="unread-dot"></span><div><strong>${escapeHtml(message.counterpart || 'Kontakti')}</strong><p>${escapeHtml(message.subject)}</p><p>${escapeHtml(message.student)}${message.context ? ` - ${escapeHtml(message.context)}` : ''}</p></div><time>${escapeHtml(formatDate(message.time))}</time>`;
      button.addEventListener('click', () => openMessage(message));
      list.appendChild(button);
    });
  }

  function openMessage(message) {
    activeMessageId = message.id;
    renderMessages();
    const detail = document.getElementById('assistantMessageDetail');
    if (!detail) return;

    const conversation = message.type === 'thread'
      ? message.messages.map(item => `<p class="teacher-saved-reply${item.sender_id === assistantId ? ' teacher-own-message' : ''}"><strong>${escapeHtml(messageSenderLabel(message.thread, item.sender_id, assistantId))}</strong>${escapeHtml(item.body)}<time>${escapeHtml(formatSqDate(item.created_at, { includeTime: true }))}</time></p>`).join('')
      : `<p>${escapeHtml(notificationBody(message))}</p>`;

    detail.innerHTML = `
      <button class="teacher-back-button teacher-message-mobile-back" type="button">← Kthehu</button>
      <div class="teacher-message-heading">
        <div class="teacher-message-heading-row">
          <div>
            <h2>${escapeHtml(message.subject)}</h2>
            <p>${escapeHtml(message.counterpart || 'Kontakti')} - ${escapeHtml(message.counterpartRole || 'Mesazh')}${message.student ? ` - ${escapeHtml(message.student)}` : ''}${message.context ? ` - ${escapeHtml(message.context)}` : ''}</p>
          </div>
          <div class="teacher-message-actions">
            <button type="button" data-message-action="toggle-read" data-action="${message.unread ? 'read' : 'unread'}">${message.unread ? 'Sheno si te lexuar' : 'Sheno si te palexuar'}</button>
            <button class="danger" type="button" data-message-action="delete">Fshi</button>
          </div>
        </div>
        <p class="teacher-message-action-status" aria-live="polite"></p>
      </div>
      <div class="teacher-message-body">${conversation}</div>
      ${message.type === 'thread' ? '<form class="teacher-reply-box"><label class="sr-only" for="assistantReplyText">Pergjigjja</label><textarea id="assistantReplyText" maxlength="2000" placeholder="Shkruani pergjigjen..."></textarea><p class="teacher-message-action-status" aria-live="polite"></p><div><button class="teacher-primary-button" type="submit">Dergo pergjigjen</button></div></form>' : ''}
    `;

    detail.classList.add('mobile-open');
    detail.querySelector('.teacher-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('[data-message-action="toggle-read"]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const action = button.dataset.action;
      const status = detail.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = action === 'unread' ? 'Duke e shenuar si te palexuar...' : 'Duke e shenuar si te lexuar...';
      try {
        if (action === 'unread') {
          if (message.type === 'thread') await markAssistantThreadUnread(message.id);
          else await markAssistantNotificationUnread(message.id);
          message.unread = true;
        } else {
          if (message.type === 'thread') await markAssistantThreadRead(message.id);
          else await markAssistantNotificationRead(message.id);
          message.unread = false;
        }
        renderMessages();
        openMessage(message);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Mesazhi nuk u perditesua.';
      }
    });

    detail.querySelector('[data-message-action="delete"]')?.addEventListener('click', async event => {
      if (!window.confirm('Jeni te sigurt qe deshironi ta hiqni kete bisede ose njoftim nga kutia juaj?')) return;
      const button = event.currentTarget;
      const status = detail.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = 'Duke e fshire...';
      try {
        if (message.type === 'thread') await archiveAssistantThread(message.id);
        else await deleteAssistantNotification(message.id);
        messages = messages.filter(item => item.id !== message.id);
        activeMessageId = null;
        detail.classList.remove('mobile-open');
        detail.innerHTML = '<div class="teacher-empty-message"><span>◇</span><strong>Zgjidhni nje mesazh</strong><p>Biseda dhe pergjigjet do te shfaqen ketu.</p></div>';
        renderMessages();
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Veprimi nuk u krye.';
      }
    });

    detail.querySelector('form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const textarea = detail.querySelector('textarea');
      if (!textarea.value.trim()) return;
      const button = event.currentTarget.querySelector('[type="submit"]');
      const status = event.currentTarget.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = 'Duke derguar pergjigjen...';
      try {
        const reply = await sendAssistantThreadMessage(message.id, textarea.value);
        message.messages.push(reply);
        message.body = reply.body;
        message.time = reply.created_at;
        message.unread = false;
        openMessage(message);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Pergjigjja nuk u dergua.';
      }
    });
  }

  async function submitNewMessage(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('assistantMessageComposerStatus');
    const student = students.find(item => item.id === document.getElementById('assistantMessageStudent').value);
    const selectedValue = document.getElementById('assistantMessageRecipient').value;
    const { role, recipientId, subjectId } = parseRecipientValue(selectedValue);
    const option = availableRecipientsForStudent(student?.id).find(item => recipientValue(item) === selectedValue);
    if (!student || !recipientId || !role || !option) {
      status.textContent = 'Zgjidhni nje nxenes dhe nje marres te vlefshem.';
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    status.textContent = 'Duke derguar mesazhin...';
    const titleValue = document.getElementById('assistantMessageTitle').value;
    const bodyValue = document.getElementById('assistantMessageBody').value;

    try {
      const saved = await startAssistantThread({
        studentId: student.id,
        recipientId,
        recipientRole: role,
        subjectId,
        title: titleValue,
        body: bodyValue
      });
      const createdAt = new Date().toISOString();
      const newMessage = {
        id: saved.id,
        type: 'thread',
        unread: false,
        counterpart: option.recipient_name,
        counterpartRole: recipientRoleLabel(option.recipient_role),
        student: student.name,
        subject: saved.title,
        context: option.subject_name || 'Familja',
        time: createdAt,
        body: bodyValue,
        messages: [{ id: `local-${saved.id}`, thread_id: saved.id, sender_id: assistantId, body: bodyValue, created_at: createdAt }],
        thread: {
          ...saved,
          parent_id: role === 'parent' ? recipientId : null,
          teacher_id: role === 'teacher' ? recipientId : null,
          assistant_teacher_id: assistantId
        }
      };
      messages = [newMessage, ...messages.filter(item => item.id !== newMessage.id)];
      activeMessageId = newMessage.id;
      form.reset();
      document.getElementById('assistantMessageComposer').classList.add('hidden');
      renderMessageComposerOptions();
      renderMessages();
      openMessage(newMessage);
    } catch (error) {
      status.textContent = error.message || 'Mesazhi nuk u dergua.';
    } finally {
      submitButton.disabled = false;
    }
  }

  function bindStaticEvents() {
    navButtons.forEach(button => button.addEventListener('click', () => showPanel(button.dataset.assistantView)));
    root.querySelector('[data-open-assistant-messages]')?.addEventListener('click', () => showPanel('messages'));

    document.getElementById('assistantStudentSearch').addEventListener('input', event => renderStudents(event.target.value));
    document.getElementById('assistantFolderBack').addEventListener('click', () => showPanel('students'));
    document.getElementById('assistantDetailBack').addEventListener('click', () => {
      if (selectedStudent) openFolder(selectedStudent);
      else showPanel('students');
    });
    root.querySelectorAll('[data-assistant-detail]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.assistantDetail === 'history') renderHistoryDetail();
        if (button.dataset.assistantDetail === 'support') renderSupportDetail();
        if (button.dataset.assistantDetail === 'pia') {
          renderPiaPanel();
          showPanel('pia');
        }
      });
    });

    document.getElementById('assistantUnreadFilter')?.addEventListener('click', event => {
      unreadOnly = !unreadOnly;
      event.currentTarget.classList.toggle('active', unreadOnly);
      event.currentTarget.textContent = unreadOnly ? 'Shfaq te gjitha' : 'Vetem te palexuarat';
      renderMessages();
    });

    document.getElementById('assistantNewMessage')?.addEventListener('click', () => {
      const composer = document.getElementById('assistantMessageComposer');
      composer.classList.remove('hidden');
      renderMessageComposerOptions();
    });
    document.getElementById('assistantCancelMessage')?.addEventListener('click', () => {
      document.getElementById('assistantMessageComposer').classList.add('hidden');
      document.getElementById('assistantMessageComposerStatus').textContent = '';
    });
    document.getElementById('assistantMessageStudent')?.addEventListener('change', event => {
      messageStudentId = event.currentTarget.value;
      renderMessageComposerOptions();
    });
    document.getElementById('assistantMessageRecipient')?.addEventListener('change', () => {
      renderMessageComposerOptions();
    });
    document.getElementById('assistantMessageComposer')?.addEventListener('submit', submitNewMessage);

    document.getElementById('assistantSaveSettings')?.addEventListener('click', async event => {
      const email = document.getElementById('assistantNotificationEmail').value.trim();
      const parentMessageEmails = document.getElementById('assistantParentMessageEmails').checked;
      const status = document.getElementById('assistantSettingsStatus');
      if (parentMessageEmails && !email) {
        status.textContent = 'Shtoni email-in ku deshironi te merrni njoftimet.';
        return;
      }
      event.currentTarget.disabled = true;
      status.textContent = 'Duke ruajtur cilesimet...';
      try {
        notificationPreferences = await saveAssistantNotificationPreferences({
          profileId: assistantId,
          email,
          parentMessageEmails,
          dailyDigestEmails: false
        });
        status.textContent = 'Cilesimet e email-it u ruajten.';
      } catch (error) {
        status.textContent = error.message || 'Cilesimet nuk u ruajten.';
      } finally {
        event.currentTarget.disabled = false;
      }
    });

    document.getElementById('assistantPiaCommentClose')?.addEventListener('click', closeCommentDialog);
    document.getElementById('assistantPiaCommentCancel')?.addEventListener('click', closeCommentDialog);
    commentDialog?.addEventListener('click', event => {
      if (event.target === commentDialog) closeCommentDialog();
    });
    document.getElementById('assistantPiaCommentForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!updateObjectiveId) return;
      const submitButton = document.getElementById('assistantPiaCommentSubmit');
      const status = document.getElementById('assistantPiaCommentStatus');
      submitButton.disabled = true;
      status.textContent = '';
      try {
        const saved = await recordAssistantPiaUpdate({
          objectiveId: updateObjectiveId,
          rating: document.getElementById('assistantPiaCommentRating').value,
          comment: document.getElementById('assistantPiaCommentText').value
        });
        piaUpdates = [saved, ...piaUpdates.filter(item => item.id !== saved.id)];
        piaObjectives = piaObjectives.map(item => item.id === saved.objective_id ? { ...item, updated_at: saved.updated_at || saved.created_at } : item);
        piaStatus = 'Komenti u ruajt dhe u dergua si njoftim te prindi dhe mesimdhenesit.';
        piaError = '';
        closeCommentDialog();
        renderPiaPanel();
      } catch (error) {
        status.textContent = error.message || 'Komenti nuk u dergua.';
      } finally {
        submitButton.disabled = false;
      }
    });

    root.querySelectorAll('[data-assistant-logout]').forEach(button => button.addEventListener('click', () => {
      logoutDialog.returnValue = 'cancel';
      logoutDialog.showModal();
    }));
    logoutDialog.addEventListener('click', event => {
      if (event.target === logoutDialog) logoutDialog.close('cancel');
    });
    logoutDialog.addEventListener('close', () => {
      if (logoutDialog.returnValue === 'confirm') onLogout?.();
    });
  }

  bindStaticEvents();

  return {
    setData({
      assistantTeacherName,
      assistantTeacherEmail = '',
      assistantTeacherId = null,
      students: nextStudents = [],
      moods = {},
      moodHistories: nextMoodHistories = {},
      piaObjectives: nextObjectives = [],
      piaUpdates: nextUpdates = [],
      messages: nextMessages = [],
      preferences = null,
      messageRecipients: nextRecipients = {}
    } = {}) {
      assistantName = assistantTeacherName || assistantName;
      assistantEmail = assistantTeacherEmail || assistantEmail;
      assistantId = assistantTeacherId || assistantId;
      root.querySelectorAll('[data-assistant-name]').forEach(element => {
        element.textContent = assistantName;
      });
      const avatar = initials(assistantName);
      root.querySelectorAll('.teacher-account-avatar,.teacher-header-avatar').forEach(element => {
        element.textContent = avatar;
      });

      const currentPanel = activePanelName();
      const previousSelectedStudentId = selectedStudent?.id || piaStudentId || messageStudentId || null;
      students = Array.isArray(nextStudents) ? nextStudents.map(student => ({
        ...student,
        mood: moods[student.name]?.mood || '',
        moodComment: moods[student.name]?.comment || ''
      })) : [];
      moodHistories = nextMoodHistories;
      piaObjectives = Array.isArray(nextObjectives) ? nextObjectives.map(item => ({ ...item })) : [];
      piaUpdates = Array.isArray(nextUpdates) ? nextUpdates.map(item => ({ ...item })) : [];
      messages = Array.isArray(nextMessages) ? nextMessages.map(message => ({ ...message, messages: Array.isArray(message.messages) ? [...message.messages] : [] })) : [];
      messageRecipients = nextRecipients && typeof nextRecipients === 'object' ? nextRecipients : {};
      notificationPreferences = preferences;

      selectedStudent = students.find(student => student.id === previousSelectedStudentId) || students[0] || null;
      piaStudentId = students.some(student => student.id === piaStudentId) ? piaStudentId : (selectedStudent?.id || '');
      messageStudentId = students.some(student => student.id === messageStudentId) ? messageStudentId : (selectedStudent?.id || '');
      updateObjectiveId = piaObjectives.some(item => item.id === updateObjectiveId) ? updateObjectiveId : (objectivesForStudent(piaStudentId)[0]?.id || null);
      achievementObjectiveId = piaObjectives.some(item => item.id === achievementObjectiveId) ? achievementObjectiveId : null;

      document.getElementById('assistantNotificationEmail').value = preferences?.notification_email || assistantEmail;
      document.getElementById('assistantParentMessageEmails').checked = preferences?.parent_message_emails || false;
      document.getElementById('assistantDailyDigestEmails').checked = false;

      document.getElementById('assistantStudentSearch').value = '';
      renderStudents();
      renderPiaPanel();
      renderMessageComposerOptions();
      renderMessages();

      const activeMessage = messages.find(message => message.id === activeMessageId);
      if (currentPanel === 'messages' && activeMessage) {
        openMessage(activeMessage);
      } else {
        activeMessageId = null;
        const detail = document.getElementById('assistantMessageDetail');
        if (detail) {
          detail.classList.remove('mobile-open');
          detail.innerHTML = '<div class="teacher-empty-message"><span>◇</span><strong>Zgjidhni nje mesazh</strong><p>Biseda dhe pergjigjet do te shfaqen ketu.</p></div>';
        }
      }

      panels.forEach(panel => panel.classList.toggle('active', panel.dataset.assistantPanel === currentPanel));
      navButtons.forEach(button => button.classList.toggle('active', button.dataset.assistantView === currentPanel));
      if (titles[currentPanel]) {
        kicker.textContent = titles[currentPanel][0];
        title.textContent = titles[currentPanel][1];
      }
    }
  };
}
