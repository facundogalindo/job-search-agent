import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiRequest, downloadCv } from "./api.js";
import { supabase, supabaseConfigured } from "./supabase.js";
import type { ApplicationEvent, AutomationRun, CandidateProfile, CvVersion, JobOffer, JobSource, MatchData, SearchResult } from "./types.js";

const EMPTY_PROFILE: CandidateProfile = {
  fullName: "",
  headline: "",
  location: "",
  contactEmail: "",
  contactPhone: "",
  englishLevel: "",
  education: [],
  experience: [],
  links: { linkedin: "", github: "" },
  skills: [],
  projects: [],
};

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitFields(line: string): string[] {
  return line.split("|").map((field) => field.trim());
}

function profileToForm(profile: CandidateProfile) {
  return {
    fullName: profile.fullName,
    headline: profile.headline,
    location: profile.location,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    englishLevel: profile.englishLevel,
    linkedin: profile.links.linkedin,
    github: profile.links.github,
    education: profile.education.map((entry) => [entry.institution, entry.degree, entry.status].join(" | ")).join("\n"),
    experience: profile.experience.map((entry) => [entry.company, entry.title, entry.startDate, entry.endDate, entry.highlights.join("; ")].join(" | ")).join("\n"),
    skills: profile.skills.map((entry) => [entry.category, entry.name, entry.level, entry.context, entry.evidence, entry.validationStatus].join(" | ")).join("\n"),
    projects: profile.projects.map((entry) => [entry.name, entry.description, entry.repositoryUrl, entry.demoUrl, entry.technologies.join(", ")].join(" | ")).join("\n"),
  };
}

function profileFromForm(form: ReturnType<typeof profileToForm>): CandidateProfile {
  return {
    fullName: form.fullName,
    headline: form.headline,
    location: form.location,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    englishLevel: form.englishLevel,
    links: { linkedin: form.linkedin, github: form.github },
    education: splitLines(form.education).map((line) => {
      const [institution = "", degree = "", status = ""] = splitFields(line);
      return { institution, degree, status };
    }),
    experience: splitLines(form.experience).map((line) => {
      const [company = "", title = "", startDate = "", endDate = "", highlights = ""] = splitFields(line);
      return { company, title, startDate, endDate, description: "", highlights: highlights.split(";").map((item) => item.trim()).filter(Boolean) };
    }),
    skills: splitLines(form.skills).map((line) => {
      const [category = "Other", name = "", level = "Not specified", context = "", evidence = "", validationStatus = "candidate_confirmed"] = splitFields(line);
      return { category: category || "Other", name, level: level || "Not specified", context, evidence, validationStatus: validationStatus || "candidate_confirmed" };
    }).filter((entry) => entry.name),
    projects: splitLines(form.projects).map((line) => {
      const [name = "", description = "", repositoryUrl = "", demoUrl = "", technologies = ""] = splitFields(line);
      return { name, description, repositoryUrl, demoUrl, technologies: technologies.split(",").map((item) => item.trim()).filter(Boolean) };
    }).filter((entry) => entry.name),
  };
}

function AuthPanel({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setNotice("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) onSignedIn(data.session);
        else setNotice("La cuenta se creó. Revisá tu correo para confirmar la dirección y después iniciá sesión.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn(data.session);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo completar el acceso.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">JOB SEARCH AGENT</span>
        <h1>Tu búsqueda, en un solo lugar.</h1>
        <p>Guardá ofertas, entendé el encaje con tu perfil y prepará CVs PDF privados.</p>
        <form onSubmit={submit} className="stack-form">
          <label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Contraseña<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-button" disabled={pending}>{pending ? "Procesando…" : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}</button>
        </form>
        {notice && <p className="notice" role="status">{notice}</p>}
        <button className="text-button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setNotice(""); }}>
          {mode === "signin" ? "Crear una cuenta nueva" : "Ya tengo una cuenta"}
        </button>
        <p className="fine-print">El primer perfil se carga desde un archivo local privado y se guarda bajo tu usuario de Supabase.</p>
      </section>
    </main>
  );
}

function SetupNotice() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">CONFIGURACIÓN</span>
        <h1>Falta la clave pública de Supabase.</h1>
        <p>Copiá <code>.env.example</code> a <code>.env</code> y completá <code>SUPABASE_PUBLISHABLE_KEY</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> con una clave activa del proyecto.</p>
        <p className="fine-print">No uses la clave <code>service_role</code> ni una clave secreta en el navegador.</p>
      </section>
    </main>
  );
}

