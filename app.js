const STORAGE_KEY = "retox.sessions.v1";
const ACTIVE_USER_KEY = "retox.activeUser.v1";
const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("retox-realtime") : null;
const SUPABASE_URL = "https://oixqthwwjvvspsuwfhme.supabase.co";
const SUPABASE_KEY = "sb_publishable_WaBBzhjih4wZiDGnnfprVw_zcp4Y63_";
const SUPABASE_TABLE = "retox_sessions";
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY) || null;
let sessionCache = readLocalSessions();
let realtimeChannel = null;
let remoteReady = false;

const avatars = [
  ["robot-bailarin", "Robot bailarin", "🤖", "#dff6ee"],
  ["emoji-nerd", "Emoji nerd", "🤓", "#ecf9d5"],
  ["llama-gafas", "Llama con gafas", "🦙", "#dceefd"],
  ["pulpo-dj", "Pulpo DJ", "🐙", "#f0e5ff"],
  ["cactus-ceo", "Cactus CEO", "🌵", "#e4f5dd"],
  ["astronauta", "Astronauta paisa", "🧑‍🚀", "#e8f1ff"],
  ["tiburon", "Tiburon amable", "🦈", "#d8f4ff"],
  ["unicornio", "Unicornio sprint", "🦄", "#ffe8f4"],
  ["ninja", "Ninja UX", "🥷", "#edf0f2"],
  ["mago", "Mago de datos", "🧙", "#e7f9ef"],
  ["dino", "Dino curioso", "🦖", "#eaf8dd"],
  ["fantasma", "Fantasma feliz", "👻", "#eff6ff"],
  ["pizza", "Pizza analitica", "🍕", "#fff0db"],
  ["koala", "Koala tester", "🐨", "#eef2f3"],
  ["marciano", "Marciano wow", "👽", "#e8fbdf"],
  ["gato", "Gato estratega", "🐱", "#fff1d8"],
  ["rana", "Rana agil", "🐸", "#e1f8db"],
  ["mono", "Mono facilitador", "🐵", "#f8ead8"],
  ["zorro", "Zorro service", "🦊", "#ffe8d8"],
  ["ballena", "Ballena azul", "🐳", "#dff5ff"]
];

const sampleNames = ["Ana", "Luis", "Mafe", "Carlos", "Sofi", "Juli", "Diana", "Mateo"];
const defaultQuestion = "Del 1 al 10, ¿como calificas esta experiencia?";

let appState = {
  view: "welcome",
  code: "",
  user: loadActiveUser(),
  hostMode: false,
  dark: false
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function sessionCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function readLocalSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function loadSessions() {
  return sessionCache;
}

function saveLocalSessions(sessions) {
  sessionCache = sessions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  broadcast?.postMessage({ type: "sessions:update" });
  window.dispatchEvent(new Event("retox:update"));
}

async function loadRemoteSessions() {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient.from(SUPABASE_TABLE).select("code,data");
  if (error) {
    console.warn("Supabase no esta listo, usando almacenamiento local:", error.message);
    return false;
  }
  sessionCache = Object.fromEntries((data || []).map((row) => [row.code, row.data]));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  remoteReady = true;
  return true;
}

async function fetchRemoteSession(code) {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.from(SUPABASE_TABLE).select("code,data").eq("code", code).maybeSingle();
  if (error) {
    console.warn("No pude consultar Supabase:", error.message);
    return null;
  }
  if (!data) return null;
  sessionCache = { ...sessionCache, [data.code]: data.data };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  return data.data;
}

async function persistSession(session) {
  const sessions = { ...sessionCache, [session.code]: session };
  sessionCache = sessions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  broadcast?.postMessage({ type: "sessions:update" });

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .upsert({ code: session.code, data: session, updated_at: new Date().toISOString() }, { onConflict: "code" });
    if (error) {
      remoteReady = false;
      console.warn("No pude guardar en Supabase, mantengo copia local:", error.message);
      toast("Supabase no esta listo. Revisa la tabla retox_sessions.");
    } else {
      remoteReady = true;
    }
  }

  window.dispatchEvent(new Event("retox:update"));
}

function subscribeToRemoteSessions() {
  if (!supabaseClient || realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel("retox-sessions")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: SUPABASE_TABLE },
      (payload) => {
        const row = payload.new || payload.old;
        if (!row?.code) return;
        if (payload.eventType === "DELETE") {
          const { [row.code]: _removed, ...rest } = sessionCache;
          sessionCache = rest;
        } else {
          sessionCache = { ...sessionCache, [row.code]: row.data };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
        render();
      }
    )
    .subscribe();
}

