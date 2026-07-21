const STORAGE_KEY = "retox.sessions.v1";
const DELETED_SESSIONS_KEY = "retox.deletedSessions.v1";
const ACTIVE_USER_KEY = "retox.activeUser.v1";
const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("retox-realtime") : null;
const SUPABASE_URL = "https://oixqthwwjvvspsuwfhme.supabase.co";
const SUPABASE_KEY = "sb_publishable_WaBBzhjih4wZiDGnnfprVw_zcp4Y63_";
const SUPABASE_TABLE = "retox_sessions";
const SUPABASE_PARTICIPANTS_TABLE = "retox_participants";
const SUPABASE_VOTES_TABLE = "retox_votes";
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY) || null;
let sessionCache = readLocalSessions();
let realtimeChannel = null;
let remoteReady = false;
let remotePollInFlight = false;
let remoteRefreshTimer = null;

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
const defaultQuestion = "Del 1 al 10, ¿cómo calificas esta experiencia?";
const DIGITAL_PROFILE_TYPE = "digitalprofile";
const FREE_TEXT_TYPE = "freetext";
const MULTIPLE_CHOICE_TYPE = "multiplechoice";
const digitalProfileSurvey = {
  title: "Perfil digital",
  questions: [
    {
      text: "Como recibes la factura de EPM?",
      options: [
        { id: "door", text: "En la puerta de mi casa", value: 11377 },
        { id: "email", text: "Por correo electrónico o whatsapp", value: 408 }
      ]
    },
    {
      text: "Como pagas la factura de EPM?",
      options: [
        { id: "portal", text: "Utilizas el portal de factura web de EPM", value: 0 },
        { id: "gana", text: "Vas a un gana, coofinep, cotrafa, etc.", value: 9228 },
        { id: "debit", text: "Tienes débito automático con tu entidad financiera", value: 2664 },
        { id: "bank", text: "Vas a la taquilla del banco", value: 5124 }
      ]
    },
    {
      text: "Cuando quieres comunicarte con EPM, ¿a través de qué medio lo haces?",
      options: [
        { id: "ema", text: "Le escribo a EMA", value: 5106 },
        { id: "office", text: "Acudo a una oficina", value: 600000 },
        { id: "web", text: "Acudo a la página web", value: 19860 },
        { id: "letter", text: "Radico una carta", value: 600000 },
        { id: "contact", text: "Llamo al contact center", value: 50304 }
      ]
    }
  ]
};
function defaultDigitalProfileSurvey() {
  return JSON.parse(JSON.stringify(digitalProfileSurvey));
}

let appState = {
  view: "welcome",
  code: "",
  user: loadActiveUser(),
  hostMode: false,
  dark: false,
  hostSection: "menu",
  surveyType: "scale",
  digitalProfileDraft: {},
  wordCloudDraft: {},
  freeTextDraft: {}
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function sessionCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function readLocalSessions() {
  try {
    return filterDeletedSessions(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
  } catch {
    return {};
  }
}

function readDeletedSessions() {
  try {
    return JSON.parse(localStorage.getItem(DELETED_SESSIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function markSessionDeleted(code) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized) return;
  localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify({
    ...readDeletedSessions(),
    [normalized]: Date.now()
  }));
}

function isSessionDeletedLocally(code) {
  return Boolean(readDeletedSessions()[String(code || "").toUpperCase()]);
}

function filterDeletedSessions(sessions) {
  const deleted = readDeletedSessions();
  return Object.fromEntries(Object.entries(sessions || {}).filter(([code]) => !deleted[String(code).toUpperCase()]));
}

function loadSessions() {
  return sessionCache;
}

function saveLocalSessions(sessions) {
  sessionCache = filterDeletedSessions(sessions);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  broadcast?.postMessage({ type: "sessions:update" });
  window.dispatchEvent(new Event("retox:update"));
}

function sessionConfig(session) {
  const { participants: _participants, votes: _votes, ...config } = session || {};
  return config;
}

function participantFromRow(row) {
  return {
    id: row.user_id,
    name: row.name,
    avatar: row.avatar,
    joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : Date.now()
  };
}

function voteFromRow(row) {
  return {
    value: row.value === null || row.value === undefined ? undefined : Number(row.value),
    answers: row.answers || undefined,
    score: row.score === null || row.score === undefined ? undefined : Number(row.score),
    at: row.voted_at ? new Date(row.voted_at).getTime() : Date.now(),
    round: row.round
  };
}

function hydrateSession(config, participantRows = [], voteRows = []) {
  if (!config) return null;
  const round = Number(config.round || 1);
  const legacyParticipants = config.participants || {};
  const legacyVotes = Object.fromEntries(
    Object.entries(config.votes || {}).filter(([, vote]) => Number(vote.round || round) === round)
  );
  const participants = {
    ...legacyParticipants,
    ...Object.fromEntries(participantRows.map((row) => [row.user_id, participantFromRow(row)]))
  };
  const votes = {
    ...legacyVotes,
    ...Object.fromEntries(
      voteRows
        .filter((row) => Number(row.round || 1) === round)
        .map((row) => [row.user_id, voteFromRow(row)])
    )
  };
  return { ...sessionConfig(config), participants, votes };
}

function saveSessionToCache(session) {
  if (!session?.code) return;
  if (isSessionDeletedLocally(session.code)) return;
  sessionCache = { ...sessionCache, [session.code]: session };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  broadcast?.postMessage({ type: "sessions:update" });
}

function scheduleBundleRefresh(code) {
  if (remoteRefreshTimer) return;
  remoteRefreshTimer = setTimeout(async () => {
    remoteRefreshTimer = null;
    if (appState.code) {
      await fetchSessionBundle(appState.code);
    } else {
      await loadRemoteSessions();
    }
    render();
  }, 450);
}

async function loadRemoteSessions() {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient.from(SUPABASE_TABLE).select("code,data");
  if (error) {
    console.warn("Supabase no esta listo, usando almacenamiento local:", error.message);
    return false;
  }
  const sessions = Object.fromEntries((data || []).map((row) => [row.code, hydrateSession(row.data)]));
  const codes = Object.keys(sessions);
  if (codes.length) {
    const [{ data: participants, error: participantsError }, { data: votes, error: votesError }] = await Promise.all([
      supabaseClient.from(SUPABASE_PARTICIPANTS_TABLE).select("*").in("session_code", codes),
      supabaseClient.from(SUPABASE_VOTES_TABLE).select("*").in("session_code", codes)
    ]);
    if (participantsError || votesError) {
      console.warn("Faltan tablas escalables de Retox, usando datos de sesión:", participantsError?.message || votesError?.message);
    } else {
      Object.keys(sessions).forEach((code) => {
        sessions[code] = hydrateSession(
          sessions[code],
          (participants || []).filter((row) => row.session_code === code),
          (votes || []).filter((row) => row.session_code === code)
        );
      });
    }
  }
  sessionCache = filterDeletedSessions(sessions);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  remoteReady = true;
  return true;
}

async function fetchRemoteSession(code) {
  return fetchSessionBundle(code);
}

async function fetchSessionConfig(code) {
  if (!supabaseClient) return null;
  const normalized = String(code || "").toUpperCase();
  if (isSessionDeletedLocally(normalized)) return null;
  const { data, error } = await supabaseClient.from(SUPABASE_TABLE).select("code,data").eq("code", normalized).maybeSingle();
  if (error) {
    console.warn("No pude consultar la sesión:", error.message);
    return null;
  }
  if (!data) return null;
  const current = getSession(data.code);
  const session = hydrateSession({
    ...data.data,
    participants: current?.participants || data.data.participants,
    votes: current?.votes || data.data.votes
  });
  saveSessionToCache(session);
  return session;
}

async function fetchSessionBundle(code) {
  if (!supabaseClient) return null;
  const normalized = String(code || "").toUpperCase();
  if (isSessionDeletedLocally(normalized)) return null;
  const { data, error } = await supabaseClient.from(SUPABASE_TABLE).select("code,data").eq("code", normalized).maybeSingle();
  if (error) {
    console.warn("No pude consultar Supabase:", error.message);
    return null;
  }
  if (!data) return null;
  const [{ data: participants, error: participantsError }, { data: votes, error: votesError }] = await Promise.all([
    supabaseClient.from(SUPABASE_PARTICIPANTS_TABLE).select("*").eq("session_code", data.code),
    supabaseClient.from(SUPABASE_VOTES_TABLE).select("*").eq("session_code", data.code)
  ]);
  if (participantsError || votesError) {
    console.warn("No pude consultar participantes/votos:", participantsError?.message || votesError?.message);
  }
  const session = hydrateSession(data.data, participants || [], votes || []);
  saveSessionToCache(session);
  return session;
}

async function persistSession(session) {
  if (isSessionDeletedLocally(session?.code)) return;
  const current = getSession(session.code);
  const cachedSession = hydrateSession({ ...session, participants: current?.participants, votes: current?.votes });
  const sessions = { ...sessionCache, [session.code]: cachedSession };
  sessionCache = sessions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  broadcast?.postMessage({ type: "sessions:update" });

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .upsert({ code: session.code, data: sessionConfig(session), updated_at: new Date().toISOString() }, { onConflict: "code" });
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

async function saveParticipant(code, user) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized || !user?.id) return;
  const current = getSession(normalized);
  const existing = current?.participants?.[user.id];
  const participant = { ...user, joinedAt: existing?.joinedAt || Date.now() };
  saveSessionToCache(hydrateSession({
    ...(current || { code: normalized, round: 1 }),
    participants: { ...(current?.participants || {}), [user.id]: participant },
    votes: current?.votes || {}
  }));

  if (!supabaseClient) {
    window.dispatchEvent(new Event("retox:update"));
    return;
  }
  const { error } = await supabaseClient
    .from(SUPABASE_PARTICIPANTS_TABLE)
    .upsert(
      {
        session_code: normalized,
        user_id: user.id,
        name: user.name,
        avatar: user.avatar,
        joined_at: existing?.joinedAt ? new Date(existing.joinedAt).toISOString() : new Date().toISOString()
      },
      { onConflict: "session_code,user_id" }
    );
  if (error) {
    console.warn("No pude guardar participante:", error.message);
    toast("No pude registrar el participante en Supabase.");
  }
  window.dispatchEvent(new Event("retox:update"));
}

async function saveScaleVote(code, user, value, round) {
  return saveVoteRow(code, user, { type: "scale", value, round });
}

async function saveQuizVote(code, user, answers, score, round) {
  return saveVoteRow(code, user, { type: "quiz", answers, score, round });
}

async function saveWordCloudVote(code, user, text, round) {
  return saveVoteRow(code, user, { type: "wordcloud", answers: { text, words: extractWords(text) }, round });
}

async function saveFreeTextVote(code, user, text, round) {
  return saveVoteRow(code, user, { type: FREE_TEXT_TYPE, answers: { text }, round });
}

async function saveMultipleChoiceVote(code, user, optionIndex, round) {
  return saveVoteRow(code, user, { type: MULTIPLE_CHOICE_TYPE, answers: { optionIndex }, round });
}

async function saveDigitalProfileVote(code, user, answers, score, round) {
  return saveVoteRow(code, user, { type: DIGITAL_PROFILE_TYPE, answers, score, round });
}

async function saveVoteRow(code, user, vote) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized || !user?.id) return false;
  const current = getSession(normalized);
  const round = Number(vote.round || current?.round || 1);
  if (current?.votes?.[user.id]) return false;
  await saveParticipant(normalized, user);
  const localVote = {
    value: vote.value,
    answers: vote.answers,
    score: vote.score,
    at: Date.now(),
    round
  };

  if (!supabaseClient) {
    saveSessionToCache(hydrateSession({
      ...(current || { code: normalized, round }),
      participants: { ...(current?.participants || {}), [user.id]: { ...user, joinedAt: current?.participants?.[user.id]?.joinedAt || Date.now() } },
      votes: { ...(current?.votes || {}), [user.id]: localVote }
    }));
    window.dispatchEvent(new Event("retox:update"));
    return true;
  }

  const { error } = await supabaseClient.from(SUPABASE_VOTES_TABLE).insert({
    session_code: normalized,
    user_id: user.id,
    round,
    type: vote.type,
    value: vote.value ?? null,
    answers: vote.answers || null,
    score: vote.score ?? null,
    voted_at: new Date().toISOString()
  });
  if (error) {
    if (error.code === "23505") return false;
    console.warn("No pude guardar voto:", error.message);
    toast("No pude registrar el voto en Supabase.");
    return false;
  }
  saveSessionToCache(hydrateSession({
    ...(current || { code: normalized, round }),
    participants: { ...(current?.participants || {}), [user.id]: { ...user, joinedAt: current?.participants?.[user.id]?.joinedAt || Date.now() } },
    votes: { ...(current?.votes || {}), [user.id]: localVote }
  }));
  window.dispatchEvent(new Event("retox:update"));
  return true;
}

