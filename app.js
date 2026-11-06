'use strict';

/* ============================================================
 * FarmaTarefas — to-do list para trabalhadores de farmácia
 * Dados ficam no localStorage do navegador; backup via JSON.
 *
 * Todo o app está neste arquivo: estado e persistência, regras das
 * tarefas e modelos, as quatro telas (Dia, Semana, Modelos, Perfil)
 * desenhadas como texto HTML dentro de <main id="app">, os diálogos
 * que já existem no index.html, importar/exportar e o registro do
 * service worker (sw.js). Os estilos estão em styles.css.
 * ============================================================ */

/** Chave única do localStorage onde fica todo o estado (perfil, tarefas, modelos, tema). */
const STORAGE_KEY = 'farmatarefas:v1';
/** Marca e versão gravadas no JSON de backup; a importação recusa arquivos sem essa marca. */
const EXPORT_FORMAT = 'farmatarefas-backup';
const EXPORT_VERSION = 1;

/** Categorias das tarefas. O id também nomeia a cor no CSS (--c-<id>); a última ("outros") é a reserva. */
const CATEGORIES = [
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'controlados', label: 'Controlados' },
  { id: 'limpeza', label: 'Limpeza' },
  { id: 'caixa', label: 'Caixa' },
  { id: 'administrativo', label: 'Administrativo' },
  { id: 'outros', label: 'Outros' },
];

// Momento do turno no lugar de horário fixo: vale para qualquer turno (manhã, tarde, noite)
const MOMENTS = [
  { id: 'inicio', label: 'Início do turno', short: 'Início' },
  { id: '', label: 'Durante o turno', short: '' },
  { id: 'fim', label: 'Fim do turno', short: 'Fim' },
];
/** Ordem dos momentos na lista do dia (início, durante, fim). */
const MOMENT_ORDER = { inicio: 0, '': 1, fim: 2 };
/** Dados de um momento pelo id; id desconhecido vira "Durante o turno". */
const momentInfo = (id) => MOMENTS.find((m) => m.id === id) || MOMENTS[1];

/** Os 16 modelos pré-cadastrados. São só opções: nenhum entra na rotina sem a pessoa marcar. */
const DEFAULT_TEMPLATES = [
  { title: 'Registrar temperatura e umidade (abertura)', category: 'estoque', moment: 'inicio', priority: 'alta', notes: 'Geladeira de termolábeis (2 °C a 8 °C) e ambiente.' },
  { title: 'Abrir caixa e conferir troco', category: 'caixa', moment: 'inicio', priority: 'normal' },
  { title: 'Conferir receitas retidas e escriturar no SNGPC', category: 'controlados', priority: 'alta' },
  { title: 'Repor gôndolas e expositores', category: 'estoque', priority: 'normal' },
  { title: 'Limpeza e organização do balcão', category: 'limpeza', priority: 'normal' },
  { title: 'Registrar temperatura e umidade (fechamento)', category: 'estoque', moment: 'fim', priority: 'alta' },
  { title: 'Fechamento e conferência do caixa', category: 'caixa', moment: 'fim', priority: 'normal' },
  { title: 'Verificar produtos próximos ao vencimento', category: 'estoque', priority: 'normal', notes: 'Separar itens que vencem nos próximos 90 dias.' },
  { title: 'Receber e conferir mercadoria (nota x pedido)', category: 'estoque', priority: 'normal' },
  { title: 'Inventário de medicamentos controlados', category: 'controlados', priority: 'alta' },
  { title: 'Fazer pedido ao distribuidor', category: 'administrativo', priority: 'normal' },
  { title: 'Separar encomendas de clientes', category: 'atendimento', priority: 'normal' },
  { title: 'Retornar ligações / WhatsApp de clientes', category: 'atendimento', priority: 'baixa' },
  { title: 'Aferição de pressão / glicemia — registrar', category: 'atendimento', priority: 'normal' },
  { title: 'Limpeza da geladeira de termolábeis', category: 'limpeza', priority: 'normal' },
  { title: 'Descarte de vencidos / avariados (PGRSS)', category: 'administrativo', priority: 'normal' },
];

// Dados de versões antigas tinham hora fixa nos modelos padrão; o título diz qual momento ela representava
const DEFAULT_MOMENT_BY_TITLE = new Map(DEFAULT_TEMPLATES.map((t) => [t.title.toLowerCase(), t.moment || '']));

/* ---------------- Utilidades ---------------- */

/** Atalho para querySelector. */
const $ = (sel, root = document) => root.querySelector(sel);
/** Atalho para querySelectorAll, já como array. */
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** Id único (randomUUID quando o navegador tem; senão, data + aleatório). */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
/** Escapa texto para HTML. Todo texto digitado pela pessoa passa por aqui antes de ir para o innerHTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Número com dois dígitos ("7" → "07"). */
const pad = (n) => String(n).padStart(2, '0');
/** Date → "AAAA-MM-DD" no fuso local (as datas das tarefas são sempre strings nesse formato). */
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "AAAA-MM-DD" → Date à meia-noite local (evita o deslocamento de fuso do new Date("AAAA-MM-DD")). */
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
/** Data de hoje em "AAAA-MM-DD". */
const todayISO = () => toISO(new Date());
/** Soma (ou subtrai) dias a uma data ISO. */
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
/** Confere se é um horário "HH:MM" válido (00:00 a 23:59). */
const isValidTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
/** Turno do perfil como "08:00–18:00", ou vazio se não preenchido. */
const shiftLabel = (p) => (p.shiftStart && p.shiftEnd ? `${p.shiftStart}–${p.shiftEnd}` : '');
/** Confere se é uma data "AAAA-MM-DD" válida. */
const isValidISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromISO(s).getTime());
// Semana começa na segunda-feira
/** Segunda-feira da semana de uma data. */
const weekStart = (iso) => { const d = fromISO(iso); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toISO(d); };
/** Os sete dias (segunda a domingo) da semana de uma data. */
const weekDays = (iso) => { const s = weekStart(iso); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };

/** Primeira letra maiúscula. */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Data por extenso: "Segunda-feira, 6 de novembro". */
const fmtLong = (iso) => cap(fromISO(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
/** Data curta: "06/11". */
const fmtShort = (iso) => fromISO(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
/** Dia da semana abreviado, sem o ponto: "seg". */
const fmtWeekday = (iso) => fromISO(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
/** Data relativa a hoje: "Hoje", "Amanhã", "Ontem", "Daqui a 3 dias", "Há 2 dias". */
const relativeLabel = (iso) => {
  const diff = Math.round((fromISO(iso) - fromISO(todayISO())) / 864e5);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return diff > 0 ? `Daqui a ${diff} dias` : `Há ${-diff} dias`;
};
/** Nome de uma categoria pelo id ("Outros" se não existir). */
const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1)).label;
/** Cor CSS de uma categoria, como var(--c-<id>). */
const catVar = (id) => `var(--c-${CATEGORIES.some((c) => c.id === id) ? id : 'outros'})`;

/* ---------------- Estado ---------------- */

// state: tudo o que é salvo. ui: só a tela atual (aba, dia escolhido e o que está sendo editado), não é salvo.
let state = load();
const ui = { view: 'day', date: todayISO(), editingTaskId: null, editingTplId: null, movingTaskId: null };

/** Estado inicial de quem nunca usou: perfil vazio, sem tarefas, os 16 modelos padrão e o cadastro por abrir. */
function freshState() {
  return {
    profile: { name: '', role: '', store: '', shiftStart: '', shiftEnd: '' },
    tasks: [],
    templates: DEFAULT_TEMPLATES.map((t) => normalizeTemplate({ ...t, id: uid() })),
    settings: { theme: 'auto' },
    // Sem perfil criado ainda: a tela inicial é o cadastro
    onboarded: false,
    createdAt: new Date().toISOString(),
  };
}

/** Lê o estado do localStorage e o saneia; sem dados (ou com dados ilegíveis), devolve o estado inicial. */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeState(JSON.parse(raw));
  } catch (e) { console.warn('Falha ao ler dados salvos', e); }
  return freshState();
}

/** Grava o estado inteiro no localStorage; avisa se o navegador recusar (cheio ou bloqueado). */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Não foi possível salvar (armazenamento cheio ou bloqueado).'); }
}

/**
 * Tarefa em formato garantido: preenche o que falta, corta textos longos, valida categoria, prioridade e data.
 * Usada ao ler dados salvos, ao importar backup e ao salvar o formulário. Também converte dados antigos
 * (com hora fixa) para o momento do turno.
 */
function normalizeTask(t) {
  let moment = MOMENT_ORDER[t.moment] != null ? t.moment : '';
  let time = /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '';
  // Tarefa antiga com hora herdada de modelo padrão: vira momento do turno
  if (t.moment == null && time) {
    const m = DEFAULT_MOMENT_BY_TITLE.get(String(t.title || '').toLowerCase());
    if (m != null) { moment = m; time = ''; }
  }
  return {
    id: String(t.id || uid()),
    title: String(t.title || '').slice(0, 120) || 'Sem título',
    notes: String(t.notes || '').slice(0, 500),
    date: isValidISO(t.date) ? t.date : todayISO(),
    time,
    moment,
    category: CATEGORIES.some((c) => c.id === t.category) ? t.category : 'outros',
    priority: ['baixa', 'normal', 'alta'].includes(t.priority) ? t.priority : 'normal',
    done: !!t.done,
    doneAt: t.done ? (t.doneAt || new Date().toISOString()) : null,
    createdAt: t.createdAt || new Date().toISOString(),
  };
}

/** Modelo em formato garantido (mesmas regras da tarefa, sem data e com a marca de rotina diária). */
function normalizeTemplate(t) {
  let moment = MOMENT_ORDER[t.moment] != null ? t.moment : '';
  // Modelo antigo com hora fixa: os padrão viram o momento equivalente; os demais, "durante o turno"
  if (t.moment == null && t.time) moment = DEFAULT_MOMENT_BY_TITLE.get(String(t.title || '').toLowerCase()) ?? '';
  return {
    id: String(t.id || uid()),
    title: String(t.title || '').slice(0, 120) || 'Sem título',
    notes: String(t.notes || '').slice(0, 500),
    moment,
    category: CATEGORIES.some((c) => c.id === t.category) ? t.category : 'outros',
    priority: ['baixa', 'normal', 'alta'].includes(t.priority) ? t.priority : 'normal',
    routine: !!t.routine,
  };
}

/** Estado completo validado a partir de qualquer objeto (dados salvos ou backup); campos inválidos voltam ao padrão. */
function sanitizeState(s) {
  const base = freshState();
  const profile = { ...base.profile, ...pickStrings(s.profile, ['name', 'role', 'store', 'shiftStart', 'shiftEnd']) };
  for (const k of ['shiftStart', 'shiftEnd']) if (!isValidTime(profile[k])) profile[k] = '';
  const tasks = Array.isArray(s.tasks) ? s.tasks.map(normalizeTask) : [];
  return {
    profile,
    tasks,
    templates: Array.isArray(s.templates) ? s.templates.map(normalizeTemplate) : base.templates,
    settings: { theme: ['auto', 'light', 'dark'].includes(s.settings?.theme) ? s.settings.theme : 'auto' },
    // Dados da versão antiga (sem o campo) só contam como perfil criado se houver nome
    onboarded: typeof s.onboarded === 'boolean' ? s.onboarded : !!profile.name,
    createdAt: s.createdAt || base.createdAt,
  };
}