function loadActiveUser() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_USER_KEY));
  } catch {
    return null;
  }
}

function saveActiveUser(user) {
  localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
}

function getSession(code = appState.code) {
  return loadSessions()[code];
}

async function upsertSession(code, updater) {
  const current = await fetchRemoteSession(code) || getSession(code);
  if (!current) return;
  await persistSession(updater(current));
}

async function createSession(options = {}) {
  const code = sessionCode();
  const now = Date.now();
  const durationMinutes = Math.max(1, Number(options.durationMinutes || 10));
  const type = options.type === "quiz" ? "quiz" : "scale";
  const session = {
    code,
    createdAt: now,
    type,
    question: String(options.question || defaultQuestion).trim() || defaultQuestion,
    quiz: type === "quiz" ? { questions: options.questions || [] } : null,
    durationMinutes,
    expiresAt: now + durationMinutes * 60 * 1000,
    participants: {},
    votes: {},
    history: [],
    round: 1
  };
  await persistSession(session);
  appState = { ...appState, view: "host", hostMode: true, code };
  render();
}

async function joinSession(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    toast("Ingresa el codigo de la sesion.");
    return;
  }
  const session = getSession(normalized) || await fetchRemoteSession(normalized);
  if (!session) {
    toast("No encuentro esa sesion. Revisa el codigo.");
    return;
  }
  appState = { ...appState, code: normalized, view: appState.user ? "waiting" : "identify", hostMode: false };
  if (appState.user) await addParticipant(normalized, appState.user);
  render();
}

async function addParticipant(code, user) {
  await upsertSession(code, (session) => ({
    ...session,
    participants: {
      ...session.participants,
      [user.id]: { ...user, joinedAt: session.participants[user.id]?.joinedAt || Date.now() }
    }
  }));
}

async function submitIdentity(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const name = String(form.get("name") || "").trim();
  const avatar = String(form.get("avatar") || avatars[0][0]);
  if (!name) {
    toast("Escribe tu nombre para entrar.");
    return;
  }
  const user = { id: appState.user?.id || uid(), name, avatar };
  appState.user = user;
  saveActiveUser(user);
  await addParticipant(appState.code, user);
  appState.view = "waiting";
  render();
}

async function vote(value) {
  if (!appState.user) return;
  const current = await fetchRemoteSession(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("La votacion ya esta cerrada.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu voto ya quedo registrado.");
    render();
    return;
  }
  await upsertSession(appState.code, (session) => ({
    ...session,
    votes: {
      ...session.votes,
      [appState.user.id]: { value, at: Date.now(), round: session.round }
    }
  }));
  toast(`Voto enviado: ${value}`);
  render();
}

async function submitQuiz(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchRemoteSession(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("El quiz ya esta cerrado.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu quiz ya fue enviado.");
    render();
    return;
  }
  const form = new FormData(event.target);
  const answers = {};
  (current.quiz?.questions || []).forEach((question, qIndex) => {
    answers[qIndex] = form.getAll(`q-${qIndex}`).map(Number);
  });
  const score = scoreQuiz(current, answers);
  await upsertSession(appState.code, (session) => ({
    ...session,
    votes: {
      ...session.votes,
      [appState.user.id]: { answers, score, at: Date.now(), round: session.round }
    }
  }));
  toast(`Quiz enviado. Puntaje: ${score}`);
  render();
}

async function resetVotes() {
  await upsertSession(appState.code, (session) => {
    const stats = computeStats(session);
    const history = stats.count
      ? [{ question: session.question, average: stats.average, count: stats.count, at: Date.now() }, ...session.history].slice(0, 8)
      : session.history;
    const now = Date.now();
    return { ...session, votes: {}, history, round: session.round + 1, expiresAt: now + (session.durationMinutes || 10) * 60 * 1000 };
  });
}

async function updateQuestion(event) {
  event.preventDefault();
  const question = new FormData(event.target).get("question").trim();
  if (!question) return;
  await upsertSession(appState.code, (session) => ({ ...session, question }));
  toast("Pregunta actualizada.");
}

async function addDemoVotes() {
  await upsertSession(appState.code, (session) => {
    const participants = { ...session.participants };
    const votes = { ...session.votes };
    sampleNames.forEach((name, index) => {
      const id = `demo-${index}`;
      participants[id] ||= { id, name, avatar: avatars[(index + 3) % avatars.length][0], joinedAt: Date.now() };
      votes[id] = { value: Math.ceil(Math.random() * 10), at: Date.now(), round: session.round };
    });
    return { ...session, participants, votes };
  });
}

function appBaseUrl() {
  return location.href.split("#")[0];
}

