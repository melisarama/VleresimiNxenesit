import { supabaseClient } from '../lib/supabaseClient.js';

function authLinkType() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return url.searchParams.get('type') || hash.get('type') || (url.searchParams.has('code') ? 'invite' : '');
}

function showSetupScreen() {
  document.getElementById('roleGate').classList.add('hidden');
  document.getElementById('accountSetup').classList.remove('hidden');
}

async function leaveSetupScreen() {
  await supabaseClient.auth.signOut();
  window.history.replaceState({}, document.title, window.location.pathname);
  document.getElementById('accountSetup').classList.add('hidden');
  document.getElementById('roleGate').classList.remove('hidden');
}

export function initializeAccountSetup() {
  const setupType = authLinkType();
  const requested = setupType === 'invite' || setupType === 'recovery';
  if (requested) showSetupScreen();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || (requested && session)) showSetupScreen();
  });

  document.getElementById('completeAccountSetup').onclick = async () => {
    const password = document.getElementById('newAccountPassword').value;
    const confirmation = document.getElementById('confirmAccountPassword').value;
    const status = document.getElementById('accountSetupStatus');
    if (password.length < 8) { status.textContent = 'Fjalëkalimi duhet të ketë së paku 8 karaktere.'; return; }
    if (password !== confirmation) { status.textContent = 'Fjalëkalimet nuk përputhen.'; return; }
    status.textContent = 'Duke ruajtur fjalëkalimin…';
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) { status.textContent = `Fjalëkalimi nuk u ruajt: ${error.message}`; return; }
    status.textContent = 'Fjalëkalimi u ruajt. Tani mund të kyçeni.';
    window.setTimeout(leaveSetupScreen, 900);
  };

  document.getElementById('cancelAccountSetup').onclick = leaveSetupScreen;
}