/** Copia de um objeto só as chaves pedidas, como texto de até 100 caracteres. */
function pickStrings(obj, keys) {
  const out = {};
  if (obj && typeof obj === 'object') for (const k of keys) if (obj[k] != null) out[k] = String(obj[k]).slice(0, 100);
  return out;
}

/** Tarefa nova num dia a partir de um modelo. */
function taskFromTemplate(t, date) {
  return normalizeTask({ title: t.title, notes: t.notes, moment: t.moment, category: t.category, priority: t.priority, date });
}

/** Ordem da lista: pendentes antes das concluídas, depois momento do turno, hora (dados antigos), prioridade e criação. */
const sortTasks = (a, b) =>
  (a.done - b.done) ||
  (MOMENT_ORDER[a.moment] - MOMENT_ORDER[b.moment]) ||
  ((a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0) ||
  (({ alta: 0, normal: 1, baixa: 2 })[a.priority] - ({ alta: 0, normal: 1, baixa: 2 })[b.priority]) ||
  a.createdAt.localeCompare(b.createdAt);

/** Tarefas de um dia, já ordenadas. */
const tasksOn = (iso) => state.tasks.filter((t) => t.date === iso).sort(sortTasks);
/** Tarefas pendentes de dias anteriores a hoje, da mais antiga para a mais nova. */
const overdueTasks = () => state.tasks.filter((t) => !t.done && t.date < todayISO()).sort((a, b) => a.date.localeCompare(b.date));

/* ---------------- Ações ---------------- */

/** Marca/desmarca uma tarefa como concluída. */
function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : null;
  save(); render();
}

/** Muda a tarefa de dia, com "Desfazer" no aviso. */
function moveTask(id, date) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || !isValidISO(date) || t.date === date) return;
  const from = t.date;
  t.date = date;
  save(); render();
  toast(`Movida para ${relativeLabel(date).toLowerCase()} (${fmtShort(date)})`, () => { t.date = from; save(); render(); });
}

/** Exclui a tarefa, com "Desfazer" no aviso (a tarefa volta ao fim da lista). */
function deleteTask(id) {
  const idx = state.tasks.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [removed] = state.tasks.splice(idx, 1);
  save(); render();
  toast('Tarefa excluída', () => { state.tasks.push(removed); save(); render(); });
}

/** Põe no dia os modelos marcados como rotina diária que ainda não estão lá (compara pelo título). */
function applyRoutine(date) {
  const existing = new Set(tasksOn(date).map((t) => t.title.toLowerCase()));
  const toAdd = state.templates.filter((t) => t.routine && !existing.has(t.title.toLowerCase()));
  if (!state.templates.some((t) => t.routine)) { toast('Nenhum modelo marcado como rotina. Marque na aba Modelos.'); return; }
  if (!toAdd.length) { toast('A rotina diária já está neste dia.'); return; }
  const added = toAdd.map((t) => taskFromTemplate(t, date));
  state.tasks.push(...added);
  save(); render();
  const ids = new Set(added.map((t) => t.id));
  toast(`${added.length} tarefa(s) da rotina adicionada(s)`, () => { state.tasks = state.tasks.filter((t) => !ids.has(t.id)); save(); render(); });
}

/** Adiciona uma tarefa a partir de um modelo no dia escolhido (pela aba Modelos). */
function addFromTemplate(tplId, date) {
  const t = state.templates.find((x) => x.id === tplId);
  if (!t) return;
  state.tasks.push(taskFromTemplate(t, date));
  save();
  toast(`“${t.title}” adicionada em ${fmtShort(date)}`);
}

/** "Trazer para hoje": move todas as pendências atrasadas para hoje, com "Desfazer". */
function moveOverdueToToday() {
  const list = overdueTasks();
  const prev = list.map((t) => [t, t.date]);
  list.forEach((t) => { t.date = todayISO(); });
  save(); render();
  toast(`${list.length} pendência(s) trazida(s) para hoje`, () => { prev.forEach(([t, d]) => { t.date = d; }); save(); render(); });
}

/* ---------------- Renderização ---------------- */

/** Área principal; cada tela redesenha o conteúdo dela inteiro. */
const app = $('#app');