function sessionLinks(code) {
  const base = appBaseUrl();
  return {
    host: `${base}#host=${code}`,
    participant: `${base}#join=${code}`,
    display: `${base}#display=${code}`
  };
}

function qrUrl(value, size = 180) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

function qrBlock(url, label = "QR participantes", size = 180) {
  return `
    <div class="qr-block">
      <p class="eyebrow">${label}</p>
      <a href="${qrUrl(url, 320)}" target="_blank" rel="noreferrer" aria-label="Abrir QR">
        <img src="${qrUrl(url, size)}" alt="${label}" loading="lazy" />
      </a>
    </div>
  `;
}

function exportSessionResults(session) {
  if (!session) return;
  const stats = computeStats(session);
  const participants = Object.values(session.participants);
  const rows = participants.map((participant) => {
    const avatar = avatarById(participant.avatar);
    const vote = session.votes[participant.id];
    return [
      participant.name,
      avatar[1],
      session.type === "quiz" ? vote?.score ?? "" : vote?.value ?? "",
      vote?.at ? new Date(vote.at).toLocaleString("es-CO") : "",
      session.question,
      session.code,
      session.round
    ];
  });
  const distributionRows = stats.distribution.map((count, index) => [index + 1, count]);
  const html = excelWorkbook([
    {
      name: "Votos",
      rows: [
        ["Retox - Resultados de encuesta"],
        ["Vicepresidencia Experiencia Usuario Cliente - Grupo EPM"],
        ["Codigo", session.code],
        ["Tipo", session.type === "quiz" ? "Quiz" : "Escala"],
        ["Pregunta", session.question],
        [session.type === "quiz" ? "Promedio puntos" : "Promedio", stats.count ? stats.average.toFixed(2) : ""],
        ["Participantes", participants.length],
        ["Respuestas", stats.count],
        ...(session.type === "quiz" ? [["Puntaje maximo", stats.maxScore]] : []),
        [],
        ["Nombre", "Avatar", session.type === "quiz" ? "Puntaje" : "Voto", "Fecha respuesta", "Pregunta", "Codigo sesion", "Ronda"],
        ...rows
      ]
    },
    ...(session.type === "quiz" ? [{
      name: "Quiz",
      rows: [
        ["Pregunta", "Opcion", "Correcta", "Puntos"],
        ...(session.quiz?.questions || []).flatMap((question) =>
          question.options.map((option) => [question.text, option.text, option.correct ? "Si" : "No", option.points])
        )
      ]
    }] : [{
      name: "Distribucion",
      rows: [["Valor", "Cantidad"], ...distributionRows]
    }]),
    {
      name: "Historial",
      rows: [
        ["Pregunta", "Promedio", "Votos", "Fecha"],
        ...session.history.map((item) => [
          item.question,
          item.average.toFixed(2),
          item.count,
          new Date(item.at).toLocaleString("es-CO")
        ])
      ]
    }
  ]);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `retox-resultados-${session.code}.xls`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  toast("Excel exportado.");
}

function exportResults() {
  exportSessionResults(getSession(appState.code));
}

