let token = '', plan = null;
const $ = id => document.getElementById(id);
const names = ['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'LLM_MODE', 'LLM_ENDPOINT', 'LLM_MODEL', 'LLM_TOKEN', 'OLLAMA_MODEL'];
for (const name of names) {
  const label = document.createElement('label');label.textContent = name.replaceAll('_', ' ');
  const input = name === 'LLM_MODE' ? document.createElement('select') : document.createElement('input');
  if (name === 'LLM_MODE') for (const value of ['local', 'token']) { const option = document.createElement('option');option.value = value;option.textContent = value === 'local' ? 'Local Ollama' : 'HTTPS token provider';input.append(option); }
  input.name = name;input.id = name;input.autocomplete = 'off';if (/SECRET|TOKEN|PRIVATE_KEY/.test(name)) input.type = 'password';
  label.append(input);$('fields').append(label);
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();if (!response.ok) throw Error(data.error);return data;
}
function fail(e) { $('error').textContent = e.message; }
async function refresh(fill = false) { const state = await api('state');if (fill) for (const name of names) { const input = $(name);if (input.type === 'password') input.placeholder = state.settings[name] ? 'Configured; leave blank to retain' : 'Not configured';else input.value = state.settings[name] || (name === 'LLM_MODE' ? 'local' : ''); } if (state.job) $('output').textContent = `${state.job.action}: ${state.job.status}\n${state.job.output || 'Running…'}`;return state; }
$('login').onsubmit = async e => { e.preventDefault();token = $('token').value;$('token').value = '';try { await refresh(true);$('unlock').hidden = true;$('wizard').hidden = false; } catch (e) { token = '';fail(e); } };
$('settings').onsubmit = async e => { e.preventDefault();try { const values = Object.fromEntries(names.map(n => [n, $(n).value]));const result = await api('settings', values);for (const n of names) if ($(n).type === 'password') $(n).value = '';$('output').textContent = result.message;await refresh(true); } catch (e) { fail(e); } };
for (const b of document.querySelectorAll('[data-step]')) b.onclick = () => document.querySelectorAll('.step').forEach((s, i) => s.hidden = i !== Number(b.dataset.step));
for (const b of document.querySelectorAll('[data-action]')) b.onclick = async () => { try { $('error').textContent = '';const action = b.dataset.action;const target = $('remote').checked && !['test', 'build', 'validate'].includes(action) ? { host: $('host').value, user: $('user').value, port: Number($('port').value), directory: $('directory').value } : null;plan = await api('plan', { action, target });$('summary').textContent = plan.summary;$('review').hidden = false;$('review').scrollIntoView({ behavior: 'smooth' }); } catch (e) { fail(e); } };
$('dismiss').onclick = () => { plan = null;$('review').hidden = true; };
$('execute').onclick = async () => { if (!plan) return;const id = plan.id;plan = null;$('review').hidden = true;try { await api('execute', { id });await refresh(); } catch (e) { fail(e); } };
setInterval(() => { if (token) refresh().catch(fail); }, 3000);