/** Redesenha a tela atual: no primeiro acesso, o cadastro; depois, a aba escolhida (Dia, Semana, Modelos, Perfil). */
function render() {
  const onboarding = !state.onboarded;
  $('.tabs').hidden = onboarding;
  document.body.classList.toggle('onboarding', onboarding);
  $$('.tab').forEach((b) => { if (b.dataset.view === ui.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#fab').hidden = onboarding || ui.view === 'profile';
  renderGreeting();
  if (onboarding) { renderOnboarding(); return; }
  ({ day: renderDay, week: renderWeek, templates: renderTemplates, profile: renderProfile })[ui.view]();
}

/** Saudação do topo conforme a hora, com primeiro nome, unidade e turno. */
function renderGreeting() {
  const h = new Date().getHours();
  const hi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = state.profile.name.trim().split(/\s+/)[0];
  const store = state.profile.store.trim();
  const shift = shiftLabel(state.profile);
  $('#greeting').textContent = `${hi}${name ? ', ' + name : ''}${store ? ' · ' + store : ''}${shift ? ' · ' + shift : ''}`;
}

/** Campos de início e fim do turno (usados no cadastro e no perfil). */
function shiftFieldsHTML(p) {
  return `
  <fieldset class="shift">
    <legend>Turno</legend>
    <div class="row">
      <label>Começa às<input type="time" name="shiftStart" value="${esc(p.shiftStart)}"></label>
      <label>Termina às<input type="time" name="shiftEnd" value="${esc(p.shiftEnd)}"></label>
    </div>
  </fieldset>`;
}

/** Lê e valida o turno de um formulário; retorna null (e avisa) se só um dos horários foi preenchido. */
function readShift(f) {
  const shiftStart = f.shiftStart.value, shiftEnd = f.shiftEnd.value;
  if (!!shiftStart !== !!shiftEnd) { toast('Informe o horário de início e de término do turno.'); return null; }
  if (shiftStart && shiftStart === shiftEnd) { toast('O início e o término do turno não podem ser iguais.'); return null; }
  return { shiftStart, shiftEnd };
}

/** Primeiro acesso: formulário de perfil + escolha dos modelos que entram na rotina diária (agrupados por categoria). */
function renderOnboarding() {
  const groups = CATEGORIES.map((c) => ({ ...c, items: state.templates.filter((t) => t.category === c.id) })).filter((g) => g.items.length);
  app.innerHTML = `
  <form class="onboard stack" id="onboardForm">
    <div>
      <h1>Bem-vindo(a)!</h1>
      <p class="muted">Crie seu perfil para começar. Os dados ficam só neste aparelho.</p>
    </div>

    <section class="card stack">
      <h2>1. Seu perfil</h2>
      <label>Nome *<input name="name" required maxlength="100" autocomplete="name"></label>
      <div class="row">
        <label>Função<input name="role" maxlength="100" list="roles" placeholder="Ex.: Balconista"></label>
        <label>Farmácia / unidade<input name="store" maxlength="100"></label>
      </div>
      ${rolesDatalist()}
      ${shiftFieldsHTML(state.profile)}
    </section>

    <section class="card stack">
      <div>
        <h2>2. Monte sua rotina diária <span class="muted" style="font-weight:400">(opcional)</span></h2>
        <p class="muted" style="margin:4px 0 0">Marque as tarefas que você faz todo dia. Elas entram na lista de hoje e ficam disponíveis no botão “+ Rotina diária”. Dá para mudar depois na aba Modelos.</p>
      </div>
      ${groups.map((g) => `
        <div class="pickgroup">
          <h3>${g.label}</h3>
          ${g.items.map((t) => `
            <label class="pick" style="--cat:${catVar(t.category)}">
              <input type="checkbox" name="tpl" value="${t.id}">
              <span><span class="title">${esc(t.title)}</span>${t.moment ? ` <span class="muted">· ${momentInfo(t.moment).label.toLowerCase()}</span>` : ''}</span>
            </label>`).join('')}
        </div>`).join('')}
    </section>

    <div class="btnrow onboard-actions">
      <button class="btn btn-primary" type="submit">Criar perfil e começar</button>
      <button class="btn btn-ghost" type="button" data-act="import">Já tenho um backup — importar</button>
    </div>
  </form>`;
}

/** Sugestões de função para o campo "Função". */
const rolesDatalist = () => '<datalist id="roles"><option>Farmacêutico(a)</option><option>Balconista</option><option>Atendente</option><option>Caixa</option><option>Gerente</option><option>Estoquista</option></datalist>';

/**
 * HTML de uma tarefa da lista. `compact` é a versão curta da tela Semana (sem observações nem categoria);
 * `showLate` mostra a data original em pendências atrasadas.
 */
function taskHTML(t, { compact = false, showLate = false } = {}) {
  const late = showLate && !t.done && t.date < todayISO();
  return `
  <li class="task ${t.done ? 'done' : ''}" style="--cat:${catVar(t.category)}" data-id="${t.id}" draggable="true">
    <input type="checkbox" class="cb" ${t.done ? 'checked' : ''} aria-label="Concluir ${esc(t.title)}" data-act="toggle">
    <div class="body" data-act="edit">
      <div class="title">${esc(t.title)}</div>
      ${!compact && t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
      <div class="meta">
        ${t.moment ? `<span class="pill">${compact ? momentInfo(t.moment).short : momentInfo(t.moment).label}</span>` : ''}
        ${t.time ? `<span class="pill">${esc(t.time)}</span>` : ''}
        ${compact ? '' : `<span class="pill cat">${catLabel(t.category)}</span>`}
        ${t.priority === 'alta' ? '<span class="pill alta">Alta</span>' : ''}
        ${late ? `<span class="pill late">de ${fmtShort(t.date)}</span>` : ''}
      </div>
    </div>
    <div class="actions">
      ${compact ? '' : `<button class="icon-btn" data-act="tomorrow" title="Passar para o dia seguinte" aria-label="Passar para o dia seguinte"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`}
      <button class="icon-btn" data-act="move" title="Mudar de dia" aria-label="Mudar de dia"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></button>
    </div>
  </li>`;
}

/** Tela Dia: navegação entre dias, faixa da semana, pendências atrasadas, progresso, pendentes e concluídas. */
function renderDay() {
  const d = ui.date;
  const list = tasksOn(d);
  const pending = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
  const overdue = d === todayISO() ? overdueTasks() : [];
  const days = weekDays(d);

  app.innerHTML = `
  <div class="stack">
    <div class="daynav">
      <button class="icon-btn" data-nav="-1" aria-label="Dia anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h1>${fmtLong(d)}<span class="sub">${relativeLabel(d)}</span></h1>
      ${d !== todayISO() ? '<button class="btn btn-sm" data-nav="today">Hoje</button>' : ''}
      <label class="icon-btn" title="Escolher data" style="position:relative;flex:none">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
        <input type="date" id="jumpDate" value="${d}" aria-label="Escolher data" style="position:absolute;inset:0;opacity:0;cursor:pointer">
      </label>
      <button class="icon-btn" data-nav="1" aria-label="Próximo dia"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>

    <div class="weekstrip">
      ${days.map((iso) => {
        const n = tasksOn(iso); const p = n.filter((t) => !t.done).length;
        return `<button class="wsday ${iso === d ? 'selected' : ''} ${iso === todayISO() ? 'today' : ''}" data-date="${iso}" data-drop="${iso}">
          <small>${fmtWeekday(iso)}</small><b>${fromISO(iso).getDate()}</b>
          <span class="dots">${n.length ? (p ? `${p} pend.` : '✓') : ''}</span>
        </button>`;
      }).join('')}
    </div>

    ${overdue.length ? `
    <div class="banner">
      <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
      <p><b>${overdue.length}</b> tarefa(s) pendente(s) de dias anteriores.</p>
      <button class="btn btn-sm" data-act="bring-overdue">Trazer para hoje</button>
    </div>
    <ul class="tasklist">${overdue.map((t) => taskHTML(t, { showLate: true })).join('')}</ul>` : ''}

    ${list.length ? `
    <div>
      <div class="progress-label"><span>${done.length} de ${list.length} concluída(s)</span><span>${pct}%</span></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>` : ''}

    <div class="section-head">
      <h2>Tarefas</h2>
      <button class="btn btn-sm" data-act="routine">+ Rotina diária</button>
    </div>

    ${pending.length ? `<ul class="tasklist">${pending.map((t) => taskHTML(t)).join('')}</ul>`
      : `<div class="card empty">${list.length ? 'Tudo feito por aqui! 🎉' : 'Nenhuma tarefa neste dia.'}
          <div class="btnrow" style="justify-content:center"><button class="btn btn-primary" data-act="new">Adicionar tarefa</button><button class="btn" data-act="go-templates">Escolher dos modelos</button></div></div>`}

    ${done.length ? `
    <details class="donegroup" ${pending.length ? '' : 'open'}>
      <summary>Concluídas (${done.length})</summary>
      <ul class="tasklist">${done.map((t) => taskHTML(t)).join('')}</ul>
    </details>` : ''}
  </div>`;
}

/** Tela Semana: uma coluna por dia (segunda a domingo), onde as tarefas podem ser arrastadas entre os dias. */
function renderWeek() {
  const days = weekDays(ui.date);
  const today = todayISO();
  app.innerHTML = `
  <div class="stack">
    <div class="daynav">
      <button class="icon-btn" data-nav="-7" aria-label="Semana anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h1>${fmtShort(days[0])} a ${fmtShort(days[6])}<span class="sub">Semana</span></h1>
      ${!days.includes(today) ? '<button class="btn btn-sm" data-nav="today">Esta semana</button>' : ''}
      <button class="icon-btn" data-nav="7" aria-label="Próxima semana"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
    <p class="hint">Arraste as tarefas entre os dias para remanejar. No celular, toque no ícone de calendário da tarefa.</p>
    <div class="weekgrid">
      ${days.map((iso) => {
        const list = tasksOn(iso);
        return `<section class="wcol ${iso === today ? 'today' : ''}" data-drop="${iso}">
          <header><button data-date="${iso}">${fmtWeekday(iso)} ${fromISO(iso).getDate()}</button><small>${list.filter((t) => t.done).length}/${list.length}</small></header>
          <ul class="tasklist">${list.map((t) => taskHTML(t, { compact: true })).join('')}</ul>
          <button class="add" data-act="new" data-for="${iso}">+ tarefa</button>
        </section>`;
      }).join('')}
    </div>
  </div>`;
}

/** Tela Modelos: modelos por categoria, com adicionar ao dia, editar, excluir e restaurar os padrão. */
function renderTemplates() {
  const groups = CATEGORIES.map((c) => ({ ...c, items: state.templates.filter((t) => t.category === c.id) })).filter((g) => g.items.length);
  app.innerHTML = `
  <div class="stack">
    <div class="section-head">
      <div><h1 style="font-size:1.25rem">Modelos de tarefa</h1>
      <p class="hint" style="margin:4px 0 0">Adicionam em <b>${fmtLong(ui.date)}</b>. Os marcados como rotina entram com “+ Rotina diária”.</p></div>
      <div class="btnrow">
        <button class="btn" data-act="routine">Aplicar rotina neste dia</button>
        <button class="btn btn-primary" data-act="new-tpl">Novo modelo</button>
      </div>
    </div>
    ${groups.length ? groups.map((g) => `
      <h2 style="margin-top:8px">${g.label}</h2>
      <div class="tplgrid">
        ${g.items.map((t) => `
        <div class="tpl" style="--cat:${catVar(t.category)}" data-tpl="${t.id}">
          <div class="body">
            <div class="title">${esc(t.title)}</div>
            ${t.notes ? `<div class="notes muted" style="font-size:.85rem">${esc(t.notes)}</div>` : ''}
            <div class="meta">
              ${t.moment ? `<span class="pill">${momentInfo(t.moment).label}</span>` : ''}
              ${t.routine ? '<span class="pill cat">Rotina diária</span>' : ''}
              ${t.priority === 'alta' ? '<span class="pill alta">Alta</span>' : ''}
            </div>
          </div>
          <button class="icon-btn" data-act="tpl-add" title="Adicionar ao dia" aria-label="Adicionar ao dia"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
          <button class="icon-btn" data-act="tpl-edit" title="Editar" aria-label="Editar modelo"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="icon-btn" data-act="tpl-del" title="Excluir" aria-label="Excluir modelo"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
        </div>`).join('')}
      </div>`).join('')
    : '<div class="card empty">Nenhum modelo. Crie o primeiro!</div>'}
    <div><button class="btn btn-ghost btn-sm" data-act="restore-tpl">Restaurar modelos padrão</button></div>
  </div>`;
}

/** Tela Perfil: dados e tema, resumo, backup (exportar/importar) e limpeza. */
function renderProfile() {
  const p = state.profile;
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  const pend = overdueTasks().length;
  app.innerHTML = `
  <div class="grid2">
    <form class="card stack" id="profileForm">
      <h2>Meu perfil</h2>
      <label>Nome *<input name="name" value="${esc(p.name)}" required maxlength="100" autocomplete="name"></label>
      <label>Função<input name="role" value="${esc(p.role)}" maxlength="100" list="roles" placeholder="Ex.: Balconista, Farmacêutico(a)"></label>
      ${rolesDatalist()}
      <label>Farmácia / unidade<input name="store" value="${esc(p.store)}" maxlength="100"></label>
      ${shiftFieldsHTML(p)}
      <label>Tema<select name="theme">
        <option value="auto" ${state.settings.theme === 'auto' ? 'selected' : ''}>Automático</option>
        <option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Claro</option>
        <option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Escuro</option>
      </select></label>
      <div><button class="btn btn-primary" type="submit">Salvar perfil</button></div>
    </form>

    <div class="stack">
      <div class="card stack">
        <h2>Resumo</h2>
        <div class="stats">
          <div class="stat"><b>${total}</b><span>tarefas</span></div>
          <div class="stat"><b>${done}</b><span>concluídas</span></div>
          <div class="stat"><b>${pend}</b><span>atrasadas</span></div>
        </div>
      </div>

      <div class="card stack">
        <h2>Backup e transferência</h2>
        <p class="muted" style="margin:0">Os dados ficam só neste aparelho. Exporte um arquivo para guardar ou levar para outro celular/computador.</p>
        <div class="btnrow">
          <button class="btn btn-primary" data-act="export" data-what="all">Exportar tudo</button>
          <button class="btn" data-act="export" data-what="profile">Só perfil e modelos</button>
          <button class="btn" data-act="export" data-what="tasks">Só atividades</button>
        </div>
        <div class="btnrow">
          <button class="btn" data-act="import">Importar arquivo…</button>
        </div>
      </div>

      <div class="card stack">
        <h2>Limpeza</h2>
        <div class="btnrow">
          <button class="btn" data-act="clear-done">Apagar concluídas com +30 dias</button>
          <button class="btn btn-danger" data-act="reset">Apagar todos os dados</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------- Diálogos ---------------- */

/** Preenche um <select> com as categorias. */
function fillCategorySelect(sel) {
  sel.innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
}
fillCategorySelect($('#taskForm').category);
fillCategorySelect($('#tplForm').category);

// Botões "Cancelar" fecham o diálogo; clicar fora da caixa (no fundo) também.
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/** Abre o diálogo de tarefa: vazio para criar (no dia indicado) ou preenchido para editar. */
function openTaskDialog(id = null, date = ui.date) {
  const f = $('#taskForm');
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  ui.editingTaskId = t ? t.id : null;
  $('#taskDialogTitle').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
  f.title.value = t?.title || '';
  f.notes.value = t?.notes || '';
  f.date.value = t?.date || date;
  f.moment.value = t?.moment || '';
  f.category.value = t?.category || 'outros';
  f.priority.value = t?.priority || 'normal';
  f.saveAsTemplate.checked = false;
  $('#saveAsTplWrap').hidden = !!t;
  // Excluir pelo diálogo de edição.
  $('#deleteTaskBtn').hidden = !t;
  $('#taskDialog').showModal();
  if (!t) f.title.focus();
}

// O form é method="dialog": o envio fecha o diálogo sozinho; preventDefault o mantém aberto se faltar dado.
$('#taskForm').addEventListener('submit', (e) => {
  const f = e.target;
  const data = { title: f.title.value.trim(), notes: f.notes.value.trim(), date: f.date.value, moment: f.moment.value, category: f.category.value, priority: f.priority.value };
  if (!data.title || !isValidISO(data.date)) { e.preventDefault(); return; }
  if (ui.editingTaskId) {
    const t = state.tasks.find((x) => x.id === ui.editingTaskId);
    Object.assign(t, normalizeTask({ ...t, ...data }));
  } else {
    state.tasks.push(normalizeTask(data));
    if (f.saveAsTemplate.checked) state.templates.push(normalizeTemplate(data));
  }
  save(); render();
});

$('#deleteTaskBtn').addEventListener('click', () => {
  $('#taskDialog').close();
  deleteTask(ui.editingTaskId);
});

/** Abre o diálogo "Mover tarefa" com atalhos (hoje, amanhã, +1 semana...) e um campo de data livre. */
function openMoveDialog(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  ui.movingTaskId = id;
  const f = $('#moveForm');
  $('#moveTaskName').textContent = `“${t.title}” — hoje em ${fmtLong(t.date)}`;
  f.date.value = t.date;
  const today = todayISO();
  const opts = [
    ['Hoje', today], ['Amanhã', addDays(today, 1)], ['Depois de amanhã', addDays(today, 2)],
    ['+1 dia', addDays(t.date, 1)], ['+1 semana', addDays(t.date, 7)], ['Próxima segunda', addDays(weekStart(today), 7)],
  ];
  $('#moveChips').innerHTML = opts.map(([l, iso]) => `<button type="button" class="chip" data-iso="${iso}">${l} <span class="muted">${fmtShort(iso)}</span></button>`).join('');
  $('#moveDialog').showModal();
}

// Clique num atalho move na hora; o campo de data move ao enviar o formulário.
$('#moveChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-iso]');
  if (!b) return;
  $('#moveDialog').close();
  moveTask(ui.movingTaskId, b.dataset.iso);
});
$('#moveForm').addEventListener('submit', (e) => moveTask(ui.movingTaskId, e.target.date.value));

/** Abre o diálogo de modelo: vazio para criar ou preenchido para editar. */
function openTplDialog(id = null) {
  const f = $('#tplForm');
  const t = id ? state.templates.find((x) => x.id === id) : null;
  ui.editingTplId = t ? t.id : null;
  $('#tplDialogTitle').textContent = t ? 'Editar modelo' : 'Novo modelo';
  f.title.value = t?.title || '';
  f.notes.value = t?.notes || '';
  f.moment.value = t?.moment || '';
  f.category.value = t?.category || 'outros';
  f.priority.value = t?.priority || 'normal';
  f.routine.checked = !!t?.routine;
  $('#tplDialog').showModal();
}

// Salva o modelo novo ou editado.
$('#tplForm').addEventListener('submit', (e) => {
  const f = e.target;
  const data = { title: f.title.value.trim(), notes: f.notes.value.trim(), moment: f.moment.value, category: f.category.value, priority: f.priority.value, routine: f.routine.checked };
  if (!data.title) { e.preventDefault(); return; }
  if (ui.editingTplId) {
    const t = state.templates.find((x) => x.id === ui.editingTplId);
    Object.assign(t, normalizeTemplate({ ...t, ...data }));
  } else {
    state.templates.push(normalizeTemplate(data));
  }
  save(); render();
});

/** Confirmação com botões customizados. Retorna Promise com o valor do botão escolhido (ou null). */
function ask(title, text, buttons) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmActions').innerHTML = '<span class="spacer"></span>' + [{ label: 'Cancelar', value: '', cls: 'btn-ghost' }, ...buttons]
      .map((b) => `<button class="btn ${b.cls || ''}" value="${b.value}">${b.label}</button>`).join('');
    dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

/* ---------------- Importar / exportar ---------------- */

/**
 * Baixa um JSON de backup. `what`: "all" (tudo), "profile" (perfil, modelos e tema) ou "tasks" (só tarefas).
 * O nome do arquivo leva o primeiro nome sem acentos e a data.
 */
function exportData(what) {
  const payload = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), content: what };
  if (what !== 'tasks') { payload.profile = state.profile; payload.templates = state.templates; payload.settings = state.settings; }
  if (what !== 'profile') payload.tasks = state.tasks;
  const name = (state.profile.name.trim().split(/\s+/)[0] || 'farmatarefas').normalize('NFD').replace(/[^\w-]/g, '').toLowerCase();
  const suffix = { all: 'completo', profile: 'perfil', tasks: 'atividades' }[what];
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `farmatarefas-${name}-${suffix}-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Arquivo exportado');
}

/**
 * Importa um backup. "Substituir" troca as partes que o arquivo traz; "Mesclar" preenche só os campos vazios
 * do perfil e junta modelos e tarefas pelo id (o importado vence). No primeiro acesso substitui sem perguntar.
 */
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('Arquivo inválido: não é um JSON.'); return; }
  if (!data || data.format !== EXPORT_FORMAT) { toast('Este arquivo não é um backup do FarmaTarefas.'); return; }

  const hasProfile = !!data.profile || Array.isArray(data.templates);
  const tasks = Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [];
  const templates = Array.isArray(data.templates) ? data.templates.map(normalizeTemplate) : [];
  const parts = [hasProfile && 'perfil e modelos', tasks.length && `${tasks.length} tarefa(s)`].filter(Boolean).join(' + ');

  // No primeiro acesso não há nada para preservar: o backup substitui o estado inicial
  const mode = !state.onboarded ? 'replace' : await ask('Importar dados', `O arquivo contém: ${parts || 'nada para importar'}. Como deseja importar?`, [
    { label: 'Mesclar', value: 'merge' },
    { label: 'Substituir tudo', value: 'replace', cls: 'btn-danger' },
  ]);
  if (!mode) return;

  if (mode === 'replace') {
    if (hasProfile) {
      state.profile = sanitizeState({ profile: data.profile }).profile;
      state.templates = templates;
      if (data.settings) state.settings = sanitizeState({ settings: data.settings }).settings;
    }
    if (Array.isArray(data.tasks)) state.tasks = tasks;
  } else {
    // Mescla: perfil importado preenche só campos vazios; itens com mesmo id são atualizados
    if (data.profile) {
      const imp = sanitizeState({ profile: data.profile }).profile;
      for (const k of Object.keys(imp)) if (!state.profile[k]) state.profile[k] = imp[k];
    }
    mergeById(state.templates, templates);
    mergeById(state.tasks, tasks);
  }
  state.onboarded = true;
  save(); applyTheme(); render();
  toast('Dados importados');
}

/** Junta listas pelo id: item com id já existente é trocado pelo novo; os demais vão para o fim. */
function mergeById(target, incoming) {
  const idx = new Map(target.map((x, i) => [x.id, i]));
  for (const item of incoming) {
    if (idx.has(item.id)) target[idx.get(item.id)] = item;
    else target.push(item);
  }
}

// O input de arquivo escondido é aberto pelos botões "Importar"; o value é zerado para aceitar o mesmo arquivo de novo.
$('#importFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importFile(f);
});