function excelWorkbook(sheets) {
  const sheetHtml = sheets
    .map(
      (sheet) => `
        <h2>${escapeHtml(sheet.name)}</h2>
        <table border="1">
          ${sheet.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`)
            .join("")}
        </table>
      `
    )
    .join("<br/>");
  return `
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>${sheetHtml}</body>
    </html>
  `;
}

function computeStats(session) {
  if (session?.type === "quiz") return computeQuizStats(session);
  const values = Object.values(session?.votes || {}).map((vote) => Number(vote.value));
  const count = values.length;
  const average = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
  const distribution = Array.from({ length: 10 }, (_, index) => values.filter((value) => value === index + 1).length);
  return { average, count, distribution, max: Math.max(1, ...distribution) };
}

function scoreQuiz(session, answers) {
  return (session.quiz?.questions || []).reduce((total, question, qIndex) => {
    const selected = new Set((answers[qIndex] || []).map(Number));
    return total + question.options.reduce((sum, option, index) => {
      return sum + (option.correct && selected.has(index) ? Number(option.points || 0) : 0);
    }, 0);
  }, 0);
}

function maxQuizScore(session) {
  return (session.quiz?.questions || []).reduce((total, question) => {
    return total + question.options.reduce((sum, option) => sum + (option.correct ? Number(option.points || 0) : 0), 0);
  }, 0);
}

function computeQuizStats(session) {
  const votes = Object.values(session?.votes || {});
  const count = votes.length;
  const scores = votes.map((vote) => Number(vote.score || 0));
  const average = count ? scores.reduce((sum, score) => sum + score, 0) / count : 0;
  return { average, count, distribution: [], max: 1, maxScore: maxQuizScore(session), scores };
}

function remainingMs(session) {
  return Math.max(0, Number(session?.expiresAt || 0) - Date.now());
}

function isSessionClosed(session) {
  return Boolean(session?.expiresAt && remainingMs(session) <= 0);
}

function formatRemaining(session) {
  const totalSeconds = Math.ceil(remainingMs(session) / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function avatarById(id) {
  return avatars.find(([avatarId]) => avatarId === id) || avatars[0];
}

function personChip(person, extra = "") {
  const [, label, icon, color] = avatarById(person.avatar);
  return `
    <div class="person-chip ${extra}" style="--avatar-bg:${color}" title="${escapeHtml(label)}">
      <span class="person-avatar" aria-hidden="true">${icon}</span>
      <span class="person-name">${escapeHtml(person.name)}</span>
    </div>
  `;
}

function votedPeople(session) {
  return Object.entries(session.votes)
    .map(([userId, vote]) => ({ ...session.participants[userId], vote }))
    .filter((person) => person.id)
    .sort((a, b) => a.vote.at - b.vote.at);
}

function logo() {
  return `
    <div class="brand-mark" aria-label="Grupo EPM">
      <img class="epm-logo" src="./assets/logo-grupo-epm.png" alt="Grupo EPM" />
      <div>
        <strong>Retox</strong>
        <small>Vicepresidencia Experiencia Usuario Cliente</small>
      </div>
    </div>
  `;
}

function homeBrand() {
  return `
    <div class="home-brand">
      <img class="home-epm-logo" src="./assets/logo-grupo-epm.png" alt="Grupo EPM" />
      <p>Vicepresidencia Experiencia Usuario Cliente</p>
    </div>
  `;
}

function welcomeView() {
  return `
    <main class="shell welcome-shell">
      <section class="hero">
        <div class="topbar">
          <button class="icon-button" data-action="toggleDark" aria-label="Cambiar tema">◐</button>
        </div>
        <div class="hero-copy">
          ${homeBrand()}
          <h1>Retox</h1>
          <p>Opina, participa y ve resultados en tiempo real. Así funciona Retox.</p>
        </div>
        <div class="entry-grid">
          <form data-action="hostAccessForm" class="entry-card">
            <h2>Entrar como host</h2>
            <label for="host-password">Contraseña</label>
            <div class="inline-form">
              <input id="host-password" name="hostPassword" type="password" placeholder="Contraseña" autocomplete="current-password" />
              <button class="primary" type="submit">Entrar</button>
            </div>
          </form>
          <form data-action="joinForm" class="code-form">
            <h2>Entrar como invitado</h2>
            <label for="code">Entrar con codigo</label>
            <div class="inline-form">
              <input id="code" name="code" maxlength="4" placeholder="EPM1" autocomplete="off" />
              <button class="secondary" type="submit">Unirme</button>
            </div>
          </form>
        </div>
      </section>
      ${footer()}
    </main>
  `;
}

function hostSetupView() {
  return `
    <main class="admin-layout">
      ${roomHeader({ code: "Host" })}
      <section class="host-portal">
        <form class="panel setup-panel" data-action="createSessionForm">
          <p class="eyebrow">Crear sesion</p>
          <h1>Nueva encuesta</h1>
          <label for="session-type">Tipo de encuesta</label>
          <select id="session-type" name="type" data-action="sessionType">
            <option value="scale">Escala</option>
            <option value="quiz">Quiz</option>
          </select>
          <div class="scale-config">
          <label for="setup-question">Pregunta</label>
          <textarea id="setup-question" name="question" rows="3">${defaultQuestion}</textarea>
          </div>
          <div class="quiz-config" hidden>
            <div class="quiz-builder" id="quiz-builder">
              ${quizQuestionTemplate(0)}
            </div>
            <button class="secondary" type="button" data-action="addQuizQuestion">Agregar pregunta</button>
          </div>
          <label for="setup-duration">Tiempo maximo de vigencia en minutos</label>
          <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
          <button class="primary full" type="submit">Crear sesion</button>
        </form>
        ${adminHistoryPanel()}
      </section>
      ${footer()}
    </main>
  `;
}

function quizQuestionTemplate(index) {
  return `
    <div class="quiz-question" data-question-index="${index}">
      <label>Pregunta ${index + 1}</label>
      <input name="quizQuestion" placeholder="Texto de la pregunta" />
      <div class="quiz-options">
        ${[0, 1, 2].map((optionIndex) => quizOptionTemplate(index, optionIndex)).join("")}
      </div>
      <button class="secondary compact-button" type="button" data-action="addQuizOption">Agregar opcion</button>
    </div>
  `;
}

function quizOptionTemplate(questionIndex, optionIndex) {
  return `
    <div class="quiz-option">
      <input name="quizOption-${questionIndex}" placeholder="Opcion ${optionIndex + 1}" />
      <label class="check-row"><input type="checkbox" name="quizCorrect-${questionIndex}-${optionIndex}" /> Correcta</label>
      <input name="quizPoints-${questionIndex}-${optionIndex}" type="number" min="0" value="1" aria-label="Puntos" />
    </div>
  `;
}

function parseQuizForm(form) {
  return [...form.querySelectorAll(".quiz-question")].map((node, qIndex) => {
    const text = node.querySelector('[name="quizQuestion"]').value.trim();
    const options = [...node.querySelectorAll(".quiz-option")].map((optionNode, optionIndex) => ({
      text: optionNode.querySelector(`[name="quizOption-${qIndex}"]`)?.value.trim() || `Opcion ${optionIndex + 1}`,
      correct: Boolean(optionNode.querySelector(`[name="quizCorrect-${qIndex}-${optionIndex}"]`)?.checked),
      points: Number(optionNode.querySelector(`[name="quizPoints-${qIndex}-${optionIndex}"]`)?.value || 0)
    })).filter((option) => option.text);
    return { text: text || `Pregunta ${qIndex + 1}`, options };
  }).filter((question) => question.options.length);
}

function adminHistoryPanel() {
  const sessions = Object.values(loadSessions()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `
      <section class="panel admin-panel">
        <div class="admin-head">
          <div>
            <p class="eyebrow">Historial de encuestas</p>
            <h1>Resultados Retox</h1>
          </div>
        </div>
        ${
          sessions.length
            ? `<div class="admin-table">
                <div class="admin-row admin-row-head">
                  <span>Codigo</span>
                  <span>Pregunta</span>
                  <span>Votos</span>
                  <span>Promedio</span>
                  <span>Links</span>
                  <span>QR</span>
                  <span>Excel</span>
                </div>
                ${sessions.map((session) => adminSessionRow(session)).join("")}
              </div>`
            : `<p class="muted">Todavia no hay encuestas guardadas.</p>`
        }
      </section>
  `;
}

function adminView() {
  return hostSetupView();
}

function adminSessionRow(session) {
  const stats = computeStats(session);
  const links = sessionLinks(session.code);
  return `
    <div class="admin-row">
      <strong>${escapeHtml(session.code)}</strong>
      <span><b>${session.type === "quiz" ? "Quiz" : "Escala"}</b> · ${escapeHtml(session.question)}</span>
      <span>${stats.count}</span>
      <span>${stats.count ? stats.average.toFixed(1) : "--"}${session.type === "quiz" ? " pts" : ""}</span>
      <span class="admin-links">
        <a href="${links.host}" target="_blank" rel="noreferrer">Resultados</a>
        <a href="${links.participant}" target="_blank" rel="noreferrer">Participantes</a>
      </span>
      ${qrBlock(links.participant, "QR", 74)}
      <button class="secondary compact-button" data-export-code="${escapeHtml(session.code)}">Descargar</button>
    </div>
  `;
}

function enterAdmin(code) {
  if (String(code || "").trim() !== "Experiencia") {
    toast("Contraseña de host incorrecta.");
    return;
  }
  appState = { ...appState, view: "hostSetup", code: "", hostMode: true };
  history.replaceState(null, "", appBaseUrl());
  render();
}

function identifyView() {
  const selectedAvatar = appState.user?.avatar || avatars[0][0];
  return `
    <main class="shell">
      <section class="panel identity-panel">
        ${logo()}
        <p class="eyebrow">Sesion ${appState.code}</p>
        <h1>Elige tu identidad</h1>
        <form data-action="identityForm">
          <label for="name">Nombre visible</label>
          <input id="name" name="name" maxlength="24" placeholder="Tu nombre" value="${appState.user?.name || ""}" />
          <fieldset>
            <legend>Avatar</legend>
            <div class="avatar-grid">
              ${avatars
                .map(([id, label, icon, color]) => avatarOption(id, label, icon, color, id === selectedAvatar))
                .join("")}
            </div>
          </fieldset>
          <button class="primary full" type="submit">Entrar en 5 segundos</button>
        </form>
      </section>
      ${footer()}
    </main>
  `;
}

function avatarOption(id, label, icon, color, checked) {
  return `
    <label class="avatar-option" style="--avatar-bg:${color}">
      <input type="radio" name="avatar" value="${id}" ${checked ? "checked" : ""} />
      <span>${icon}</span>
      <small>${label}</small>
    </label>
  `;
}

function waitingView(session) {
  if (session.type === "quiz") return quizParticipantView(session);
  const stats = computeStats(session);
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const locked = closed || voted;
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="participant-strip">
        ${personChip(appState.user, "active-person")}
        <button class="icon-button edit-person" data-action="editIdentity" aria-label="Cambiar nombre o avatar" title="Cambiar nombre o avatar">✎</button>
      </section>
      <section class="panel question-panel">
        <p class="eyebrow">Ronda ${session.round}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${closed ? "Votacion cerrada" : `Tiempo restante ${formatRemaining(session)}`} · ${Object.keys(session.participants).length} participantes conectados</p>
      </section>
      <section class="vote-board">
        ${Array.from({ length: 10 }, (_, index) => {
          const value = index + 1;
          return `<button class="vote-tile ${voted && session.votes[appState.user.id].value === value ? "selected" : ""}" data-vote="${value}" ${locked ? "disabled" : ""}>${value}</button>`;
        }).join("")}
      </section>
      <section class="panel compact">
        <strong>${closed ? "La votacion ya no acepta respuestas" : voted ? "Tu voto quedo registrado" : "Selecciona un valor de 1 a 10"}</strong>
        <div class="mini-result">
          ${thermometer(stats.average)}
          ${histogram(stats)}
        </div>
      </section>
      ${footer()}
    </main>
  `;
}

function quizParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const vote = session.votes[appState.user?.id];
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="participant-strip">
        ${personChip(appState.user, "active-person")}
        <button class="icon-button edit-person" data-action="editIdentity" aria-label="Cambiar nombre o avatar" title="Cambiar nombre o avatar">✎</button>
      </section>
      <section class="panel question-panel">
        <p class="eyebrow">Quiz · ${closed ? "Cerrado" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${session.quiz?.questions?.length || 0} preguntas · puntaje maximo ${maxQuizScore(session)}</p>
      </section>
      ${
        voted
          ? `<section class="panel score-panel"><p class="eyebrow">Puntaje obtenido</p><h1>${vote.score}</h1><p>Sobre ${maxQuizScore(session)} puntos posibles</p></section>`
          : `<form class="panel quiz-answer-form" data-action="quizSubmitForm">
              ${(session.quiz?.questions || []).map((question, qIndex) => `
                <fieldset class="quiz-answer-question">
                  <legend>${escapeHtml(question.text)}</legend>
                  ${question.options.map((option, optionIndex) => `
                    <label class="answer-option">
                      <input type="checkbox" name="q-${qIndex}" value="${optionIndex}" ${closed ? "disabled" : ""} />
                      <span>${escapeHtml(option.text)}</span>
                    </label>
                  `).join("")}
                </fieldset>
              `).join("")}
              <button class="primary full" type="submit" ${closed ? "disabled" : ""}>Enviar quiz</button>
            </form>`
      }
      ${footer()}
    </main>
  `;
}

function hostView(session) {
  const stats = computeStats(session);
  const links = sessionLinks(session.code);
  return `
    <main class="host-layout">
      ${roomHeader(session)}
      <section class="host-main">
        <div class="results-row">
          ${liveResultsPanel(session)}
          ${resultsSidePanel(session)}
        </div>
      </section>
      <aside class="host-side">
        <section class="panel">
          <p class="eyebrow">Codigo de sala</p>
          <div class="room-code">${session.code}</div>
          <div class="share-row">
            <input class="share-link" readonly value="${links.participant}" aria-label="Link de invitacion" />
            <button class="secondary copy-button" data-copy-url="${links.participant}">Copiar URL</button>
          </div>
          ${qrBlock(links.participant)}
        </section>
        <section class="panel">
          <form data-action="questionForm">
            <label for="question">Pregunta activa</label>
            <textarea id="question" name="question" rows="3">${escapeHtml(session.question)}</textarea>
            <button class="secondary full" type="submit">Cambiar pregunta</button>
          </form>
          <div class="host-actions">
            <button data-action="resetVotes">Resetear votaciones</button>
            <button data-action="addDemoVotes">Demo votos</button>
            <button data-open-display="${links.display}">Abrir resultados</button>
            <button class="export-button" data-action="exportResults">Exportar Excel</button>
          </div>
        </section>
        <section class="panel">
          <h2>Historial</h2>
          <div class="history">
            ${
              session.history.length
                ? session.history
                    .map((item) => `<div><strong>${item.average.toFixed(1)}</strong><span>${item.count} votos</span><small>${escapeHtml(item.question)}</small></div>`)
                    .join("")
                : `<p class="muted">Cada reset guarda el promedio de la ronda.</p>`
            }
          </div>
        </section>
      </aside>
      ${footer()}
    </main>
  `;
}

function resultsSidePanel(session) {
  const stats = computeStats(session);
  if (session.type === "quiz") {
    return `
      <div class="panel results-side">
        <h2>Resultados quiz</h2>
        <div class="quiz-summary">
          <strong>${stats.count}</strong><span>participantes</span>
          <strong>${stats.average.toFixed(1)}</strong><span>promedio puntos</span>
          <strong>${stats.maxScore}</strong><span>puntos maximos</span>
        </div>
      </div>
    `;
  }
  return `
    <div class="panel results-side">
      <h2>Distribución respuestas</h2>
      ${histogram(stats)}
    </div>
  `;
}

function displayView(session) {
  return `
    <main class="display-layout">
      ${roomHeader(session)}
      <section class="display-results">
        <div class="results-row">
          ${liveResultsPanel(session)}
          ${resultsSidePanel(session)}
        </div>
      </section>
      ${footer()}
    </main>
  `;
}

function liveResultsPanel(session) {
  const stats = computeStats(session);
  const people = votedPeople(session).slice(-5);
  return `
    <div class="results-stage">
      <h2 class="live-question">${escapeHtml(session.question)}</h2>
      <div class="live-metrics">
        <div class="metric-card countdown ${isSessionClosed(session) ? "closed" : ""}">
          <span>${isSessionClosed(session) ? "Votacion cerrada" : "Tiempo restante"}</span>
          <strong>${formatRemaining(session)}</strong>
        </div>
        <div class="metric-card average-card">
          <div>
            <p class="eyebrow">${session.type === "quiz" ? "Promedio puntos" : "Promedio en vivo"}</p>
            <h1>${stats.count ? stats.average.toFixed(1) : "--"}</h1>
            <p>${stats.count} respuestas de ${Object.keys(session.participants).length} participantes</p>
          </div>
          ${session.type === "quiz" ? "" : thermometer(stats.average, true)}
        </div>
      </div>
      <div class="live-voters" aria-live="polite">
        ${
          people.length
            ? people.map((person) => personChip(person)).join("")
            : `<p class="waiting-votes">Aun no hay votos registrados</p>`
        }
      </div>
    </div>
  `;
}

function roomHeader(session) {
  return `
    <header class="room-header">
      ${logo()}
      <div class="room-meta">
        <span>${session.code}</span>
        <button class="home-button" data-action="home" aria-label="Inicio" title="Inicio">🏠</button>
      </div>
    </header>
  `;
}

function thermometer(value, large = false) {
  const percent = Math.max(0, Math.min(100, ((value || 0) - 1) / 9 * 100));
  return `
    <div class="thermo ${large ? "large" : ""}" style="--level:${percent}%">
      <div class="thermo-scale"><span>10</span><span>5</span><span>1</span></div>
      <div class="thermo-track"><div class="thermo-fill"></div></div>
      <div class="thermo-value">${value ? value.toFixed(1) : "--"}</div>
    </div>
  `;
}

function histogram(stats) {
  return `
    <div class="histogram">
      ${stats.distribution
        .map((count, index) => `<div class="bar-wrap"><strong>${count}</strong><span style="height:${(count / stats.max) * 100}%"></span><small>${index + 1}</small></div>`)
        .join("")}
    </div>
  `;
}

function footer() {
  return `<footer>Vicepresidencia Experiencia Usuario Cliente - Grupo EPM</footer>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("URL copiada.");
  } catch {
    const input = document.createElement("input");
    input.value = value;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    toast("URL copiada.");
  }
}