async function deleteSession(code) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized) return;
  if (!confirm(`Eliminar definitivamente la encuesta ${normalized}?`)) return;
  markSessionDeleted(normalized);
  const { [normalized]: _removed, ...rest } = sessionCache;
  sessionCache = rest;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
  broadcast?.postMessage({ type: "sessions:update" });

  if (supabaseClient) {
    const { data, error } = await supabaseClient.from(SUPABASE_TABLE).delete().eq("code", normalized).select("code");
    if (error) {
      toast("No pude eliminar en Supabase. Revisa permisos delete.");
      console.warn("Error eliminando encuesta:", error.message);
      render();
      return;
    }
    if (!data?.length) {
      const stillThere = await supabaseClient.from(SUPABASE_TABLE).select("code").eq("code", normalized).maybeSingle();
      if (stillThere.data) {
        toast("La encuesta sigue en Supabase. Revisa permisos delete.");
        render();
        return;
      }
    }
    const verify = await supabaseClient.from(SUPABASE_TABLE).select("code").eq("code", normalized).maybeSingle();
    if (verify.data) {
      toast("La encuesta sigue en Supabase. No se elimino definitivamente.");
      render();
      return;
    } else {
      toast("Encuesta eliminada.");
    }
  } else {
    toast("Encuesta eliminada localmente.");
  }
  window.dispatchEvent(new Event("retox:update"));
  render();
}

function subscribeToRemoteSessions() {
  if (!supabaseClient || realtimeChannel) return;
  const refreshChangedSession = async (payload) => {
    const row = payload.new || payload.old;
    const code = row?.code || row?.session_code;
    if (!code) return;
    if (isSessionDeletedLocally(code)) return;
    if (payload.eventType === "DELETE" && row.code && !row.session_code) {
      const { [code]: _removed, ...rest } = sessionCache;
      sessionCache = rest;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionCache));
      render();
      return;
    }
    const isSessionRow = Boolean(row.code && !row.session_code);
    const shouldHydrateFull = ["host", "display", "hostSetup", "admin"].includes(appState.view);
    if (shouldHydrateFull && isSessionRow) {
      await fetchSessionBundle(code);
    } else if (shouldHydrateFull) {
      scheduleBundleRefresh(code);
      return;
    } else if (isSessionRow && code === appState.code) {
      await fetchSessionConfig(code);
    } else {
      return;
    }
    render();
  };
  realtimeChannel = supabaseClient
    .channel("retox-sessions")
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_TABLE }, refreshChangedSession)
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_PARTICIPANTS_TABLE }, refreshChangedSession)
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_VOTES_TABLE }, refreshChangedSession)
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
  const type = ["quiz", "wordcloud", FREE_TEXT_TYPE, DIGITAL_PROFILE_TYPE, MULTIPLE_CHOICE_TYPE].includes(options.type) ? options.type : "scale";
  const session = {
    code,
    createdAt: now,
    type,
    question: String(options.question || defaultQuestion).trim() || defaultQuestion,
    scaleMax: Math.max(2, Math.min(10, Number(options.scaleMax || 10))),
    quiz: type === "quiz" ? { questions: options.questions || [] } : null,
    digitalProfile: type === DIGITAL_PROFILE_TYPE ? { title: digitalProfileSurvey.title, questions: options.digitalProfileQuestions || defaultDigitalProfileSurvey().questions } : null,
    wordCloud: type === "wordcloud" ? { maxWords: 3 } : null,
    freeText: type === FREE_TEXT_TYPE ? { analysis: true } : null,
    multipleChoice: type === MULTIPLE_CHOICE_TYPE ? { options: options.multipleChoiceOptions || [] } : null,
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
    toast("Ingresa el código de la sesión.");
    return;
  }
  const session = getSession(normalized) || await fetchSessionConfig(normalized);
  if (!session) {
    toast("No encuentro esa sesión. Revisa el código.");
    return;
  }
  appState = { ...appState, code: normalized, view: appState.user ? "waiting" : "identify", hostMode: false };
  if (appState.user) await addParticipant(normalized, appState.user);
  render();
}

async function addParticipant(code, user) {
  await saveParticipant(code, user);
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
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("La votación ya está cerrada.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu voto ya quedó registrado.");
    render();
    return;
  }
  const saved = await saveScaleVote(appState.code, appState.user, value, current.round);
  toast(saved ? `Voto enviado: ${value}` : "Tu voto ya quedó registrado.");
  render();
}

async function submitQuiz(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
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
  const saved = await saveQuizVote(appState.code, appState.user, answers, score, current.round);
  toast(saved ? `Quiz enviado. Puntaje: ${score}` : "Tu quiz ya fue enviado.");
  render();
}

async function submitWordCloud(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("La nube ya está cerrada.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu respuesta ya fue enviada.");
    render();
    return;
  }
  const text = String(new FormData(event.target).get("wordcloudAnswer") || "").trim();
  if (!extractWords(text).length) {
    toast("Escribe una palabra o frase corta.");
    return;
  }
  const saved = await saveWordCloudVote(appState.code, appState.user, text, current.round);
  if (saved) clearWordCloudDraft(appState.code);
  toast(saved ? "Respuesta enviada." : "Tu respuesta ya fue enviada.");
  render();
}

async function submitFreeText(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("La encuesta ya esta cerrada.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu respuesta ya fue enviada.");
    render();
    return;
  }
  const text = String(new FormData(event.target).get("freeTextAnswer") || "").trim();
  if (text.length < 8) {
    toast("Escribe una respuesta un poco mas completa.");
    return;
  }
  const saved = await saveFreeTextVote(appState.code, appState.user, text, current.round);
  if (saved) clearFreeTextDraft(appState.code);
  toast(saved ? "Respuesta enviada." : "Tu respuesta ya fue enviada.");
  render();
}

async function submitDigitalProfile(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) {
    toast("La encuesta ya esta cerrada.");
    render();
    return;
  }
  if (current.votes?.[appState.user.id]) {
    toast("Tu perfil ya fue enviado.");
    render();
    return;
  }
  const form = new FormData(event.target);
  const answers = {};
  const survey = digitalProfileConfig(current);
  for (let qIndex = 0; qIndex < survey.questions.length; qIndex += 1) {
    const optionIndex = form.get(`dp-${qIndex}`);
    if (optionIndex === null) {
      toast("Responde las tres preguntas para conocer tu perfil.");
      return;
    }
    answers[qIndex] = Number(optionIndex);
  }
  const result = digitalProfileResult(current, answers);
  const saved = await saveDigitalProfileVote(appState.code, appState.user, { ...answers, estimatedValue: result.estimatedValue, profile: result.profile.key }, result.estimatedValue, current.round);
  if (saved) {
    const { [appState.code]: _sentDraft, ...rest } = appState.digitalProfileDraft || {};
    appState.digitalProfileDraft = rest;
    if (["digital", "very-digital"].includes(result.profile.key)) playDigitalProfileSound(result.profile.key);
  }
  toast(saved ? "Perfil enviado." : "Tu perfil ya fue enviado.");
  render();
}

async function submitMultipleChoice(event) {
  event.preventDefault();
  if (!appState.user) return;
  const current = await fetchSessionConfig(appState.code) || getSession(appState.code);
  if (isSessionClosed(current)) { toast("La encuesta ya está cerrada."); render(); return; }
  if (current.votes?.[appState.user.id]) { toast("Tu respuesta ya fue enviada."); render(); return; }
  const selected = new FormData(event.target).get("multipleChoiceAnswer");
  if (selected === null) { toast("Selecciona una opción."); return; }
  const optionIndex = Number(selected);
  if (!Number.isInteger(optionIndex) || !current.multipleChoice?.options?.[optionIndex]) return;
  const saved = await saveMultipleChoiceVote(appState.code, appState.user, optionIndex, current.round);
  toast(saved ? "Respuesta enviada." : "Tu respuesta ya fue enviada.");
  render();
}