function Score({ label, score, tone }: { label: string; score: number; tone: "blue" | "green" }) {
  return <div className={`score score-${tone}`}><span>{label}</span><strong>{score}<small>/100</small></strong></div>;
}

function MatchDetails({ match }: { match: MatchData }) {
  return (
    <details className="details-panel">
      <summary>Ver requisitos y cálculo</summary>
      <div className="detail-body">
        <div>
          <h4>Requisitos detectados</h4>
          {match.requirements.length === 0 ? <p>No se detectaron términos del catálogo actual.</p> : (
            <ul className="plain-list">{match.requirements.map((requirement) => <li key={requirement.name}>
              <span>{requirement.name}</span><span className={match.matchedSkills.includes(requirement.name) ? "tag tag-good" : "tag tag-missing"}>{match.matchedSkills.includes(requirement.name) ? "Perfil" : "Brecha"}</span>
              <small>{requirement.required === true ? "Obligatorio" : requirement.required === false ? "Deseable" : "Sin prioridad indicada"}</small>
            </li>)}</ul>
          )}
        </div>
        <div>
          <h4>Factores de compatibilidad</h4>
          <ul className="factor-list">{match.factors.map((factor) => <li key={factor.name}>
            <div><strong>{factor.name}</strong><span>{factor.score}/100 · peso {factor.weight}%</span></div><p>{factor.explanation}</p>
          </li>)}</ul>
          <p className="fine-print">Estimación propia mediante reglas determinísticas; no predice el puntaje de un ATS externo.</p>
        </div>
      </div>
    </details>
  );
}