function render() {
  const root = document.querySelector("#app");
  document.body.classList.toggle("dark", appState.dark);
  const hashJoin = location.hash.match(/join=([A-Z0-9]{4})/i);
  const hashHost = location.hash.match(/host=([A-Z0-9]{4})/i);
  const hashDisplay = location.hash.match(/display=([A-Z0-9]{4})/i);
  if (hashDisplay && appState.view === "welcome") {
    const linkedCode = hashDisplay[1].toUpperCase();
    if (getSession(linkedCode)) {
      appState.code = linkedCode;
      appState.view = "display";
    } else {
      appState.code = linkedCode;
    }
  }
  if (hashHost && appState.view === "welcome") {
    const linkedCode = hashHost[1].toUpperCase();
    if (getSession(linkedCode)) {
      appState.code = linkedCode;
      appState.view = "host";
      appState.hostMode = true;
    } else {
      appState.code = linkedCode;
    }
  }
  if (hashJoin && appState.view === "welcome") {
    const linkedCode = hashJoin[1].toUpperCase();
    if (getSession(linkedCode)) {
      appState.code = linkedCode;
      appState.view = appState.user ? "waiting" : "identify";
      if (appState.user) addParticipant(linkedCode, appState.user);
    } else {
      appState.code = linkedCode;
    }
  }

  const session = appState.code ? getSession(appState.code) : null;
  if (!["welcome", "admin", "hostSetup"].includes(appState.view) && !session) appState.view = "welcome";

  root.innerHTML =
    appState.view === "welcome"
      ? welcomeView()
      : appState.view === "admin" || appState.view === "hostSetup"
        ? adminView()
        : appState.view === "identify"
          ? identifyView()
          : appState.view === "host"
            ? hostView(session)
            : appState.view === "display"
              ? displayView(session)
              : waitingView(session);

  if (hashJoin && appState.view === "welcome") {
    const input = document.querySelector("#code");
    if (input) input.value = appState.code;
  }
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const voteValue = event.target.closest("[data-vote]")?.dataset.vote;
  const exportCode = event.target.closest("[data-export-code]")?.dataset.exportCode;
  const copyUrl = event.target.closest("[data-copy-url]")?.dataset.copyUrl;
  const displayUrl = event.target.closest("[data-open-display]")?.dataset.openDisplay;
  if (voteValue) await vote(Number(voteValue));
  if (exportCode) exportSessionResults(getSession(exportCode));
  if (copyUrl) await copyToClipboard(copyUrl);
  if (displayUrl) window.open(displayUrl, "_blank", "noopener,noreferrer");
  if (action === "resetVotes") await resetVotes();
  if (action === "addDemoVotes") await addDemoVotes();
  if (action === "exportResults") exportResults();
  if (action === "editIdentity") {
    appState.view = "identify";
    render();
  }
  if (action === "home") {
    appState = { ...appState, view: "welcome", code: "", hostMode: false };
    history.replaceState(null, "", appBaseUrl());
    render();
  }
  if (action === "toggleDark") {
    appState.dark = !appState.dark;
    render();
  }
  if (action === "addQuizQuestion") {
    const builder = document.querySelector("#quiz-builder");
    builder.insertAdjacentHTML("beforeend", quizQuestionTemplate(builder.querySelectorAll(".quiz-question").length));
  }
  if (action === "addQuizOption") {
    const question = event.target.closest(".quiz-question");
    const qIndex = Number(question.dataset.questionIndex);
    const options = question.querySelector(".quiz-options");
    options.insertAdjacentHTML("beforeend", quizOptionTemplate(qIndex, options.querySelectorAll(".quiz-option").length));
  }
});