async function resetVotes() {
  await upsertSession(appState.code, (session) => {
    const stats = computeStats(session);
    const history = stats.count
      ? [{ question: session.question, average: stats.average, count: stats.count, at: Date.now() }, ...session.history].slice(0, 8)
      : session.history;
    const now = Date.now();
    return { ...session, history, round: session.round + 1, expiresAt: now + (session.durationMinutes || 10) * 60 * 1000 };
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
  const session = await fetchSessionBundle(appState.code) || getSession(appState.code);
  if (!session) return;
  await Promise.all(sampleNames.map(async (name, index) => {
    const user = { id: `demo-${index}`, name, avatar: avatars[(index + 3) % avatars.length][0] };
    await saveParticipant(appState.code, user);
    if (!session.votes?.[user.id]) {
      if (session.type === "wordcloud") {
        const samples = ["experiencia digital", "servicio cercano", "social media", "innovación cliente", "confianza", "rapidez"];
        await saveWordCloudVote(appState.code, user, samples[index % samples.length], session.round);
      } else if (session.type === FREE_TEXT_TYPE) {
        const samples = [
          "La experiencia fue clara y cercana, pero seria bueno tener mas acompanamiento al inicio.",
          "Me gustó la dinámica porque permite expresar ideas y escuchar a otros participantes.",
          "El punto mas importante es mejorar la velocidad de respuesta y dar instrucciones mas simples.",
          "La actividad ayuda a identificar oportunidades, especialmente en comunicacion y seguimiento.",
          "Seria valioso cerrar con compromisos concretos para que las ideas no se pierdan.",
          "Destaco la participación del grupo y la posibilidad de compartir opiniones sin complicaciones."
        ];
        await saveFreeTextVote(appState.code, user, samples[index % samples.length], session.round);
      } else if (session.type === DIGITAL_PROFILE_TYPE) {
        const samples = [
          { 0: 0, 1: 2, 2: 1 },
          { 0: 1, 1: 0, 2: 2 },
          { 0: 0, 1: 1, 2: 3 },
          { 0: 1, 1: 0, 2: 3 },
          { 0: 0, 1: 2, 2: 1 },
          { 0: 1, 1: 1, 2: 0 },
          { 0: 0, 1: 2, 2: 3 },
          { 0: 1, 1: 0, 2: 2 }
        ];
        const answers = samples[index % samples.length];
        const result = digitalProfileResult(session, answers);
        await saveDigitalProfileVote(appState.code, user, { ...answers, estimatedValue: result.estimatedValue, profile: result.profile.key }, result.estimatedValue, session.round);
      } else if (session.type === MULTIPLE_CHOICE_TYPE) {
        await saveMultipleChoiceVote(appState.code, user, index % (session.multipleChoice?.options?.length || 1), session.round);
      } else {
        await saveScaleVote(appState.code, user, Math.ceil(Math.random() * Number(session.scaleMax || 10)), session.round);
      }
    }
  }));
  await fetchSessionBundle(appState.code);
  render();
}

function appBaseUrl() {
  return location.href.split("#")[0];
}

function sessionLinks(code) {
  const base = appBaseUrl();
  return {
    host: `${base}#host=${code}`,
    participant: `${base}#join=${code}`,
    display: `${base}#display=${code}`,
    invite: `${base}#invite=${code}`
  };
}

function qrUrl(value, size = 180) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

function qrBlock(url, label = "QR participantes", size = 180, openUrl = qrUrl(url, 320)) {
  return `
    <div class="qr-block">
      <p class="eyebrow">${label}</p>
      <a href="${openUrl}" target="_blank" rel="noreferrer" aria-label="Abrir QR">
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
    const digitalResult = session.type === DIGITAL_PROFILE_TYPE && vote?.answers ? digitalProfileResult(session, vote.answers) : null;
    return [
      participant.name,
      avatar[1],
      session.type === "quiz" ? vote?.score ?? "" : session.type === DIGITAL_PROFILE_TYPE ? digitalResult?.estimatedValue ?? "" : session.type === MULTIPLE_CHOICE_TYPE ? session.multipleChoice?.options?.[Number(vote?.answers?.optionIndex)] ?? "" : vote?.value ?? "",
      session.type === "wordcloud" || session.type === FREE_TEXT_TYPE ? vote?.answers?.text ?? "" : "",
      digitalResult?.profile.label || "",
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
        ["Tipo", surveyTypeLabel(session.type)],
        ["Pregunta", session.question],
        [session.type === "quiz" ? "Promedio puntos" : session.type === "wordcloud" || session.type === FREE_TEXT_TYPE || session.type === MULTIPLE_CHOICE_TYPE ? "Respuestas" : session.type === DIGITAL_PROFILE_TYPE ? "Valor promedio" : "Promedio", session.type === MULTIPLE_CHOICE_TYPE ? stats.count : stats.count ? stats.average.toFixed(2) : ""],
        ["Participantes", participants.length],
        ["Respuestas", stats.count],
        ...(session.type === "quiz" ? [["Puntaje máximo", stats.maxScore]] : []),
        [],
        ["Nombre", "Avatar", session.type === "quiz" ? "Puntaje" : session.type === DIGITAL_PROFILE_TYPE ? "Valor estimado" : session.type === MULTIPLE_CHOICE_TYPE ? "Opción elegida" : "Voto", session.type === FREE_TEXT_TYPE ? "Texto libre" : "Texto nube", "Perfil digital", "Fecha respuesta", "Pregunta", "Código sesión", "Ronda"],
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
    }] : session.type === "wordcloud" ? [{
      name: "Nube",
      rows: [["Palabra", "Cantidad"], ...(stats.words || []).map((word) => [word.text, word.count])]
    }] : session.type === FREE_TEXT_TYPE ? [{
      name: "Análisis textos",
      rows: [
        ["Resumen", stats.summary || ""],
        ["Respuestas", stats.count],
        [],
        ["Análisis"],
        ...(stats.analysis || []).map((item) => [item]),
        [],
        ["Tema representativo", "Respuestas asociadas", "Lectura"],
        ...(stats.themes || []).map((theme) => [theme.label, theme.count, theme.detail]),
        [],
        ["Acciones sugeridas"],
        ...(stats.recommendations || []).map((item) => [item])
      ]
    }] : session.type === MULTIPLE_CHOICE_TYPE ? [{
      name: "Opciones",
      rows: [["Opción", "Cantidad", "Porcentaje"], ...stats.options.map((option, index) => [option, stats.distribution[index], stats.count ? `${Math.round(stats.distribution[index] / stats.count * 100)}%` : "0%"]), [], ["Resumen", stats.summary]]
    }] : session.type === DIGITAL_PROFILE_TYPE ? [{
      name: "Perfil digital",
      rows: [
        ["Pregunta", "Opcion", "Respuestas"],
        ...digitalProfileOptionRows(stats)
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

function surveyTypeLabel(type) {
  if (type === "quiz") return "Quiz";
  if (type === "wordcloud") return "Nube de palabras";
  if (type === FREE_TEXT_TYPE) return "Texto libre";
  if (type === DIGITAL_PROFILE_TYPE) return "Perfil digital";
  if (type === MULTIPLE_CHOICE_TYPE) return "Opción múltiple";
  return "Escala";
}

function formatCop(value) {
  return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
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
  if (session?.type === MULTIPLE_CHOICE_TYPE) return computeMultipleChoiceStats(session);
  if (session?.type === FREE_TEXT_TYPE) return computeFreeTextStats(session);
  if (session?.type === "wordcloud") return computeWordCloudStats(session);
  if (session?.type === "quiz") return computeQuizStats(session);
  if (session?.type === DIGITAL_PROFILE_TYPE) return computeDigitalProfileStats(session);
  const values = Object.values(session?.votes || {}).map((vote) => Number(vote.value));
  const count = values.length;
  const average = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
  const scaleMax = Number(session?.scaleMax || 10);
  const distribution = Array.from({ length: scaleMax }, (_, index) => values.filter((value) => value === index + 1).length);
  return { average, count, distribution, max: Math.max(1, ...distribution) };
}

function computeMultipleChoiceStats(session) {
  const options = session?.multipleChoice?.options || [];
  const votes = Object.values(session?.votes || {});
  const distribution = options.map((_, optionIndex) => votes.filter((vote) => Number(vote.answers?.optionIndex) === optionIndex).length);
  const count = votes.length;
  const maxCount = Math.max(0, ...distribution);
  const leaders = options.filter((_, index) => distribution[index] === maxCount && maxCount > 0);
  let summary = "Aún no hay respuestas para resumir.";
  if (leaders.length === 1) {
    const index = options.indexOf(leaders[0]);
    const percent = Math.round((distribution[index] / count) * 100);
    summary = `La opción más seleccionada es “${leaders[0]}”, con ${distribution[index]} ${distribution[index] === 1 ? "respuesta" : "respuestas"} (${percent}%).`;
  } else if (leaders.length > 1) {
    summary = `Hay un empate entre ${leaders.map((option) => `“${option}”`).join(", ")}, con ${maxCount} respuestas cada una.`;
  }
  return { average: count, count, distribution, max: Math.max(1, maxCount), options, summary };
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

function extractWords(text, limit = 8) {
  const stopWords = new Set([
    "a", "al", "algo", "ante", "asi", "como", "con", "contra", "cual", "cuando", "de", "del", "desde", "donde",
    "e", "el", "ella", "ellas", "ellos", "en", "entre", "era", "eres", "es", "esa", "esas", "ese", "eso", "esos",
    "esta", "estas", "este", "esto", "estos", "fue", "ha", "hay", "la", "las", "lo", "los", "mas", "me", "mi",
    "mis", "muy", "ni", "no", "nos", "o", "otra", "otro", "para", "pero", "por", "porque", "que", "se", "ser",
    "si", "sin", "son", "su", "sus", "te", "tiene", "tu", "tus", "un", "una", "unas", "uno", "unos", "y", "ya",
    "ademas", "agregado", "aporta", "aportan", "aporte", "aportes", "comentario", "tema", "temas", "cosa", "cosas"
  ]);
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u00f1\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, limit);
}

function computeWordCloudStats(session) {
  const votes = Object.values(session?.votes || {});
  const counts = new Map();
  votes.forEach((vote) => {
    const words = vote.answers?.words?.length ? vote.answers.words : extractWords(vote.answers?.text || "");
    words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  });
  const words = [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 34);
  return { average: votes.length, count: votes.length, distribution: [], max: Math.max(1, ...words.map((word) => word.count)), words };
}

function computeFreeTextStats(session) {
  const responses = Object.values(session?.votes || {})
    .map((vote) => String(vote.answers?.text || "").trim())
    .filter(Boolean);
  const { themes, coveredCount } = freeTextThemes(responses);
  return {
    average: responses.length,
    count: responses.length,
    distribution: [],
    max: Math.max(1, ...themes.map((theme) => theme.count)),
    responses,
    keywords: themes.map((theme) => ({ text: theme.label, count: theme.count })),
    themes,
    coveredCount,
    summary: freeTextSummary(responses, themes, coveredCount),
    analysis: freeTextAnalysis(responses, themes, coveredCount),
    recommendations: freeTextRecommendations(themes)
  };
}

function freeTextThemes(responses) {
  const categories = [
    {
      key: "commercial",
      label: "Ampliación del foco comercial",
      detail: "Las respuestas apuntan a fortalecer la mirada comercial, ampliar oportunidades y conectar mejor la propuesta con necesidades del negocio.",
      keywords: ["comercial", "mercado", "cliente", "clientes", "venta", "ventas", "negocio", "oferta", "foco", "ampliar", "oportunidad", "oportunidades"]
    },
    {
      key: "capabilities",
      label: "Validación de capacidades y dimensionamiento",
      detail: "Se identifica la necesidad de revisar capacidades, alcance, recursos y dimensionamiento antes de avanzar.",
      keywords: ["capacidad", "capacidades", "dimensionamiento", "dimensionar", "alcance", "recursos", "recurso", "equipo", "validar", "viabilidad", "carga"]
    },
    {
      key: "experience",
      label: "Experiencia y valor para el grupo",
      detail: "Los aportes resaltan el valor de la experiencia, el aprendizaje colectivo y la contribución al grupo.",
      keywords: ["experiencia", "grupo", "aporte", "aportes", "valor", "valioso", "aprendizaje", "participacion", "dinamica", "ejercicio"]
    },
    {
      key: "clarity",
      label: "Claridad y alineación",
      detail: "Aparece la necesidad de alinear expectativas, precisar mensajes y dejar más claro el camino de trabajo.",
      keywords: ["claro", "clara", "claridad", "alinear", "alineacion", "mensaje", "mensajes", "instrucciones", "entender", "explicar"]
    },
    {
      key: "followup",
      label: "Seguimiento y compromisos",
      detail: "Las respuestas sugieren cerrar con compromisos, responsables y continuidad para que las ideas se traduzcan en acción.",
      keywords: ["seguimiento", "compromiso", "compromisos", "responsable", "responsables", "accion", "acciones", "continuidad", "cerrar", "implementar"]
    },
    {
      key: "improvement",
      label: "Oportunidades de mejora",
      detail: "Se observan oportunidades para ajustar el proceso, mejorar la ejecución y fortalecer el resultado esperado.",
      keywords: ["mejorar", "mejora", "oportunidad", "oportunidades", "ajustar", "fortalecer", "trabajar", "profundizar", "desarrollar"]
    }
  ];

  const matchedByResponse = responses.map((text) => {
    const words = new Set(extractWords(text, 160));
    return categories
      .filter((category) => category.keywords.some((keyword) => words.has(keyword)))
      .map((category) => category.key);
  });

  const scored = categories.map((category) => ({
    ...category,
    count: matchedByResponse.filter((keys) => keys.includes(category.key)).length
  }));
  const coveredCount = matchedByResponse.filter((keys) => keys.length).length;
  const uncoveredCount = Math.max(0, responses.length - coveredCount);
  const detected = scored
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count || b.label.length - a.label.length)
    .slice(0, 4);

  if (uncoveredCount) {
    detected.push({
      key: "complementary",
      label: "Aportes complementarios",
      count: uncoveredCount,
      detail: "También se registran aportes adicionales que no se agrupan en una categoría dominante, pero enriquecen la lectura cualitativa."
    });
  }

  if (detected.length) return { themes: detected, coveredCount };
  if (!responses.length) return { themes: [], coveredCount: 0 };
  return {
    coveredCount: 0,
    themes: [{
      key: "general",
      label: "Insumos cualitativos generales",
      count: responses.length,
      detail: "Las respuestas entregan percepciones útiles, pero aún no forman una tendencia temática clara."
    }]
  };
}

function freeTextSummary(responses, themes, coveredCount = 0) {
  if (!responses.length) return "Aún no hay respuestas. Cuando empiecen a llegar, aquí aparecerá un resumen automático de los temas principales.";
  if (!themes.length) return `Hay ${responses.length} respuestas registradas, pero todavía no hay un patrón repetido claro. Conviene leerlas como insumos exploratorios y esperar más participación.`;
  const themeText = themes.slice(0, 3).map((theme) => theme.label.toLowerCase()).join(", ");
  const coverage = coveredCount && coveredCount < responses.length ? ` Además, ${responses.length - coveredCount} respuesta(s) agregan matices complementarios.` : "";
  return `A partir de ${responses.length} respuestas, la lectura ejecutiva se concentra en ${themeText}.${coverage}`;
}

function freeTextAnalysis(responses, themes, coveredCount = 0) {
  if (!responses.length) return ["El análisis aparecerá cuando lleguen las primeras respuestas."];
  if (!themes.length) return ["Las respuestas son variadas y aún no forman una tendencia dominante.", "Se recomienda esperar más participación antes de sacar conclusiones."];
  const coverageLine = coveredCount < responses.length
    ? `El análisis incorpora ${responses.length} respuestas: ${coveredCount} se agrupan en temas principales y ${responses.length - coveredCount} aportan elementos complementarios.`
    : `El análisis incorpora las ${responses.length} respuestas recibidas.`;
  return [coverageLine, ...themes.slice(0, 3).map((theme) => `${theme.label}: ${theme.detail}`)];
}

function freeTextRecommendations(themes) {
  if (!themes.length) return ["Recoger más respuestas para identificar patrones con mayor confianza."];
  const mainThemes = themes.filter((theme) => theme.key !== "complementary");
  const first = mainThemes[0] || themes[0];
  const second = mainThemes[1];
  return [
    `Profundizar en ${first.label.toLowerCase()} con una pregunta de seguimiento.`,
    second ? `Validar si ${first.label.toLowerCase()} y ${second.label.toLowerCase()} requieren una acción conjunta.` : "Identificar responsables y alcance para el tema principal.",
    "Cerrar la conversación con compromisos concretos y responsables visibles."
  ];
}
function capitalize(text) {
  const value = String(text || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function shortText(text, maxLength = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}...` : clean;
}

function digitalProfileConfig(session) {
  const config = session?.digitalProfile?.questions?.length ? session.digitalProfile : defaultDigitalProfileSurvey();
  return { title: config.title || digitalProfileSurvey.title, questions: config.questions || [] };
}

function digitalProfileResult(session, answers = {}) {
  const survey = digitalProfileConfig(session);
  const rawScore = survey.questions.reduce((total, question, qIndex) => {
    const option = question.options[Number(answers[qIndex])];
    return total + Number(option?.value || 0);
  }, 0);
  const estimatedValue = rawScore;
  const profile = digitalProfileForScore(rawScore);
  return { rawScore, estimatedValue, profile };
}

function digitalProfileForScore(score) {
  const value = Number(score || 0);
  if (value <= 10000) return { key: "very-digital", label: "Muy digital", tone: "Estás haciendo una gran gestión" };
  if (value <= 35000) return { key: "digital", label: "Digital", tone: "Vas muy bien" };
  if (value <= 120000) return { key: "hybrid", label: "Híbrido", tone: "Tienes una gran oportunidad" };
  return { key: "traditional", label: "Tradicional", tone: "Puedes dar un gran paso" };
}

function computeDigitalProfileStats(session) {
  const survey = digitalProfileConfig(session);
  const votes = Object.values(session?.votes || {});
  const optionCounts = survey.questions.map((question) => question.options.map(() => 0));
  const profileCounts = { traditional: 0, hybrid: 0, digital: 0, "very-digital": 0 };
  const estimatedValues = votes.map((vote) => {
    const result = digitalProfileResult(session, vote.answers || {});
    Object.keys(vote.answers || {}).forEach((key) => {
      if (!/^\d+$/.test(key)) return;
      const qIndex = Number(key);
      const optionIndex = Number(vote.answers[key]);
      if (optionCounts[qIndex]?.[optionIndex] !== undefined) optionCounts[qIndex][optionIndex] += 1;
    });
    profileCounts[result.profile.key] = (profileCounts[result.profile.key] || 0) + 1;
    return result.estimatedValue;
  });
  const count = votes.length;
  const average = count ? estimatedValues.reduce((sum, value) => sum + value, 0) / count : 0;
  return { average, count, distribution: [], max: 1, optionCounts, profileCounts, estimatedValues, survey };
}

function digitalProfileOptionRows(stats) {
  const survey = stats.survey || defaultDigitalProfileSurvey();
  return survey.questions.flatMap((question, qIndex) =>
    question.options.map((option, optionIndex) => [question.text, option.text, stats.optionCounts?.[qIndex]?.[optionIndex] || 0])
  );
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

function personChip(person, extra = "", action = "", detail = "") {
  if (!person) return "";
  const [, label, icon, color] = avatarById(person.avatar);
  const tag = action ? "button" : "div";
  const actionAttrs = action ? ` type="button" data-action="${action}" aria-label="Cambiar nombre o avatar"` : "";
  return `
    <${tag} class="person-chip ${extra}" style="--avatar-bg:${color}" title="${escapeHtml(person.name)} · ${escapeHtml(label)}"${actionAttrs}>
      <span class="person-avatar" aria-hidden="true">${icon}</span>
      <span class="person-text">
        <span class="person-name">${escapeHtml(person.name)}</span>
        ${detail ? `<small class="person-detail">${escapeHtml(detail)}</small>` : ""}
      </span>
    </${tag}>
  `;
}

function votedPeople(session) {
  return Object.entries(session.votes)
    .map(([userId, vote]) => ({ id: userId, name: "Participante", avatar: avatars[0][0], ...(session.participants[userId] || {}), vote }))
    .filter((person) => person.id)
    .sort((a, b) => a.vote.at - b.vote.at);
}

function digitalProfilePersonChip(session, person) {
  const result = digitalProfileResult(session, person.vote?.answers || {});
  return personChip(person, "digital-person-chip", "", result.profile.label);
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
            <label for="code">Entrar con código</label>
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
  if (appState.hostSection === "menu") return hostMenuView();
  if (appState.hostSection === "history") {
    return `
      <main class="admin-layout">
        ${roomHeader({ code: "Host" })}
        ${adminHistoryPanel()}
        ${footer()}
      </main>
    `;
  }
  if (appState.hostSection === "typeChoice") return surveyTypeChoiceView();
  return `
    <main class="admin-layout">
      ${roomHeader({ code: "Host" })}
      <section class="host-portal">
        <form class="panel setup-panel" data-action="createSessionForm">
          <p class="eyebrow">Crear sesión</p>
          <h1>${appState.surveyType === "quiz" ? "Nuevo quiz" : appState.surveyType === "wordcloud" ? "Nueva nube de palabras" : appState.surveyType === FREE_TEXT_TYPE ? "Nuevo texto libre" : appState.surveyType === DIGITAL_PROFILE_TYPE ? "Nuevo Perfil digital" : appState.surveyType === MULTIPLE_CHOICE_TYPE ? "Nueva encuesta de opción múltiple" : "Nueva escala"}</h1>
          <input type="hidden" name="type" value="${appState.surveyType}" />
          ${
            appState.surveyType === "quiz"
              ? `<div class="quiz-config">
                  <div class="quiz-builder" id="quiz-builder">
                    ${quizQuestionTemplate(0)}
                  </div>
                  <label for="setup-duration">Tiempo máximo de vigencia en minutos</label>
                  <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                </div>`
              : appState.surveyType === "wordcloud"
                ? `<div class="scale-config">
                    <label for="setup-question">Pregunta</label>
                    <textarea id="setup-question" name="question" rows="3">Escribe una palabra o frase corta que represente esta experiencia</textarea>
                    <label for="setup-duration">Tiempo máximo de vigencia en minutos</label>
                    <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                  </div>`
                : appState.surveyType === FREE_TEXT_TYPE
                  ? `<div class="scale-config">
                    <label for="setup-question">Pregunta</label>
                    <textarea id="setup-question" name="question" rows="3">Comparte tu opinión sobre esta experiencia</textarea>
                    <label for="setup-duration">Tiempo máximo de vigencia en minutos</label>
                    <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                  </div>`
                : appState.surveyType === MULTIPLE_CHOICE_TYPE
                  ? `<div class="scale-config multiple-choice-config">
                    <label for="setup-question">Pregunta</label>
                    <textarea id="setup-question" name="question" rows="3" required>¿Cuál opción prefieres?</textarea>
                    <label for="multiple-choice-options">Opciones de respuesta</label>
                    <textarea id="multiple-choice-options" name="multipleChoiceOptions" rows="7" required placeholder="Una opción por línea">Opción 1\nOpción 2\nOpción 3</textarea>
                    <small class="muted">Escribe una opción por línea (mínimo 2).</small>
                    <label for="setup-duration">Tiempo máximo de vigencia en minutos</label>
                    <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                  </div>`
                : appState.surveyType === DIGITAL_PROFILE_TYPE
                  ? `<div class="digital-profile-config">
                    <p class="muted">Edita las preguntas, respuestas y valores internos. Los valores no se muestran a los participantes.</p>
                    <div class="digital-profile-builder" id="digital-profile-builder">
                      ${defaultDigitalProfileSurvey().questions.map((question, index) => digitalProfileQuestionTemplate(index, question)).join("")}
                    </div>
                    <button class="secondary compact-button" type="button" data-action="addDigitalProfileQuestion">Agregar pregunta</button>
                    <label for="setup-duration">Tiempo máximo de vigencia en minutos</label>
                    <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                  </div>`
                  : `<div class="scale-config">
                  <label for="setup-question">Pregunta</label>
                  <textarea id="setup-question" name="question" rows="3">${defaultQuestion}</textarea>
                  <div class="setup-inline-fields">
                    <label class="field" for="setup-scale-max">
                      <span>Número máximo de escala</span>
                      <input id="setup-scale-max" name="scaleMax" type="number" min="2" max="10" value="10" />
                    </label>
                    <label class="field" for="setup-duration">
                      <span>Tiempo máximo de vigencia en minutos</span>
                      <input id="setup-duration" name="durationMinutes" type="number" min="1" max="240" value="10" />
                    </label>
                  </div>
                </div>`
          }
          <button class="primary full create-session-button" type="submit">Crear sesión</button>
        </form>
      </section>
      ${footer()}
    </main>
  `;
}

function hostMenuView() {
  return `
    <main class="admin-layout">
      ${roomHeader({ code: "Host" })}
      <section class="host-menu host-main-menu">
        ${hostActionCard("create", "Crear encuesta", "Configura escala, quiz, nube, texto libre o perfil digital para compartir en vivo.", "chart")}
        ${hostActionCard("history", "Historial", "Consulta resultados, QR, enlaces, Excel y elimina encuestas.", "archive")}
      </section>
      ${footer()}
    </main>
  `;
}

function surveyTypeChoiceView() {
  return `
    <main class="admin-layout">
      ${roomHeader({ code: "Host" })}
      <section class="host-menu host-type-menu">
        ${hostActionCard("scale", "Escala", "Votación numérica del 1 al 10 con promedio y distribución.", "scale")}
        ${hostActionCard("quiz", "Quiz", "Preguntas con respuestas correctas, puntos y puntaje final.", "quiz")}
        ${hostActionCard("wordcloud", "Nube de palabras", "Respuestas abiertas que forman una figura según frecuencia.", "wordcloud")}
        ${hostActionCard(FREE_TEXT_TYPE, "Texto libre", "Preguntas abiertas con resumen y análisis de respuestas.", "text")}
        ${hostActionCard(MULTIPLE_CHOICE_TYPE, "Opción múltiple", "Una pregunta con respuestas predeterminadas, conteos y resumen sin puntaje.", "choice")}
        ${hostActionCard(DIGITAL_PROFILE_TYPE, "Perfil digital", "Clasifica canales tradicionales, híbridos, digitales y muy digitales.", "digitalprofile")}
      </section>
      ${footer()}
    </main>
  `;
}

function hostActionCard(action, title, text, icon) {
  return `
    <button class="host-card" data-host-card="${action}">
      <span class="host-card-art ${icon}" aria-hidden="true">
        ${hostCardSvg(icon)}
      </span>
      <strong>${title}</strong>
      <small>${text}</small>
    </button>
  `;
}

function hostCardSvg(icon) {
  if (icon === "archive") {
    return `<svg viewBox="0 0 120 120"><rect x="22" y="30" width="76" height="62" rx="10"/><path d="M30 46h60M43 64h34M43 78h24"/></svg>`;
  }
  if (icon === "quiz") {
    return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="38"/><path d="M49 48c2-10 21-11 24 0 4 14-13 14-13 25M60 88h.5"/></svg>`;
  }
  if (icon === "scale") {
    return `<svg viewBox="0 0 120 120"><path d="M24 84h72"/><path d="M32 74l15-20 18 11 24-30"/><circle cx="47" cy="54" r="6"/><circle cx="65" cy="65" r="6"/><circle cx="89" cy="35" r="6"/></svg>`;
  }
  if (icon === "wordcloud") {
    return `<svg viewBox="0 0 120 120"><path d="M38 78h50a18 18 0 0 0 2-36 25 25 0 0 0-48-8 22 22 0 0 0-4 44Z"/><path d="M39 56h42M49 68h28M54 44h18"/></svg>`;
  }
  if (icon === "text") {
    return `<svg viewBox="0 0 120 120"><rect x="24" y="24" width="72" height="72" rx="12"/><path d="M40 45h40M40 60h33M40 75h24"/><path d="M76 76l8 8 14-22"/></svg>`;
  }
  if (icon === "digitalprofile") {
    return `<svg viewBox="0 0 120 120"><rect x="24" y="24" width="72" height="72" rx="16"/><path d="M42 76h36M42 60h20M60 44h18"/><circle cx="42" cy="44" r="5"/><path d="M80 72l10 10 18-24"/></svg>`;
  }
  if (icon === "choice") {
    return `<svg viewBox="0 0 120 120"><rect x="25" y="28" width="18" height="18" rx="5"/><path d="m30 37 5 5 10-14M54 37h40"/><rect x="25" y="54" width="18" height="18" rx="5"/><path d="M54 63h40"/><rect x="25" y="80" width="18" height="18" rx="5"/><path d="M54 89h40"/></svg>`;
  }
  return `<svg viewBox="0 0 120 120"><rect x="24" y="28" width="72" height="58" rx="12"/><path d="M40 68h12M58 68h12M76 68h12M40 50h12M58 50h12M76 50h12"/></svg>`;
}

function quizQuestionTemplate(index) {
  return `
    <div class="quiz-question" data-question-index="${index}">
      <label>Pregunta ${index + 1}</label>
      <input name="quizQuestion" placeholder="Texto de la pregunta" />
      <div class="quiz-option-head" aria-hidden="true">
        <span>Respuestas</span>
        <span>Puntajes</span>
      </div>
      <div class="quiz-options">
        ${[0, 1, 2].map((optionIndex) => quizOptionTemplate(index, optionIndex)).join("")}
      </div>
      <div class="quiz-actions">
        <button class="secondary compact-button" type="button" data-action="addQuizOption">Agregar opción</button>
        <button class="secondary compact-button" type="button" data-action="addQuizQuestion">Agregar pregunta</button>
      </div>
    </div>
  `;
}

function quizOptionTemplate(questionIndex, optionIndex) {
  return `
    <div class="quiz-option">
      <input name="quizOption-${questionIndex}" placeholder="Opción ${optionIndex + 1}" />
      <label class="check-row"><input type="checkbox" name="quizCorrect-${questionIndex}-${optionIndex}" /> Correcta</label>
      <input name="quizPoints-${questionIndex}-${optionIndex}" type="number" min="0" value="1" aria-label="Puntos" />
    </div>
  `;
}

function parseQuizForm(form) {
  return [...form.querySelectorAll(".quiz-question")].map((node, qIndex) => {
    const text = node.querySelector('[name="quizQuestion"]').value.trim();
    const options = [...node.querySelectorAll(".quiz-option")].map((optionNode, optionIndex) => ({
      text: optionNode.querySelector(`[name="quizOption-${qIndex}"]`)?.value.trim() || `Opción ${optionIndex + 1}`,
      correct: Boolean(optionNode.querySelector(`[name="quizCorrect-${qIndex}-${optionIndex}"]`)?.checked),
      points: Number(optionNode.querySelector(`[name="quizPoints-${qIndex}-${optionIndex}"]`)?.value || 0)
    })).filter((option) => option.text);
    return { text: text || `Pregunta ${qIndex + 1}`, options };
  }).filter((question) => question.options.length);
}

function digitalProfileQuestionTemplate(index, question = {}) {
  const options = question.options?.length ? question.options : [
    { text: "", value: 0 },
    { text: "", value: 0 }
  ];
  return `
    <div class="digital-profile-question" data-digital-question-index="${index}">
      <label>Pregunta ${index + 1}</label>
      <input name="digitalProfileQuestion" placeholder="Texto de la pregunta" value="${escapeHtml(question.text || "")}" />
      <div class="digital-profile-option-head" aria-hidden="true">
        <span>Respuestas</span>
        <span>Valor interno</span>
      </div>
      <div class="digital-profile-options">
        ${options.map((option, optionIndex) => digitalProfileOptionTemplate(index, optionIndex, option)).join("")}
      </div>
      <div class="quiz-actions">
        <button class="secondary compact-button" type="button" data-action="addDigitalProfileOption">Agregar respuesta</button>
      </div>
    </div>
  `;
}

function digitalProfileOptionTemplate(questionIndex, optionIndex, option = {}) {
  return `
    <div class="digital-profile-option">
      <input name="digitalProfileOption-${questionIndex}" placeholder="Respuesta ${optionIndex + 1}" value="${escapeHtml(option.text || "")}" />
      <input name="digitalProfileValue-${questionIndex}-${optionIndex}" type="number" min="0" value="${Number(option.value || 0)}" aria-label="Valor interno" />
    </div>
  `;
}

function parseDigitalProfileForm(form) {
  return [...form.querySelectorAll(".digital-profile-question")].map((node, qIndex) => {
    const text = node.querySelector('[name="digitalProfileQuestion"]').value.trim();
    const options = [...node.querySelectorAll(".digital-profile-option")].map((optionNode, optionIndex) => ({
      id: `q${qIndex}-o${optionIndex}`,
      text: optionNode.querySelector(`[name="digitalProfileOption-${qIndex}"]`)?.value.trim() || `Respuesta ${optionIndex + 1}`,
      value: Number(optionNode.querySelector(`[name="digitalProfileValue-${qIndex}-${optionIndex}"]`)?.value || 0)
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
                  <span>Eliminar</span>
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
  const typeLabel = surveyTypeLabel(session.type);
  const annualFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const metricValue = session.type === "wordcloud" || session.type === FREE_TEXT_TYPE || session.type === MULTIPLE_CHOICE_TYPE
    ? `${stats.count} respuestas`
    : session.type === DIGITAL_PROFILE_TYPE
      ? (stats.count ? annualFormatter.format(stats.average) : "--")
    : `${stats.count ? stats.average.toFixed(1) : "--"}${session.type === "quiz" ? " pts" : ""}`;
  return `
    <div class="admin-row">
      <strong>${escapeHtml(session.code)}</strong>
      <span><b>${typeLabel}</b> - ${escapeHtml(session.question)}</span>
      <span>${stats.count}</span>
      <span>${metricValue}</span>
      <span class="admin-links">
        <a href="${links.host}" target="_blank" rel="noreferrer">Resultados</a>
        <a href="${links.participant}" target="_blank" rel="noreferrer">Participantes</a>
      </span>
      ${qrBlock(links.participant, "QR", 74, links.invite)}
      <button class="secondary compact-button" data-export-code="${escapeHtml(session.code)}">Descargar</button>
      <button class="danger-button" data-delete-code="${escapeHtml(session.code)}" aria-label="Eliminar encuesta">Eliminar</button>
    </div>
  `;
}

function enterAdmin(code) {
  if (String(code || "").trim() !== "Experiencia") {
    toast("Contraseña de host incorrecta.");
    return;
  }
  appState = { ...appState, view: "hostSetup", code: "", hostMode: true, hostSection: "menu" };
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
  if (session.type === MULTIPLE_CHOICE_TYPE) return multipleChoiceParticipantView(session);
  if (session.type === "wordcloud") return wordCloudParticipantView(session);
  if (session.type === FREE_TEXT_TYPE) return freeTextParticipantView(session);
  if (session.type === "quiz") return quizParticipantView(session);
  if (session.type === DIGITAL_PROFILE_TYPE) return digitalProfileParticipantView(session);
  const stats = computeStats(session);
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const locked = closed || voted;
  const scaleMax = Number(session.scaleMax || 10);
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="panel question-panel">
        <p class="eyebrow">Ronda ${session.round}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${closed ? "Votacion cerrada" : `Tiempo restante ${formatRemaining(session)}`} · ${Object.keys(session.participants).length} participantes conectados</p>
      </section>
      <section class="vote-board">
        ${Array.from({ length: scaleMax }, (_, index) => {
          const value = index + 1;
          return `<button class="vote-tile ${voted && session.votes[appState.user.id].value === value ? "selected" : ""}" data-vote="${value}" ${locked ? "disabled" : ""}>${value}</button>`;
        }).join("")}
      </section>
      <section class="panel compact ${voted ? "thank-you-panel" : ""}">
        ${voted ? thankYouContent(`Calificación enviada: ${session.votes[appState.user.id].value}`) : `<strong>${closed ? "La votación ya no acepta respuestas" : "Selecciona un valor de 1 a 10"}</strong>`}
        ${voted ? "" : `<div class="mini-result">
          ${thermometer(stats.average)}
          ${histogram(stats)}
        </div>`}
      </section>
      ${footer()}
    </main>
  `;
}

function multipleChoiceParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const options = session.multipleChoice?.options || [];
  const selectedText = options[Number(session.votes[appState.user?.id]?.answers?.optionIndex)] || "";
  return `<main class="app-grid">${roomHeader(session)}<section class="panel question-panel"><p class="eyebrow">Opción múltiple · ${closed ? "Cerrada" : `Tiempo restante ${formatRemaining(session)}`}</p><h1>${escapeHtml(session.question)}</h1><p>${Object.keys(session.votes || {}).length} respuestas recibidas</p></section>${voted ? `<section class="panel compact thank-you-panel">${thankYouContent(selectedText)}</section>` : `<form class="panel quiz-answer-form" data-action="multipleChoiceSubmitForm"><fieldset class="quiz-answer-question multiple-choice-answers"><legend>Selecciona una respuesta</legend>${options.map((option, index) => `<label class="answer-option"><input type="radio" name="multipleChoiceAnswer" value="${index}" ${closed ? "disabled" : ""} required /><span>${escapeHtml(option)}</span></label>`).join("")}</fieldset><button class="primary full" type="submit" ${closed ? "disabled" : ""}>Enviar respuesta</button></form>`}${footer()}</main>`;
}

function wordCloudParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const vote = session.votes[appState.user?.id];
  const draft = appState.wordCloudDraft?.[session.code] || "";
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="panel question-panel">
        <p class="eyebrow">Nube de palabras · ${closed ? "Cerrada" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${Object.keys(session.votes || {}).length} respuestas recibidas</p>
      </section>
      ${
        voted
          ? `<section class="panel compact thank-you-panel">${thankYouContent(vote.answers?.text || "")}</section>`
          : `<form class="panel wordcloud-form" data-action="wordCloudSubmitForm">
              <label for="wordcloud-answer">Tu palabra o frase corta</label>
              <input id="wordcloud-answer" name="wordcloudAnswer" maxlength="80" placeholder="Ej: social media" value="${escapeHtml(draft)}" ${closed ? "disabled" : ""} />
              <button class="primary full" type="submit" ${closed ? "disabled" : ""}>Enviar respuesta</button>
            </form>`
      }
      ${footer()}
    </main>
  `;
}

function freeTextParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const draft = appState.freeTextDraft?.[session.code] || "";
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="panel question-panel">
        <p class="eyebrow">Texto libre - ${closed ? "Cerrada" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${Object.keys(session.votes || {}).length} respuestas recibidas</p>
      </section>
      ${
        voted
          ? `<section class="panel compact thank-you-panel">${thankYouContent(session.votes[appState.user?.id]?.answers?.text || "")}</section>`
          : `<form class="panel free-text-form" data-action="freeTextSubmitForm">
              <label for="free-text-answer">Tu respuesta</label>
              <textarea id="free-text-answer" name="freeTextAnswer" rows="7" maxlength="1200" placeholder="Escribe aquí tu respuesta" ${closed ? "disabled" : ""}>${escapeHtml(draft)}</textarea>
              <button class="primary full" type="submit" ${closed ? "disabled" : ""}>Enviar respuesta</button>
            </form>`
      }
      ${footer()}
    </main>
  `;
}

function thankYouContent(answer = "") {
  const cleanAnswer = String(answer || "").trim();
  return `
    <div class="thanks-card">
      <div class="thanks-character" aria-hidden="true">🙌</div>
      <div>
        ${cleanAnswer ? `<div class="sent-answer"><span>Respuesta enviada</span><strong>${escapeHtml(shortText(cleanAnswer, 180))}</strong></div>` : ""}
        <p class="eyebrow">Respuesta recibida</p>
        <h2>¡Gracias por tu aporte!</h2>
        <p>En el Grupo EPM ponemos a las personas en el centro de todo lo que hacemos. Por eso trabajamos para hacer todo más simple, con responsabilidad, transparencia y calidez.</p>
      </div>
    </div>
  `;
}

function quizParticipantViewLegacy(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const vote = session.votes[appState.user?.id];
  const maxScore = maxQuizScore(session);
  const mood = voted ? scoreMood(vote.score, maxScore) : null;
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="panel question-panel">
        <p class="eyebrow">Quiz · ${closed ? "Cerrado" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${session.quiz?.questions?.length || 0} preguntas · puntaje máximo ${maxQuizScore(session)}</p>
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

function quizParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const vote = session.votes[appState.user?.id];
  const maxScore = maxQuizScore(session);
  const mood = voted ? scoreMood(vote.score, maxScore) : null;
  return `
    <main class="app-grid">
      ${roomHeader(session)}
      <section class="panel question-panel">
        <p class="eyebrow">Quiz · ${closed ? "Cerrado" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(session.question)}</h1>
        <p>${session.quiz?.questions?.length || 0} preguntas · puntaje máximo ${maxScore}</p>
      </section>
      ${
        voted
          ? `<section class="panel score-panel">
              <div class="score-mood" aria-hidden="true">${mood.icon}</div>
              ${thankYouContent(`Puntaje enviado: ${vote.score} de ${maxScore}`)}
              <p class="eyebrow">${mood.label}</p>
              <h1>${vote.score}</h1>
              <p>Sobre ${maxScore} puntos posibles</p>
            </section>`
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

function digitalProfileParticipantView(session) {
  const voted = Boolean(session.votes[appState.user?.id]);
  const closed = isSessionClosed(session);
  const vote = session.votes[appState.user?.id];
  const survey = digitalProfileConfig(session);
  const result = voted ? digitalProfileResult(session, vote.answers || {}) : null;
  const draft = appState.digitalProfileDraft?.[session.code] || {};
  return `
    <main class="app-grid digital-profile-app">
      ${roomHeader(session)}
      ${voted ? "" : `<section class="panel question-panel">
        <p class="eyebrow">Perfil digital · ${closed ? "Cerrada" : `Tiempo restante ${formatRemaining(session)}`}</p>
        <h1>${escapeHtml(survey.title)}</h1>
        <p>${Object.keys(session.participants).length} participantes conectados</p>
      </section>`}
      ${
        voted
          ? digitalProfileResultCard(result, appState.user)
          : `<form class="panel digital-profile-form" data-action="digitalProfileSubmitForm">
              ${survey.questions.map((question, qIndex) => `
                <fieldset class="digital-question">
                  <legend>${escapeHtml(question.text)}</legend>
                  ${question.options.map((option, optionIndex) => `
                    <label class="answer-option digital-option">
                      <input type="radio" name="dp-${qIndex}" value="${optionIndex}" ${Number(draft[qIndex]) === optionIndex ? "checked" : ""} ${closed ? "disabled" : ""} />
                      <span>${escapeHtml(option.text)}</span>
                    </label>
                  `).join("")}
                </fieldset>
              `).join("")}
              <button class="primary full" type="submit" ${closed ? "disabled" : ""}>Conocer mi perfil</button>
            </form>`
      }
      ${footer()}
    </main>
  `;
}

function digitalProfileResultCard(result, user) {
  const [, avatarLabel, avatarIcon] = avatarById(user?.avatar);
  const costText = formatCop(result.estimatedValue);
  const celebrate = ["digital", "very-digital"].includes(result.profile.key);
  const costMessage = `Según tus respuestas, cada 12 meses le generas a EPM un costo aproximado de ${costText}.`;
  const motivation = result.profile.key === "very-digital"
    ? "Excelente: ya estás ayudando a que la atención sea más ágil, simple y sostenible. Sigue usando EMA, factura web y pagos digitales; tu hábito digital suma mucho."
    : result.profile.key === "digital"
      ? "Vas muy bien: con uno o dos pasos más hacia EMA, factura web o pagos digitales puedes ahorrar tiempo y hacer cada trámite más fácil."
      : "Hoy tienes una oportunidad enorme para ganar tiempo y evitar filas: prueba un canal digital en tu próximo contacto y descubre una forma más rápida de resolver.";
  return `
    <section class="digital-result-card ${result.profile.key}">
      ${celebrate ? `<div class="celebration" aria-hidden="true">
        <span class="balloon b1"></span>
        <span class="balloon b2"></span>
        <span class="balloon b3"></span>
        <span class="confetti c1"></span>
        <span class="confetti c2"></span>
        <span class="confetti c3"></span>
        <span class="confetti c4"></span>
        <span class="confetti c5"></span>
      </div>` : ""}
      <div class="digital-result-person">
        <span class="result-avatar" title="${escapeHtml(avatarLabel)}">${avatarIcon}</span>
        <strong>${escapeHtml(user?.name || "Participante")}</strong>
      </div>
      ${thankYouContent(`Perfil obtenido: ${result.profile.label}`)}
      <p class="eyebrow">${escapeHtml(result.profile.tone)}</p>
      <h1>${escapeHtml(result.profile.label)}</h1>
      <div class="annual-value">
        <span>Costo estimado anual para EPM</span>
        <strong>${costText}</strong>
      </div>
      <p class="result-message"><span>${escapeHtml(costMessage)}</span><span>${escapeHtml(motivation)}</span></p>
    </section>
  `;
}

function scoreMood(score, maxScore) {
  const ratio = maxScore ? Number(score || 0) / maxScore : 0;
  if (ratio >= 0.8) return { icon: "😄", label: "Excelente resultado" };
  if (ratio >= 0.5) return { icon: "🙂", label: "Buen resultado" };
  return { icon: "😟", label: "Puedes mejorar" };
}

function hostView(session) {
  const stats = computeStats(session);
  const links = sessionLinks(session.code);
  return `
    <main class="host-layout">
      ${roomHeader(session)}
      <section class="host-main">
        <div class="results-row ${session.type === "wordcloud" ? "wordcloud-results-row" : session.type === FREE_TEXT_TYPE ? "free-text-results-row" : ""}">
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
  if (session.type === MULTIPLE_CHOICE_TYPE) return multipleChoiceResultsPanel(stats);
  if (session.type === "wordcloud") {
    return `
      <div class="panel results-side wordcloud-side">
        <h2>Nube de palabras</h2>
        ${wordCloudVisual(stats.words || [])}
      </div>
    `;
  }
  if (session.type === "quiz") {
    return `
      <div class="panel results-side">
        <h2>Resultados quiz</h2>
        <div class="quiz-summary">
          <strong>${stats.count}</strong><span>participantes</span>
          <strong>${stats.average.toFixed(1)}</strong><span>promedio puntos</span>
          <strong>${stats.maxScore}</strong><span>puntos máximos</span>
        </div>
      </div>
    `;
  }
  if (session.type === FREE_TEXT_TYPE) return freeTextResultsPanel(stats);
  if (session.type === DIGITAL_PROFILE_TYPE) return digitalProfileResultsPanel(session, stats);
  return `
    <div class="panel results-side">
      <h2>Distribución respuestas</h2>
      ${histogram(stats)}
      ${trendPanel(session)}
    </div>
  `;
}

function multipleChoiceResultsPanel(stats) {
  return `<div class="panel results-side multiple-choice-results"><h2>Resultados por opción</h2><div class="choice-result-bars">${stats.options.map((option, index) => { const count = stats.distribution[index] || 0; const percent = stats.count ? Math.round((count / stats.count) * 100) : 0; return `<div class="choice-result"><div><span>${escapeHtml(option)}</span><strong>${count} · ${percent}%</strong></div><div class="choice-track"><span style="width:${percent}%"></span></div></div>`; }).join("")}</div><div class="choice-summary"><strong>Resumen</strong><p>${escapeHtml(stats.summary)}</p></div></div>`;
}

function freeTextResultsPanel(stats) {
  return `
    <div class="panel results-side free-text-results-side">
      <h2 class="free-text-title">Análisis de textos</h2>
      <div class="free-text-analysis">
        <strong>Resumen ejecutivo</strong>
        <p>${escapeHtml(stats.summary)}</p>
      </div>
      <div class="free-text-insights">
        <strong>Análisis</strong>
        ${
          stats.analysis?.length
            ? `<ul>${stats.analysis.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : `<p class="muted">Esperando respuestas para analizar.</p>`
        }
      </div>
      <div class="free-text-keywords">
        <strong>Temas representativos</strong>
        <div>
          ${
            stats.themes?.length
              ? stats.themes.map((theme) => `<span>${escapeHtml(theme.label)}</span>`).join("")
              : `<small class="muted">Esperando respuestas</small>`
          }
        </div>
      </div>
      <div class="free-text-actions">
        <strong>Acciones sugeridas</strong>
        ${
          stats.recommendations?.length
            ? `<ul>${stats.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : `<p class="muted">Aún no hay textos para analizar.</p>`
        }
      </div>
    </div>
  `;
}

function digitalProfileResultsPanel(session, stats = computeStats(session)) {
  const survey = digitalProfileConfig(session);
  return `
    <div class="panel results-side digital-results-side">
      <h2>Perfil digital</h2>
      <div class="profile-bars">
        ${[
          ["traditional", "Tradicional"],
          ["hybrid", "Híbrido"],
          ["digital", "Digital"],
          ["very-digital", "Muy digital"]
        ].map(([key, label]) => {
          const count = stats.profileCounts?.[key] || 0;
          const percent = stats.count ? Math.round((count / stats.count) * 100) : 0;
          return `<div class="profile-bar"><span>${label}</span><strong>${count}</strong><meter min="0" max="100" value="${percent}"></meter><small>${percent}%</small></div>`;
        }).join("")}
      </div>
      <div class="digital-option-blocks">
        ${survey.questions.map((question, qIndex) => `
          <div class="digital-option-block">
            <strong>${escapeHtml(question.text)}</strong>
            ${question.options.map((option, optionIndex) => `
              <span><small>${escapeHtml(option.text)}</small><b>${stats.optionCounts?.[qIndex]?.[optionIndex] || 0}</b></span>
            `).join("")}
          </div>
        `).join("")}
      </div>
      <div class="digital-analysis">
        <strong>Análisis</strong>
        <p>${escapeHtml(digitalProfileAnalysis(stats))}</p>
      </div>
    </div>
  `;
}

function digitalProfileAnalysis(stats) {
  if (!stats.count) return "Aún no hay respuestas. Cuando empiecen a votar, aquí aparecerá la lectura de adopción digital por canales.";
  const digitalCount = (stats.profileCounts?.digital || 0) + (stats.profileCounts?.["very-digital"] || 0);
  const digitalShare = Math.round((digitalCount / stats.count) * 100);
  const survey = stats.survey || defaultDigitalProfileSurvey();
  const topQuestion = survey.questions
    .map((question, qIndex) => {
      const counts = stats.optionCounts?.[qIndex] || [];
      const topIndex = counts.reduce((best, count, index) => count > counts[best] ? index : best, 0);
      return { question, topIndex, count: counts[topIndex] || 0 };
    })
    .sort((a, b) => b.count - a.count)[0];
  const topOption = topQuestion?.question.options[topQuestion.topIndex]?.text || "sin tendencia clara";
  return `${digitalShare}% de las respuestas ya se ubican en perfiles Digital o Muy digital. La tendencia más fuerte está en "${topOption}", útil para priorizar mensajes de migración hacia factura web, EMA y pagos digitales.`;
}

function digitalProfileAverageAnalysis(stats) {
  if (!stats.count) return "El análisis aparecerá cuando lleguen las primeras respuestas.";
  const digitalCount = (stats.profileCounts?.digital || 0) + (stats.profileCounts?.["very-digital"] || 0);
  const digitalShare = Math.round((digitalCount / stats.count) * 100);
  const traditionalShare = Math.round(((stats.profileCounts?.traditional || 0) / stats.count) * 100);
  if (traditionalShare >= 40) return `${traditionalShare}% está en perfil Tradicional. La mayor oportunidad está en mover atención y pagos hacia canales digitales.`;
  if (digitalShare >= 60) return `${digitalShare}% ya está en perfiles Digital o Muy digital. Conviene reforzar EMA, factura web y pagos digitales para sostener el avance.`;
  return `${digitalShare}% está en perfiles Digital o Muy digital. Hay una mezcla de hábitos: buen momento para invitar a migrar los canales más costosos.`;
}

function wordCloudVisual(words) {
  const palette = ["#0b8f48", "#80bd28", "#1f6fb2", "#0067b1", "#6d6e71", "#15251f"];
  if (!words.length) return `<div class="word-cloud-shape empty">Esperando respuestas</div>`;
  const layout = wordCloudLayout(words);
  return `
    <div class="word-cloud-shape">
      ${layout.map((word, index) => `<span style="--x:${word.x}%;--y:${word.y}%;--r:${word.rotate}deg;--s:${word.size};--c:${palette[index % palette.length]}">${escapeHtml(word.text)}</span>`).join("")}
    </div>
  `;
}

function wordCloudLayout(words) {
  const max = Math.max(...words.map((word) => word.count), 1);
  const min = Math.min(...words.map((word) => word.count), max);
  const area = { width: 100, height: 55 };
  const placed = [];
  const candidates = words.slice(0, 44).map((word) => {
    const weight = max === min ? (max > 1 ? 0.55 : 0.18) : (word.count - min) / (max - min);
    return {
      ...word,
      size: Number((1.75 + Math.sqrt(weight) * 5.15).toFixed(2))
    };
  });

  candidates.forEach((word, index) => {
    let selected = null;
    const rotations = index > 0 && index % 5 === 0 ? [-90, 0] : [0, -90];

    for (const shrink of [1, 0.88, 0.76, 0.64]) {
      const size = Number((word.size * shrink).toFixed(2));
      for (const rotate of rotations) {
        const box = wordBox(word.text, size, rotate);
        for (let step = 0; step < 2200 && !selected; step += 1) {
          const angle = step * 0.47 + index * 1.13;
          const radius = step * 0.052;
          const x = area.width / 2 + Math.cos(angle) * radius * 1.58;
          const y = area.height / 2 + Math.sin(angle) * radius * 0.9;
          const rect = {
            left: x - box.width / 2,
            right: x + box.width / 2,
            top: y - box.height / 2,
            bottom: y + box.height / 2
          };
          if (!insideCloud(rect, area) || placed.some((item) => overlaps(rect, item.rect))) continue;
          selected = { x, y, rect, rotate, size };
        }
        if (selected) break;
      }
      if (selected) break;
    }

    if (!selected) return;
    placed.push({
      ...word,
      rotate: selected.rotate,
      size: selected.size,
      x: Number(((selected.x / area.width) * 100).toFixed(2)),
      y: Number(((selected.y / area.height) * 100).toFixed(2)),
      rect: selected.rect
    });
  });

  return placed;
}

function wordBox(text, fontSize, rotate) {
  const letters = String(text || "").length;
  const baseWidth = Math.max(fontSize * 1.55, letters * fontSize * 0.72);
  const baseHeight = fontSize * 1.28;
  return rotate ? { width: baseHeight, height: baseWidth } : { width: baseWidth, height: baseHeight };
}

function insideCloud(rect, area) {
  const paddingX = area.width * 0.05;
  const paddingY = area.height * 0.1;
  return rect.left >= paddingX && rect.right <= area.width - paddingX && rect.top >= paddingY && rect.bottom <= area.height - paddingY;
}

function overlaps(a, b) {
  const gap = 1.35;
  return !(a.right + gap < b.left || a.left - gap > b.right || a.bottom + gap < b.top || a.top - gap > b.bottom);
}

function trendPanel(session) {
  const trend = scaleTrend(session);
  return `
    <div class="trend-card ${trend.type}">
      <span class="trend-arrow" aria-hidden="true">${trend.icon}</span>
      <div>
        <p>Tendencia en vivo</p>
        <strong>${trend.title}</strong>
        <small>${trend.detail}</small>
      </div>
    </div>
  `;
}

function scaleTrend(session) {
  const votes = Object.values(session?.votes || {})
    .filter((vote) => Number.isFinite(Number(vote.value)))
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  if (votes.length < 2) {
    return {
      type: "stable",
      icon: "→",
      title: "Esperando tendencia",
      detail: "Se activa desde el segundo voto."
    };
  }
  const current = votes.reduce((sum, vote) => sum + Number(vote.value), 0) / votes.length;
  const previousVotes = votes.slice(0, -1);
  const previous = previousVotes.reduce((sum, vote) => sum + Number(vote.value), 0) / previousVotes.length;
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) {
    return {
      type: "stable",
      icon: "→",
      title: "Estable",
      detail: `Promedio sin cambios fuertes (${current.toFixed(1)}).`
    };
  }
  return diff > 0
    ? {
        type: "up",
        icon: "↑",
        title: "Subiendo",
        detail: `El último voto elevó el promedio a ${current.toFixed(1)}.`
      }
    : {
        type: "down",
        icon: "↓",
        title: "Bajando",
        detail: `El último voto bajó el promedio a ${current.toFixed(1)}.`
      };
}

function displayView(session) {
  return `
    <main class="display-layout">
      ${roomHeader(session)}
      <section class="display-results">
        <div class="results-row ${session.type === "wordcloud" ? "wordcloud-results-row" : session.type === FREE_TEXT_TYPE ? "free-text-results-row" : ""}">
          ${liveResultsPanel(session)}
          ${resultsSidePanel(session)}
        </div>
      </section>
      ${footer()}
    </main>
  `;
}

function inviteView(session) {
  const links = sessionLinks(session.code);
  return `
    <main class="invite-layout">
      <section class="invite-card">
        <img class="invite-logo" src="./assets/logo-grupo-epm.png" alt="Grupo EPM" />
        <p class="invite-vp">Vicepresidencia Experiencia Usuario Cliente</p>
        <h1>Participa en Retox</h1>
        <p class="invite-copy">Te invitamos a responder esta encuesta en vivo. Escanea el código QR o ingresa con el código de sala.</p>
        <strong class="invite-code">${session.code}</strong>
        <img class="invite-qr" src="${qrUrl(links.participant, 280)}" alt="QR para participar en Retox" />
        <p class="invite-question">${escapeHtml(session.question)}</p>
        <div class="invite-actions">
          <a class="top-control" href="${links.participant}">Ir a la votación</a>
          <button class="top-control" data-action="home">Inicio</button>
        </div>
        <p class="invite-signature">Firma: Vicepresidencia Experiencia Usuario Cliente - Grupo EPM</p>
      </section>
      ${footer()}
    </main>
  `;
}

function liveResultsPanel(session) {
  const stats = computeStats(session);
  const isDigitalProfile = session.type === DIGITAL_PROFILE_TYPE;
  const people = isDigitalProfile ? votedPeople(session) : votedPeople(session).slice(-5);
  const links = sessionLinks(session.code);
  return `
    <div class="results-stage ${session.type === "wordcloud" ? "wordcloud-stage" : session.type === FREE_TEXT_TYPE ? "free-text-stage" : ""}">
      <h2 class="live-question">${escapeHtml(session.question)}</h2>
      <div class="live-metrics ${session.type === "wordcloud" ? "wordcloud-metrics" : session.type === FREE_TEXT_TYPE ? "free-text-metrics" : ""}">
        <div class="metric-card countdown ${isSessionClosed(session) ? "closed" : ""}">
          <span>${isSessionClosed(session) ? "Votacion cerrada" : "Tiempo restante"}</span>
          <strong>${formatRemaining(session)}</strong>
          ${session.type === "quiz" ? "" : `
            <a class="live-qr" href="${links.invite}" target="_blank" rel="noreferrer" aria-label="Abrir invitación con QR">
              <img src="${qrUrl(links.participant, 112)}" alt="QR para ingresar a la encuesta" />
              <small>Escanea para participar</small>
            </a>
          `}
        </div>
        <div class="metric-card average-card ${session.type === "wordcloud" || session.type === FREE_TEXT_TYPE ? "wordcloud-average-card" : ""} ${isDigitalProfile ? "digital-average-card" : ""}">
          <div>
            <p class="eyebrow">${session.type === "quiz" ? "Promedio puntos" : session.type === "wordcloud" || session.type === FREE_TEXT_TYPE || session.type === MULTIPLE_CHOICE_TYPE ? "Respuestas" : isDigitalProfile ? "Valor promedio" : "Promedio en vivo"}</p>
            <h1>${session.type === "wordcloud" || session.type === FREE_TEXT_TYPE || session.type === MULTIPLE_CHOICE_TYPE ? stats.count : isDigitalProfile ? (stats.count ? formatCop(stats.average) : "--") : stats.count ? stats.average.toFixed(1) : "--"}</h1>
            <p>${stats.count} respuestas de ${Object.keys(session.participants).length} participantes</p>
          </div>
          ${isDigitalProfile ? `<div class="digital-average-analysis"><strong>Análisis</strong><p>${escapeHtml(digitalProfileAverageAnalysis(stats))}</p></div>` : ""}
          ${session.type === "quiz" || session.type === "wordcloud" || session.type === FREE_TEXT_TYPE || session.type === MULTIPLE_CHOICE_TYPE || isDigitalProfile ? "" : thermometer(stats.average, true)}
        </div>
      </div>
      <div class="live-voters ${isDigitalProfile ? "digital-live-voters" : ""}" aria-live="polite">
        ${
          people.length
            ? people.map((person) => isDigitalProfile ? digitalProfilePersonChip(session, person) : personChip(person)).join("")
            : `<p class="waiting-votes">Aún no hay votos registrados</p>`
        }
      </div>
    </div>
  `;
}

function roomHeader(session) {
  const showUser = !appState.hostMode && appState.user && ["waiting", "identify"].includes(appState.view);
  const hostBack = hostBackTarget();
  return `
    <header class="room-header">
      ${logo()}
      <div class="room-meta">
        ${showUser ? `<div class="header-person">${personChip(appState.user, "active-person header-edit-person", "editIdentity")}</div>` : ""}
        <span class="top-control">${session.code}</span>
        <button class="top-control home-button" data-action="home" aria-label="Inicio" title="Inicio">Inicio</button>
        ${hostBack ? `<button class="top-control" data-host-back="${hostBack}">Atras</button>` : ""}
      </div>
    </header>
  `;
}

function hostBackTarget() {
  if (appState.view !== "hostSetup") return "";
  if (appState.hostSection === "history") return "menu";
  if (appState.hostSection === "typeChoice") return "menu";
  if (appState.hostSection === "create") return "typeChoice";
  return "";
}

function thermometer(value, large = false) {
  const session = getSession(appState.code);
  const scaleMax = Number(session?.scaleMax || 10);
  const percent = Math.max(0, Math.min(100, ((value || 0) - 1) / Math.max(1, scaleMax - 1) * 100));
  const trackWidth = large ? 64 : 34;
  const trackHeight = large ? 248 : 150;
  const fillHeight = value ? Math.max(8, (percent / 100) * trackHeight) : 0;
  const fillY = trackHeight - fillHeight;
  const radius = trackWidth / 2;
  const gradientId = `thermo-gradient-${large ? "large" : "small"}-${Math.round(percent)}-${Math.round(Math.random() * 100000)}`;
  return `
    <div class="thermo ${large ? "large" : ""}" style="--level:${percent}%">
      <div class="thermo-scale"><span>${scaleMax}</span><span>${Math.ceil(scaleMax / 2)}</span><span>1</span></div>
      <svg class="thermo-svg" viewBox="0 0 ${trackWidth} ${trackHeight}" role="img" aria-label="Promedio ${value ? value.toFixed(1) : "sin votos"}">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="${trackHeight}" x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0b8f48" />
            <stop offset="35%" stop-color="#80bd28" />
            <stop offset="50%" stop-color="#ffd84d" />
            <stop offset="68%" stop-color="#f28b2e" />
            <stop offset="100%" stop-color="#d92d20" />
          </linearGradient>
          <clipPath id="${gradientId}-clip">
            <rect x="2" y="2" width="${trackWidth - 4}" height="${trackHeight - 4}" rx="${radius}" />
          </clipPath>
        </defs>
        <rect x="2" y="2" width="${trackWidth - 4}" height="${trackHeight - 4}" rx="${radius}" fill="rgba(255,255,255,0.32)" stroke="rgba(255,255,255,0.9)" stroke-width="4" />
        <g clip-path="url(#${gradientId}-clip)">
          <rect x="2" y="${fillY}" width="${trackWidth - 4}" height="${fillHeight}" fill="url(#${gradientId})" />
        </g>
      </svg>
      <div class="thermo-value">${value ? value.toFixed(1) : "--"}</div>
    </div>
  `;
}

function histogram(stats) {
  const columns = Math.max(1, stats.distribution.length);
  return `
    <div class="histogram" style="--bars:${columns}">
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
  return repairTextEncoding(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function repairTextEncoding(value) {
  let text = String(value ?? "");
  const replacements = [
    ["\u00c3\u0192\u00c2\u00a1", "\u00e1"],
    ["\u00c3\u0192\u00c2\u00a9", "\u00e9"],
    ["\u00c3\u0192\u00c2\u00ad", "\u00ed"],
    ["\u00c3\u0192\u00c2\u00b3", "\u00f3"],
    ["\u00c3\u0192\u00c2\u00ba", "\u00fa"],
    ["\u00c3\u0192\u00c2\u00b1", "\u00f1"],
    ["\u00c3\u00a1", "\u00e1"],
    ["\u00c3\u00a9", "\u00e9"],
    ["\u00c3\u00ad", "\u00ed"],
    ["\u00c3\u00b3", "\u00f3"],
    ["\u00c3\u00ba", "\u00fa"],
    ["\u00c3\u00b1", "\u00f1"],
    ["\u00c3\u0081", "\u00c1"],
    ["\u00c3\u0089", "\u00c9"],
    ["\u00c3\u008d", "\u00cd"],
    ["\u00c3\u0093", "\u00d3"],
    ["\u00c3\u009a", "\u00da"],
    ["\u00c3\u0091", "\u00d1"],
    ["\u00c3\u00bc", "\u00fc"],
    ["\u00c2\u00b7", "-"],
    ["\u00c2\u00bf", "\u00bf"],
    ["\u00c2\u00a1", "\u00a1"],
    ["\u00c2", ""]
  ];
  replacements.forEach(([broken, fixed]) => {
    text = text.split(broken).join(fixed);
  });
  return text;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = repairTextEncoding(message);
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

function playDigitalProfileSound(profileKey) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    context.resume?.();
    const now = context.currentTime;
    const notesByProfile = {
      "very-digital": [659, 784, 988, 1319],
      digital: [523, 659, 784],
      hybrid: [392, 523, 659],
      traditional: [330, 392, 494]
    };
    const notes = notesByProfile[profileKey] || notesByProfile.hybrid;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = profileKey === "traditional" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.09, now + index * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.11 + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.11);
      oscillator.stop(now + index * 0.11 + 0.2);
    });
    setTimeout(() => context.close(), 900);
  } catch {
    // El sonido es decorativo; si el navegador lo bloquea, la encuesta sigue normal.
  }
}

function render() {
  const root = document.querySelector("#app");
  if (shouldPauseRenderForWordCloudInput()) return;
  const digitalResultsScroll = document.querySelector(".digital-results-side")?.scrollTop || 0;
  document.body.classList.toggle("dark", appState.dark);
  const hashJoin = location.hash.match(/join=([A-Z0-9]{4})/i);
  const hashHost = location.hash.match(/host=([A-Z0-9]{4})/i);
  const hashDisplay = location.hash.match(/display=([A-Z0-9]{4})/i);
  const hashInvite = location.hash.match(/invite=([A-Z0-9]{4})/i);
  if (hashInvite && appState.view === "welcome") {
    const linkedCode = hashInvite[1].toUpperCase();
    if (getSession(linkedCode)) {
      appState.code = linkedCode;
      appState.view = "invite";
    } else {
      appState.code = linkedCode;
    }
  }
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
              : appState.view === "invite"
                ? inviteView(session)
                : waitingView(session);

  if (hashJoin && appState.view === "welcome") {
    const input = document.querySelector("#code");
    if (input) input.value = appState.code;
  }
  const digitalResultsSide = document.querySelector(".digital-results-side");
  if (digitalResultsSide) digitalResultsSide.scrollTop = digitalResultsScroll;
  repairRenderedEncoding(root);
}

function shouldPauseRenderForWordCloudInput() {
  const input = document.activeElement;
  const session = getSession(appState.code);
  if (input?.id === "wordcloud-answer") {
    appState.wordCloudDraft = {
      ...(appState.wordCloudDraft || {}),
      [appState.code]: input.value
    };
    return appState.view === "waiting" && session?.type === "wordcloud" && !session.votes?.[appState.user?.id];
  }
  if (input?.id === "free-text-answer") {
    appState.freeTextDraft = {
      ...(appState.freeTextDraft || {}),
      [appState.code]: input.value
    };
    return appState.view === "waiting" && session?.type === FREE_TEXT_TYPE && !session.votes?.[appState.user?.id];
  }
  return false;
}

function repairRenderedEncoding(root = document.body) {
  root.querySelectorAll("input, textarea").forEach((field) => {
    const fixed = repairTextEncoding(field.value);
    if (field.value !== fixed) field.value = fixed;
  });
  root.querySelectorAll("[placeholder], [title], [aria-label], [value]").forEach((node) => {
    ["placeholder", "title", "aria-label", "value"].forEach((attr) => {
      if (!node.hasAttribute(attr)) return;
      const current = node.getAttribute(attr);
      const fixed = repairTextEncoding(current);
      if (current !== fixed) node.setAttribute(attr, fixed);
    });
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const fixed = repairTextEncoding(node.nodeValue);
    if (node.nodeValue !== fixed) node.nodeValue = fixed;
  });
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const voteValue = event.target.closest("[data-vote]")?.dataset.vote;
  const exportCode = event.target.closest("[data-export-code]")?.dataset.exportCode;
  const deleteCode = event.target.closest("[data-delete-code]")?.dataset.deleteCode;
  const copyUrl = event.target.closest("[data-copy-url]")?.dataset.copyUrl;
  const displayUrl = event.target.closest("[data-open-display]")?.dataset.openDisplay;
  const hostCard = event.target.closest("[data-host-card]")?.dataset.hostCard;
  const hostBack = event.target.closest("[data-host-back]")?.dataset.hostBack;
  if (voteValue) await vote(Number(voteValue));
  if (exportCode) exportSessionResults(getSession(exportCode));
  if (deleteCode) await deleteSession(deleteCode);
  if (copyUrl) await copyToClipboard(copyUrl);
  if (displayUrl) window.open(displayUrl, "_blank", "noopener,noreferrer");
  if (hostCard === "create") {
    appState.hostSection = "typeChoice";
    render();
  }
  if (hostCard === "history") {
    appState.hostSection = "history";
    render();
  }
  if (["scale", "quiz", "wordcloud", FREE_TEXT_TYPE, DIGITAL_PROFILE_TYPE, MULTIPLE_CHOICE_TYPE].includes(hostCard)) {
    appState.surveyType = hostCard;
    appState.hostSection = "create";
    render();
  }
  if (hostBack) {
    appState.hostSection = hostBack;
    render();
  }
  if (action === "resetVotes") await resetVotes();
  if (action === "addDemoVotes") await addDemoVotes();
  if (action === "exportResults") exportResults();
  if (action === "editIdentity") {
    appState.view = "identify";
    render();
  }
  if (action === "home") {
    appState = { ...appState, view: "welcome", code: "", hostMode: false, hostSection: "menu", digitalProfileDraft: {}, wordCloudDraft: {}, freeTextDraft: {} };
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
  if (action === "addDigitalProfileQuestion") {
    const builder = document.querySelector("#digital-profile-builder");
    builder.insertAdjacentHTML("beforeend", digitalProfileQuestionTemplate(builder.querySelectorAll(".digital-profile-question").length));
  }
  if (action === "addDigitalProfileOption") {
    const question = event.target.closest(".digital-profile-question");
    const qIndex = Number(question.dataset.digitalQuestionIndex);
    const options = question.querySelector(".digital-profile-options");
    options.insertAdjacentHTML("beforeend", digitalProfileOptionTemplate(qIndex, options.querySelectorAll(".digital-profile-option").length));
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
    const digitalProfileQuestions = type === DIGITAL_PROFILE_TYPE ? parseDigitalProfileForm(form) : [];
    const multipleChoiceOptions = type === MULTIPLE_CHOICE_TYPE ? String(new FormData(form).get("multipleChoiceOptions") || "").split(/\r?\n/).map((option) => option.trim()).filter(Boolean) : [];
    if (type === "quiz" && !questions.length) {
      toast("Agrega al menos una pregunta para el quiz.");
      return;
    }
    if (type === DIGITAL_PROFILE_TYPE && !digitalProfileQuestions.length) {
      toast("Agrega al menos una pregunta para Perfil digital.");
      return;
    }
    if (type === MULTIPLE_CHOICE_TYPE && multipleChoiceOptions.length < 2) { toast("Agrega al menos dos opciones de respuesta."); return; }
    await createSession({
      type,
      question: type === "quiz" ? "Quiz" : type === DIGITAL_PROFILE_TYPE ? digitalProfileSurvey.title : new FormData(form).get("question"),
      scaleMax: new FormData(form).get("scaleMax"),
      questions,
      digitalProfileQuestions,
      multipleChoiceOptions,
      durationMinutes: new FormData(form).get("durationMinutes")
    });
  }
  if (action === "quizSubmitForm") await submitQuiz(event);
  if (action === "wordCloudSubmitForm") await submitWordCloud(event);
  if (action === "freeTextSubmitForm") await submitFreeText(event);
  if (action === "digitalProfileSubmitForm") await submitDigitalProfile(event);
  if (action === "multipleChoiceSubmitForm") await submitMultipleChoice(event);
});

document.addEventListener("change", (event) => {
  if (event.target.name?.startsWith("dp-")) {
    const qIndex = event.target.name.split("-")[1];
    appState.digitalProfileDraft = {
      ...(appState.digitalProfileDraft || {}),
      [appState.code]: {
        ...(appState.digitalProfileDraft?.[appState.code] || {}),
        [qIndex]: Number(event.target.value)
      }
    };
  }
  if (event.target.dataset.action === "sessionType") {
    const isQuiz = event.target.value === "quiz";
    document.querySelector(".quiz-config").hidden = !isQuiz;
    document.querySelector(".scale-config").hidden = isQuiz;
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "wordcloud-answer") {
    appState.wordCloudDraft = {
      ...(appState.wordCloudDraft || {}),
      [appState.code]: event.target.value
    };
  }
  if (event.target.id === "free-text-answer") {
    appState.freeTextDraft = {
      ...(appState.freeTextDraft || {}),
      [appState.code]: event.target.value
    };
  }
});

function clearWordCloudDraft(code) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized || !appState.wordCloudDraft?.[normalized]) return;
  const { [normalized]: _cleared, ...rest } = appState.wordCloudDraft;
  appState.wordCloudDraft = rest;
}

function clearFreeTextDraft(code) {
  const normalized = String(code || "").toUpperCase();
  if (!normalized || !appState.freeTextDraft?.[normalized]) return;
  const { [normalized]: _cleared, ...rest } = appState.freeTextDraft;
  appState.freeTextDraft = rest;
}

window.addEventListener("retox:update", render);
broadcast?.addEventListener("message", () => {
  sessionCache = readLocalSessions();
  render();
});
window.addEventListener("storage", () => {
  sessionCache = readLocalSessions();
  render();
});

async function clearBrowserCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // Cache cleanup is best-effort; realtime data still loads from Supabase.
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (sessionStorage.getItem("retox.swReloaded.v67")) return;
    sessionStorage.setItem("retox.swReloaded.v67", "1");
    location.reload();
  });

  navigator.serviceWorker
    .register("./sw.js?v=67", { updateViaCache: "none" })
    .then((registration) => {
      registration.update().catch(() => {});
    })
    .catch(() => {});
}

async function initApp() {
  await clearBrowserCaches();
  await loadRemoteSessions();
  subscribeToRemoteSessions();
  render();
}

initApp();

setInterval(async () => {
  const focused = document.activeElement;
  const isEditing = focused && ["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName);
  const shouldSync = appState.code && ["host", "display"].includes(appState.view);
  if (shouldSync && !remotePollInFlight) {
    remotePollInFlight = true;
    try {
      await fetchRemoteSession(appState.code);
    } finally {
      remotePollInFlight = false;
    }
  }
  if (!isEditing && ["host", "waiting", "display"].includes(appState.view)) render();
}, 1200);