function OfferCard({ offer, session, onApplicationChange }: { offer: JobOffer; session: Session; onApplicationChange: () => Promise<void> }) {
  const [events, setEvents] = useState<ApplicationEvent[] | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [updatingApplication, setUpdatingApplication] = useState(false);

  async function showHistory() {
    if (events) {
      setEvents(null);
      return;
    }
    try {
      const result = await apiRequest<{ events: ApplicationEvent[] }>(`/api/offers/${encodeURIComponent(offer.id)}/events`, session);
      setEvents(result.events);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    }
  }

  async function saveCv(cv: CvVersion) {
    setError("");
    setDownloading(cv.id);
    try {
      await downloadCv(cv.id, cv.fileName, session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo descargar el PDF.");
    } finally {
      setDownloading("");
    }
  }

  async function toggleApplied() {
    setError("");
    setUpdatingApplication(true);
    const nextStatus = offer.applicationStatus === "SENT" ? "PENDING" : "SENT";
    try {
      await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/application`, session, {
        method: "POST", body: JSON.stringify({ status: nextStatus }),
      });
      await onApplicationChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cambiar el estado de postulación.");
    } finally {
      setUpdatingApplication(false);
    }
  }

  return (
    <article className="offer-card">
      <div className="offer-topline"><span className={`status status-${offer.status.toLowerCase()}`}>{offer.status.replaceAll("_", " ")}</span><time>{new Date(offer.createdAt).toLocaleDateString("es-AR")}</time></div>
      <h3>{offer.title}</h3>
      {offer.sourceName && <p className="company-line">Fuente: {offer.sourceName}</p>}
      {offer.discardReason && <p className="form-hint">Motivo: {offer.discardReason}</p>}
      {offer.status !== "DISCARDED" && <p className="company-line">Postulación: {offer.applicationStatus === "SENT" ? "Enviada" : offer.applicationStatus === "INTERVIEW" ? "Entrevista" : offer.applicationStatus === "REJECTED" ? "Rechazada" : "Pendiente"}</p>}
      <p className="company-line">{offer.company || "Empresa no indicada"}{offer.location ? ` · ${offer.location}` : ""}{offer.workMode && offer.workMode !== "Unknown" ? ` · ${offer.workMode}` : ""}</p>
      {offer.sourceUrl && <a className="source-link" href={offer.sourceUrl} target="_blank" rel="noreferrer">Abrir oferta original ↗</a>}
      {offer.match && <div className="scores-row">
        <Score label="Compatibilidad real" score={offer.match.realScore} tone="blue" />
        <Score label="Cobertura ATS estimada" score={offer.match.atsCoverageScore} tone="green" />
      </div>}
      {offer.match && <MatchDetails match={offer.match} />}
      <div className="offer-actions">
        {offer.status !== "DISCARDED" && <button className="secondary-button" onClick={() => void toggleApplied()} disabled={updatingApplication}>{updatingApplication ? "Guardando…" : offer.applicationStatus === "SENT" ? "Deshacer postulación" : "Marcar como postulada"}</button>}
        {offer.cvVersions.map((cv) => <button key={cv.id} className="secondary-button" onClick={() => void saveCv(cv)} disabled={Boolean(downloading)}>{downloading === cv.id ? "Descargando…" : `Descargar CV v${cv.version}`}</button>)}
        <button className="text-button compact" onClick={() => void showHistory()}>{events ? "Ocultar historial" : "Ver historial"}</button>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {events && <ol className="timeline">{events.map((event) => <li key={event.id}><time>{new Date(event.createdAt).toLocaleString("es-AR")}</time><strong>{event.type.replaceAll("_", " ")}</strong></li>)}</ol>}
    </article>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [profileForm, setProfileForm] = useState(profileToForm(EMPTY_PROFILE));
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [discardedOffers, setDiscardedOffers] = useState<JobOffer[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState("");
  const [sourceNotice, setSourceNotice] = useState("");
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [sourceForm, setSourceForm] = useState({ provider: "greenhouse" as JobSource["provider"], companyName: "", boardToken: "", region: "global" as JobSource["region"], enabled: true });
  const [notice, setNotice] = useState("");
  const [offerError, setOfferError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerForm, setOfferForm] = useState({ title: "", company: "", sourceUrl: "", location: "", workMode: "Unknown", postedAt: "", description: "" });

  const email = session?.user.email ?? "";
  const refreshOffers = useCallback(async () => {
    if (!session) return;
    const [relevant, discarded] = await Promise.all([
      apiRequest<{ offers: JobOffer[] }>("/api/offers", session),
      apiRequest<{ offers: JobOffer[] }>("/api/offers?includeDiscarded=true", session),
    ]);
    setOffers(relevant.offers.filter((offer) => offer.status !== "DISCARDED"));
    setDiscardedOffers(discarded.offers.filter((offer) => offer.status === "DISCARDED"));
  }, [session]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setOffers([]);
      setDiscardedOffers([]);
      setSources([]);
      setRuns([]);
      setProfile(EMPTY_PROFILE);
      setProfileForm(profileToForm(EMPTY_PROFILE));
      return;
    }
    let active = true;
    setDashboardLoading(true);
    setNotice("");
    Promise.all([
      apiRequest<{ profile: CandidateProfile }>("/api/profile", session),
      apiRequest<{ offers: JobOffer[] }>("/api/offers", session),
      apiRequest<{ offers: JobOffer[] }>("/api/offers?includeDiscarded=true", session),
      apiRequest<{ sources: JobSource[] }>("/api/sources", session),
      apiRequest<{ runs: AutomationRun[] }>("/api/automation-runs", session),
    ]).then(([profileResult, offerResult, discardedResult, sourceResult, runResult]) => {
      if (!active) return;
      setProfile(profileResult.profile);
      setProfileForm(profileToForm(profileResult.profile));
      setOffers(offerResult.offers.filter((offer) => offer.status !== "DISCARDED"));
      setDiscardedOffers(discardedResult.offers.filter((offer) => offer.status === "DISCARDED"));
      setSources(sourceResult.sources);
      setRuns(runResult.runs);
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : "No se pudo cargar el panel.");
    }).finally(() => {
      if (active) setDashboardLoading(false);
    });
    return () => { active = false; };
  }, [session]);

  const profileComplete = useMemo(() => Boolean(profile.fullName && profile.skills.length > 0), [profile]);

  async function refreshAutomationData() {
    if (!session) return;
    const [offerResult, discardedResult, sourceResult, runResult] = await Promise.all([
      apiRequest<{ offers: JobOffer[] }>("/api/offers", session),
      apiRequest<{ offers: JobOffer[] }>("/api/offers?includeDiscarded=true", session),
      apiRequest<{ sources: JobSource[] }>("/api/sources", session),
      apiRequest<{ runs: AutomationRun[] }>("/api/automation-runs", session),
    ]);
    setOffers(offerResult.offers.filter((offer) => offer.status !== "DISCARDED"));
    setDiscardedOffers(discardedResult.offers.filter((offer) => offer.status === "DISCARDED"));
    setSources(sourceResult.sources);
    setRuns(runResult.runs);
  }

  async function searchNow() {
    if (!session) return;
    setSearching(true);
    setNotice("");
    setSearchResult(null);
    try {
      const result = await apiRequest<SearchResult>("/api/search", session, { method: "POST", body: "{}" });
      setSearchResult(result);
      if (result.status === "SUCCEEDED") setNotice(`Búsqueda finalizada: ${result.jobsNew} ofertas nuevas, ${result.jobsRelevant} relevantes, ${result.cvsGenerated} CV PDF generados.`);
      else setNotice(`Búsqueda ${result.status === "PARTIAL" ? "parcial" : "con errores"}: ${result.sourcesFailed} fuentes fallaron y se consultaron ${result.jobsFetched} ofertas reales.`);
      await refreshAutomationData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo ejecutar la búsqueda.");
    } finally {
      setSearching(false);
    }
  }

  function startSourceEdit(source: JobSource) {
    setEditingSourceId(source.id);
    setSourceForm({ provider: source.provider, companyName: source.company_name, boardToken: source.board_token, region: source.region, enabled: source.enabled });
    setShowSourceForm(true);
    setSourceNotice("");
  }

  async function saveSource(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setSourceSaving(true);
    setSourceNotice("");
    const editing = Boolean(editingSourceId);
    try {
      await apiRequest(editing ? `/api/sources/${encodeURIComponent(editingSourceId)}` : "/api/sources", session, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(sourceForm),
      });
      setSourceNotice(editing ? "Fuente actualizada." : "Fuente agregada.");
      setEditingSourceId("");
      setSourceForm({ provider: "greenhouse", companyName: "", boardToken: "", region: "global", enabled: true });
      await refreshAutomationData();
    } catch (error) {
      setSourceNotice(error instanceof Error ? error.message : "No se pudo guardar la fuente.");
    } finally {
      setSourceSaving(false);
    }
  }

  async function toggleSource(source: JobSource) {
    if (!session) return;
    try {
      await apiRequest(`/api/sources/${encodeURIComponent(source.id)}`, session, {
        method: "PUT",
        body: JSON.stringify({ provider: source.provider, companyName: source.company_name, boardToken: source.board_token, region: source.region, enabled: !source.enabled }),
      });
      await refreshAutomationData();
    } catch (error) {
      setSourceNotice(error instanceof Error ? error.message : "No se pudo cambiar el estado de la fuente.");
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setProfileSaving(true);
    setProfileNotice("");
    try {
      const result = await apiRequest<{ profile: CandidateProfile }>("/api/profile", session, {
        method: "PUT",
        body: JSON.stringify(profileFromForm(profileForm)),
      });
      setProfile(result.profile);
      setProfileForm(profileToForm(result.profile));
      setProfileNotice("Perfil guardado en Supabase.");
    } catch (error) {
      setProfileNotice(error instanceof Error ? error.message : "No se pudo guardar el perfil.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function submitOffer(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setProcessing(true);
    setOfferError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        offerId: string;
        duplicate: boolean;
        status: string;
        match: MatchData;
        cv: { id: string; version: number; fileName: string };
      }>("/api/offers/process", session, { method: "POST", body: JSON.stringify(offerForm) });
      setNotice(result.duplicate
        ? "Esta oferta ya estaba procesada; se conservó el CV existente y no se creó un duplicado."
        : `CV ${result.cv.fileName} generado y guardado de forma privada.`);
      await refreshOffers();
      if (!result.duplicate) {
        setOfferForm({ title: "", company: "", sourceUrl: "", location: "", workMode: "Unknown", postedAt: "", description: "" });
      }
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "No se pudo procesar la oferta.");
      await refreshOffers().catch(() => undefined);
    } finally {
      setProcessing(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (!supabaseConfigured || !supabase) return <SetupNotice />;
  if (!authReady) return <main className="auth-page"><p>Cargando sesión…</p></main>;
  if (!session) return <AuthPanel onSignedIn={setSession} />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top"><span className="brand-mark">JS</span><span>Job Search Agent<small>FASE 1 · MVP</small></span></a>
        <div className="account"><span>{email}</span><button className="text-button" onClick={() => void signOut()}>Cerrar sesión</button></div>
      </header>
      <main id="top" className="dashboard">
        <section className="welcome-row">
          <div><span className="eyebrow">PANEL PERSONAL</span><h1>Una oferta clara. Una postulación mejor preparada.</h1><p>Importá una oportunidad, revisá el encaje real y generá un CV PDF específico con tu información validada.</p></div>
          <div className={`profile-state ${profileComplete ? "is-ready" : "is-incomplete"}`}><span className="state-dot" />{profileComplete ? "Perfil listo" : "Completá tu perfil"}</div>
        </section>
        {notice && <p className="notice notice-success" role="status">{notice}</p>}
        {dashboardLoading && <p className="loading-line">Cargando perfil y ofertas…</p>}

        <section className="panel automation-panel">
          <div className="panel-heading"><div><span className="eyebrow">BÚSQUEDA AUTOMÁTICA</span><h2>Encontrar oportunidades</h2></div><button className="primary-button" onClick={() => void searchNow()} disabled={searching || dashboardLoading || !profileComplete}>{searching ? "Consultando portales…" : "Buscar ahora"}</button></div>
          <p className="form-hint">Consulta feeds públicos de Greenhouse, Lever y Ashby, filtra por perfil y ubicación, y genera PDFs para nuevas ofertas compatibles. No envía postulaciones.</p>
          {!profileComplete && <p className="notice">Completá tu nombre y habilidades antes de buscar.</p>}
          <div className="metric-grid">
            <div><strong>{searchResult?.jobsNew ?? runs[0]?.jobs_new ?? 0}</strong><span>Ofertas nuevas</span></div>
            <div><strong>{offers.length}</strong><span>Relevantes</span></div>
            <div><strong>{offers.reduce((total, offer) => total + offer.cvVersions.length, 0)}</strong><span>CV ATS listos</span></div>
            <div><strong>{offers.filter((offer) => offer.applicationStatus !== "SENT").length}</strong><span>Pendientes</span></div>
            <div><strong>{offers.filter((offer) => offer.applicationStatus === "SENT").length}</strong><span>Postulaciones enviadas</span></div>
            <div><strong>{runs.filter((run) => run.status === "FAILED" || run.status === "PARTIAL").length}</strong><span>Ejecuciones con errores</span></div>
          </div>
          {searchResult && <div className={`run-result run-${searchResult.status.toLowerCase()}`}>
            <strong>{searchResult.jobsFetched} publicaciones consultadas · {searchResult.duplicateCount} duplicadas reconocidas · {searchResult.jobsDiscarded} descartes</strong>
            {Object.keys(searchResult.discardReasons).length > 0 && <ul>{Object.entries(searchResult.discardReasons).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul>}
            {searchResult.errors.map((error) => <p key={error}>{error}</p>)}
          </div>}
          <details className="automation-history"><summary>Historial de búsqueda ({runs.length})</summary>
            {runs.length === 0 ? <p className="form-hint">Todavía no se ejecutó ninguna búsqueda.</p> : <ul>{runs.slice(0, 10).map((run) => {
              const sources = Array.isArray(run.details.sources) ? run.details.sources as Array<Record<string, unknown>> : [];
              const filters = run.details.filters && typeof run.details.filters === "object" ? run.details.filters as Record<string, unknown> : {};
              const reasons = filters.discardReasons && typeof filters.discardReasons === "object" ? filters.discardReasons as Record<string, number> : {};
              const errors = Array.isArray(filters.processingErrors) ? filters.processingErrors as Array<Record<string, unknown>> : [];
              return <li key={run.id}><span><strong>{run.status}</strong> · {new Date(run.started_at).toLocaleString("es-AR")} · {run.jobs_new} nuevas / {run.jobs_fetched} consultadas
                <details><summary>Fuentes y motivos</summary><ul>{sources.map((source, index) => <li key={`${String(source.sourceId)}-${index}`}>{String(source.company ?? source.provider)}: {String(source.fetched ?? 0)} avisos{source.error ? ` · ${String(source.error)}` : ""}</li>)}</ul>
                  {Object.keys(reasons).length > 0 && <p>Descartes: {Object.entries(reasons).map(([reason, count]) => `${reason} (${count})`).join("; ")}</p>}
                  {errors.map((error, index) => <p key={index}>{String(error.offer ?? "Oferta")}: {String(error.error ?? "Error")}</p>)}
                </details>
              </span><small>{run.sources_failed ? `${run.sources_failed} fuentes con error` : "Sin errores de fuente"}</small></li>;
            })}</ul>}
          </details>
        </section>

        <section className="panel sources-panel">
          <div className="panel-heading"><div><span className="eyebrow">CATÁLOGO DE FUENTES</span><h2>Portales consultados</h2></div><button className="text-button compact" onClick={() => { setEditingSourceId(""); setSourceForm({ provider: "greenhouse", companyName: "", boardToken: "", region: "global", enabled: true }); setShowSourceForm(!showSourceForm); }}>{showSourceForm ? "Cerrar formulario" : "Agregar portal"}</button></div>
          <div className="source-list">{sources.map((source) => <div className="source-row" key={source.id}>
            <div><strong>{source.company_name}</strong><span>{source.provider} · {source.board_token} · {source.last_status === "OK" ? "Conectado" : source.last_status === "ERROR" ? "Error" : "Sin consultar"}</span>{source.last_error && <small>{source.last_error}</small>}</div>
            <div className="source-actions"><button className="text-button compact" onClick={() => startSourceEdit(source)}>Editar</button><button className="text-button compact" onClick={() => void toggleSource(source)}>{source.enabled ? "Pausar" : "Activar"}</button></div>
          </div>)}</div>
          {showSourceForm && <form className="stack-form source-form" onSubmit={saveSource}>
            <div className="form-grid">
              <label>Proveedor<select value={sourceForm.provider} onChange={(event) => setSourceForm({ ...sourceForm, provider: event.target.value as JobSource["provider"] })}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select></label>
              <label>Empresa<input required maxLength={160} value={sourceForm.companyName} onChange={(event) => setSourceForm({ ...sourceForm, companyName: event.target.value })} /></label>
              <label>Identificador del portal<input required maxLength={100} value={sourceForm.boardToken} onChange={(event) => setSourceForm({ ...sourceForm, boardToken: event.target.value })} placeholder="por ejemplo, empresa-tech" /></label>
              <label>Región<select value={sourceForm.region} onChange={(event) => setSourceForm({ ...sourceForm, region: event.target.value as JobSource["region"] })}><option value="global">Global</option><option value="eu">Europa (Lever)</option></select></label>
            </div>
            {sourceNotice && <p className="notice" role="status">{sourceNotice}</p>}
            <button className="primary-button" disabled={sourceSaving}>{sourceSaving ? "Guardando…" : editingSourceId ? "Guardar cambios" : "Agregar portal"}</button>
          </form>}
          <p className="form-hint">Los portales iniciales responden con avisos públicos activos. LinkedIn no se consulta porque no hay un feed autorizado gratuito disponible en esta integración.</p>
        </section>

        <section className="profile-layout">
          <div className="panel offer-panel" hidden>
            <div className="panel-heading"><div><span className="eyebrow">INGRESO MANUAL</span><h2>Procesar una oferta</h2></div><button className="text-button compact" onClick={() => setShowOfferForm(!showOfferForm)}>{showOfferForm ? "Ocultar" : "Nueva oferta"}</button></div>
            {showOfferForm && <form onSubmit={submitOffer} className="stack-form offer-form">
              <div className="form-grid">
                <label>Puesto <input maxLength={240} value={offerForm.title} onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })} placeholder="Backend Developer Jr." /></label>
                <label>Empresa <input maxLength={240} value={offerForm.company} onChange={(event) => setOfferForm({ ...offerForm, company: event.target.value })} placeholder="Nombre de la empresa" /></label>
                <label>URL original <input type="url" value={offerForm.sourceUrl} onChange={(event) => setOfferForm({ ...offerForm, sourceUrl: event.target.value })} placeholder="https://…" /></label>
                <label>Ubicación <input value={offerForm.location} onChange={(event) => setOfferForm({ ...offerForm, location: event.target.value })} placeholder="Córdoba, remoto Argentina" /></label>
                <label>Modalidad <select value={offerForm.workMode} onChange={(event) => setOfferForm({ ...offerForm, workMode: event.target.value })}><option>Unknown</option><option>Remoto</option><option>Híbrido</option><option>Presencial</option></select></label>
                <label>Fecha publicada <input type="date" value={offerForm.postedAt} onChange={(event) => setOfferForm({ ...offerForm, postedAt: event.target.value })} /></label>
              </div>
              <label>Descripción completa <textarea required minLength={20} maxLength={30000} rows={8} value={offerForm.description} onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })} placeholder="Pegá acá la descripción o el texto público de la oferta." /></label>
              <p className="form-hint">Si dejás el puesto vacío, se toma la primera línea del texto. Para evitar scraping, pegá la descripción; la URL se conserva como fuente.</p>
              {offerError && <p className="notice notice-error" role="alert">{offerError}</p>}
              <button className="primary-button" disabled={processing || dashboardLoading}>{processing ? "Analizando y generando PDF…" : "Analizar y generar CV ATS"}</button>
            </form>}
          </div>

          <div className="panel profile-panel">
            <div className="panel-heading"><div><span className="eyebrow">DATOS PRIVADOS</span><h2>Perfil profesional</h2></div><button className="text-button compact" onClick={() => setShowProfile(!showProfile)}>{showProfile ? "Cerrar" : "Editar"}</button></div>
            {!showProfile ? <div className="profile-summary">
              <strong>{profile.fullName || "Sin nombre"}</strong><span>{profile.headline || "Agregá un titular profesional"}</span>
              <span>{profile.location || "Ubicación sin informar"}</span><span>{profile.skills.length} habilidades · {profile.projects.length} proyectos · {profile.experience.length} experiencias</span>
              {profile.contactEmail && <span>{profile.contactEmail}</span>}
            </div> : <form className="stack-form profile-form" onSubmit={saveProfile}>
              <div className="form-grid">
                <label>Nombre completo<input required value={profileForm.fullName} onChange={(event) => setProfileForm({ ...profileForm, fullName: event.target.value })} /></label>
                <label>Titular profesional<input value={profileForm.headline} onChange={(event) => setProfileForm({ ...profileForm, headline: event.target.value })} /></label>
                <label>Ubicación<input value={profileForm.location} onChange={(event) => setProfileForm({ ...profileForm, location: event.target.value })} /></label>
                <label>Inglés<input value={profileForm.englishLevel} onChange={(event) => setProfileForm({ ...profileForm, englishLevel: event.target.value })} placeholder="B2" /></label>
                <label>Email<input type="email" value={profileForm.contactEmail} onChange={(event) => setProfileForm({ ...profileForm, contactEmail: event.target.value })} /></label>
                <label>Teléfono<input value={profileForm.contactPhone} onChange={(event) => setProfileForm({ ...profileForm, contactPhone: event.target.value })} /></label>
                <label>LinkedIn<input type="url" value={profileForm.linkedin} onChange={(event) => setProfileForm({ ...profileForm, linkedin: event.target.value })} /></label>
                <label>GitHub<input type="url" value={profileForm.github} onChange={(event) => setProfileForm({ ...profileForm, github: event.target.value })} /></label>
              </div>
              <label>Formación <textarea rows={2} value={profileForm.education} onChange={(event) => setProfileForm({ ...profileForm, education: event.target.value })} placeholder="Institución | Título | Estado, una por línea" /></label>
              <label>Experiencia <textarea rows={4} value={profileForm.experience} onChange={(event) => setProfileForm({ ...profileForm, experience: event.target.value })} placeholder="Empresa | Puesto | AAAA-MM inicio | AAAA-MM fin | Responsabilidad 1; Responsabilidad 2" /></label>
              <label>Habilidades <textarea rows={7} value={profileForm.skills} onChange={(event) => setProfileForm({ ...profileForm, skills: event.target.value })} placeholder="Categoría | Tecnología | Nivel | Contexto | Evidencia | Validación, una por línea" /></label>
              <label>Proyectos <textarea rows={4} value={profileForm.projects} onChange={(event) => setProfileForm({ ...profileForm, projects: event.target.value })} placeholder="Nombre | Descripción | URL repo | Demo | Tecnologías separadas por coma" /></label>
              <p className="form-hint">En el perfil inicial no hay niveles de dominio ni stacks de proyecto verificados, así que aparecen como “Not specified”.</p>
              {profileNotice && <p className={profileNotice.startsWith("Perfil") ? "notice notice-success" : "notice notice-error"} role="status">{profileNotice}</p>}
              <button className="primary-button" disabled={profileSaving}>{profileSaving ? "Guardando…" : "Guardar perfil"}</button>
            </form>}
          </div>
        </section>

        <section className="offers-section">
          <div className="section-title"><div><span className="eyebrow">HISTORIAL</span><h2>Ofertas procesadas</h2></div><span className="count-pill">{offers.length}</span></div>
          {offers.length === 0 && !dashboardLoading ? <div className="empty-state"><strong>Todavía no hay ofertas.</strong><p>Agregá una descripción manual para ver compatibilidad, CVs y eventos en este panel.</p></div> : (
            <div className="offer-list">{offers.map((offer) => <OfferCard key={offer.id} offer={offer} session={session} onApplicationChange={refreshOffers} />)}</div>
          )}
        </section>

        <details className="discarded-section">
          <summary>Ver ofertas descartadas y motivos ({discardedOffers.length})</summary>
          {discardedOffers.length === 0 ? <p className="form-hint">Todavía no hay ofertas descartadas guardadas.</p> : <div className="offer-list">{discardedOffers.map((offer) => <OfferCard key={offer.id} offer={offer} session={session} onApplicationChange={refreshOffers} />)}</div>}
        </details>

        <details className="manual-details">
          <summary>Ingresar oferta manualmente</summary>
          <p className="form-hint">Alternativa para publicaciones sin feed público autorizado.</p>
          <button className="text-button compact" onClick={() => setShowOfferForm(!showOfferForm)}>{showOfferForm ? "Ocultar formulario" : "Abrir formulario"}</button>
          {showOfferForm && <form onSubmit={submitOffer} className="stack-form offer-form">
            <div className="form-grid">
              <label>Puesto <input maxLength={240} value={offerForm.title} onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })} placeholder="Backend Developer Jr." /></label>
              <label>Empresa <input maxLength={240} value={offerForm.company} onChange={(event) => setOfferForm({ ...offerForm, company: event.target.value })} placeholder="Nombre de la empresa" /></label>
              <label>URL original <input type="url" value={offerForm.sourceUrl} onChange={(event) => setOfferForm({ ...offerForm, sourceUrl: event.target.value })} placeholder="https://..." /></label>
              <label>Ubicación <input value={offerForm.location} onChange={(event) => setOfferForm({ ...offerForm, location: event.target.value })} placeholder="Córdoba, remoto Argentina" /></label>
              <label>Modalidad <select value={offerForm.workMode} onChange={(event) => setOfferForm({ ...offerForm, workMode: event.target.value })}><option>Unknown</option><option>Remoto</option><option>Híbrido</option><option>Presencial</option></select></label>
              <label>Fecha publicada <input type="date" value={offerForm.postedAt} onChange={(event) => setOfferForm({ ...offerForm, postedAt: event.target.value })} /></label>
            </div>
            <label>Descripción completa <textarea required minLength={20} maxLength={30000} rows={8} value={offerForm.description} onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })} /></label>
            {offerError && <p className="notice notice-error" role="alert">{offerError}</p>}
            <button className="primary-button" disabled={processing || dashboardLoading}>{processing ? "Analizando y generando PDF…" : "Analizar y generar CV ATS"}</button>
          </form>}
        </details>

        <footer className="page-footer"><span>Fase 1 · ofertas manuales · matching local · PDF ATS · almacenamiento privado</span><span>Un CV generado no significa que la postulación haya sido enviada.</span></footer>
      </main>
    </div>
  );
}