/* ---------------- Eventos ---------------- */

// Abas e botão flutuante (+): na aba Modelos o + cria modelo; nas outras, tarefa.
$$('.tab').forEach((b) => b.addEventListener('click', () => { ui.view = b.dataset.view; render(); window.scrollTo(0, 0); }));
$('#fab').addEventListener('click', () => (ui.view === 'templates' ? openTplDialog() : openTaskDialog()));

// Delegação de cliques de todas as telas: data-nav (andar dias/semanas), data-date (abrir um dia) e
// data-act (ações). O id da tarefa/modelo vem do elemento pai com data-id/data-tpl.
app.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    ui.date = nav.dataset.nav === 'today' ? todayISO() : addDays(ui.date, Number(nav.dataset.nav));
    render(); return;
  }
  const dateBtn = e.target.closest('[data-date]');
  if (dateBtn) { ui.date = dateBtn.dataset.date; ui.view = 'day'; render(); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const taskId = el.closest('[data-id]')?.dataset.id;
  const tplId = el.closest('[data-tpl]')?.dataset.tpl;

  switch (el.dataset.act) {
    case 'toggle': toggleTask(taskId); break;
    case 'edit': openTaskDialog(taskId); break;
    case 'move': openMoveDialog(taskId); break;
    case 'tomorrow': {
      const t = state.tasks.find((x) => x.id === taskId);
      // Pendência atrasada vai para amanhã a partir de hoje; demais, dia seguinte ao atual
      moveTask(taskId, addDays(t.date < todayISO() ? todayISO() : t.date, 1));
      break;
    }
    case 'new': openTaskDialog(null, el.dataset.for || ui.date); break;
    case 'routine': applyRoutine(ui.date); break;
    case 'go-templates': ui.view = 'templates'; render(); window.scrollTo(0, 0); break;
    case 'bring-overdue': moveOverdueToToday(); break;
    case 'new-tpl': openTplDialog(); break;
    case 'tpl-add': addFromTemplate(tplId, ui.date); break;
    case 'tpl-edit': openTplDialog(tplId); break;
    case 'tpl-del': {
      // Sem conferir o -1, splice(-1, 1) apagaria o último modelo da lista
      const i = state.templates.findIndex((x) => x.id === tplId);
      if (i < 0) break;
      const [removed] = state.templates.splice(i, 1);
      save(); render();
      toast('Modelo excluído', () => { state.templates.splice(i, 0, removed); save(); render(); });
      break;
    }
    case 'restore-tpl': {
      const have = new Set(state.templates.map((t) => t.title.toLowerCase()));
      const missing = DEFAULT_TEMPLATES.filter((t) => !have.has(t.title.toLowerCase())).map((t) => normalizeTemplate(t));
      state.templates.push(...missing);
      save(); render();
      toast(missing.length ? `${missing.length} modelo(s) restaurado(s)` : 'Todos os modelos padrão já existem.');
      break;
    }
    case 'export': exportData(el.dataset.what); break;
    case 'import': $('#importFile').click(); break;
    case 'clear-done': {
      const limit = addDays(todayISO(), -30);
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((t) => !(t.done && t.date < limit));
      save(); render();
      toast(`${before - state.tasks.length} tarefa(s) apagada(s)`);
      break;
    }
    case 'reset': {
      const ok = await ask('Apagar todos os dados?', 'Perfil, tarefas e modelos serão apagados deste aparelho. Exporte um backup antes se quiser guardar.', [
        { label: 'Apagar tudo', value: 'yes', cls: 'btn-danger' },
      ]);
      if (ok !== 'yes') return;
      state = freshState();
      save(); applyTheme(); ui.view = 'day'; ui.date = todayISO(); render();
      toast('Dados apagados');
      break;
    }
  }
});