document.addEventListener("submit", async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  event.preventDefault();
  if (action === "joinForm") await joinSession(new FormData(event.target).get("code"));
  if (action === "adminForm") enterAdmin(new FormData(event.target).get("adminCode"));
  if (action === "identityForm") await submitIdentity(event);
  if (action === "questionForm") await updateQuestion(event);
  if (action === "hostAccessForm") enterAdmin(new FormData(event.target).get("hostPassword"));
  if (action === "createSessionForm") {
    const form = event.target;
    const type = new FormData(form).get("type");
    const questions = type === "quiz" ? parseQuizForm(form) : [];
    if (type === "quiz" && !questions.length) {
      toast("Agrega al menos una pregunta para el quiz.");
      return;
    }
    await createSession({
      type,
      question: type === "quiz" ? "Quiz" : new FormData(form).get("question"),
      questions,
      durationMinutes: new FormData(form).get("durationMinutes")
    });
  }
  if (action === "quizSubmitForm") await submitQuiz(event);
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.action === "sessionType") {
    const isQuiz = event.target.value === "quiz";
    document.querySelector(".quiz-config").hidden = !isQuiz;
    document.querySelector(".scale-config").hidden = isQuiz;
  }
});

window.addEventListener("retox:update", render);
broadcast?.addEventListener("message", () => {
  sessionCache = readLocalSessions();
  render();
});
window.addEventListener("storage", () => {
  sessionCache = readLocalSessions();
  render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function initApp() {
  await loadRemoteSessions();
  subscribeToRemoteSessions();
  render();
}

initApp();

setInterval(() => {
  const focused = document.activeElement;
  const isEditing = focused && ["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName);
  if (!isEditing && ["host", "waiting", "display"].includes(appState.view)) render();
}, 1000);