/** Conclui o cadastro: salva o perfil, marca os modelos escolhidos como rotina e já cria as tarefas deles hoje. */
function finishOnboarding(f) {
  const name = f.name.value.trim();
  const shift = readShift(f);
  if (!name || !shift) return;
  state.profile = { name, role: f.role.value.trim(), store: f.store.value.trim(), ...shift };
  const picked = new Set($$('input[name="tpl"]:checked', f).map((c) => c.value));
  state.templates.forEach((t) => { t.routine = picked.has(t.id); });
  const today = todayISO();
  state.tasks.push(...state.templates.filter((t) => t.routine).map((t) => taskFromTemplate(t, today)));
  state.onboarded = true;
  ui.view = 'day'; ui.date = today;
  save(); render(); window.scrollTo(0, 0);
  toast(picked.size ? `Perfil criado · ${picked.size} tarefa(s) na rotina de hoje` : 'Perfil criado! Adicione suas tarefas no +');
}

// Campo de data escondido atrás do ícone de calendário da tela Dia.
app.addEventListener('change', (e) => {
  if (e.target.id === 'jumpDate' && isValidISO(e.target.value)) { ui.date = e.target.value; render(); }
});

// Envio do cadastro (primeiro acesso) e do formulário de perfil.
app.addEventListener('submit', (e) => {
  if (e.target.id === 'onboardForm') { e.preventDefault(); finishOnboarding(e.target); return; }
  if (e.target.id !== 'profileForm') return;
  e.preventDefault();
  const f = e.target;
  const shift = readShift(f);
  if (!shift) return;
  state.profile = { name: f.name.value.trim(), role: f.role.value.trim(), store: f.store.value.trim(), ...shift };
  state.settings.theme = f.theme.value;
  save(); applyTheme(); render();
  toast('Perfil salvo');
});

/* Arrastar e soltar (desktop): solta sobre um dia da semana ou da faixa semanal */
let dragId = null;
app.addEventListener('dragstart', (e) => {
  const li = e.target.closest?.('.task[data-id]');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
app.addEventListener('dragend', () => { dragId = null; $$('.dragging, .drop-over').forEach((x) => x.classList.remove('dragging', 'drop-over')); });
app.addEventListener('dragover', (e) => {
  const zone = dragId && e.target.closest('[data-drop]');
  if (!zone) return;
  e.preventDefault();
  $$('.drop-over').forEach((x) => x !== zone && x.classList.remove('drop-over'));
  zone.classList.add('drop-over');
});
app.addEventListener('drop', (e) => {
  const zone = e.target.closest('[data-drop]');
  if (!zone || !dragId) return;
  e.preventDefault();
  moveTask(dragId, zone.dataset.drop);
});

/* ---------------- Toast ---------------- */

let toastTimer;
/** Aviso no rodapé. Com `undo`, mostra "Desfazer" e fica 5 s; sem, some em 2,5 s. */
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Desfazer</button>' : ''}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2500);
}

/* ---------------- Tema, PWA e inicialização ---------------- */

/** Aplica o tema do perfil; "auto" remove o atributo e o CSS segue o tema do sistema. */
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// Botão "Instalar app": só aparece quando o navegador oferece a instalação (Chrome/Edge/Android).
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installBtn').hidden = true;
});

// Service worker (sw.js) só funciona via http(s), não abrindo o arquivo direto.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}

// Virada do dia com o app aberto: mantém "hoje" correto
let lastToday = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = todayISO();
  if (now !== lastToday) { if (ui.date === lastToday) ui.date = now; lastToday = now; render(); }
});

// Sincroniza entre abas abertas
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); applyTheme(); render(); } });

// Inicialização: grava o estado já saneado (converte dados antigos), aplica o tema e desenha a tela.
save();
applyTheme();
render();
