import { useState, useEffect, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// API calls go through Netlify function proxy (netlify/functions/claude.js)
// Add ANTHROPIC_API_KEY to Netlify environment variables (no VITE_ prefix needed)

const KEYS = {
  profile: "shadowceo_profile",
  sys: "shadowceo_sys",
  advisor: "shadowceo_advisor",
  sessions: "shadowceo_sessions",
};

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const INTERVIEW_SYS = `You are conducting a deep onboarding interview for the AI Shadow CEO platform. Ask questions across 5 areas in order: identity, ventures, finances, goals, mindset. ONE question per response. Short responses only. Acknowledge in 1 sentence then ask next question. After ~20 exchanges output ONBOARDING_COMPLETE then JSON.

JSON format:
{"name":"","age":null,"background":"","currentSituation":"","ventures":[{"name":"","type":"","stage":"","description":"","revenue":"$0","goals":"","blockers":"","nextAction":""}],"finances":{"monthlyIncome":"","monthlyExpenses":"","savings":"","budgetStructure":"","financialGoals":""},"goals":{"90day":["","",""],"12month":["","",""],"longTerm":""},"mindset":{"strengths":["",""],"challenges":["",""],"workStyle":"","biggestFear":"","whatTheyNeed":""},"shadowCEOInstructions":""}`;

const buildSys = (p, sessionSummaries) => {
  const memory = sessionSummaries?.length > 0
    ? `\n\nPAST SESSION MEMORY (${sessionSummaries.length} previous sessions):\n${sessionSummaries.map((s, i) => `Session ${i + 1} (${s.date}): ${s.summary}`).join("\n")}`
    : "";
  return `You are the AI Shadow CEO for ${p.name}${p.age ? `, age ${p.age}` : ""}.

WHO THEY ARE: ${p.background}
CURRENT SITUATION: ${p.currentSituation}

VENTURES:
${p.ventures.map((v, i) => `${i + 1}. ${v.name} (${v.type}, ${v.stage})
   What: ${v.description} | Revenue: ${v.revenue}
   Goal: ${v.goals} | Blocker: ${v.blockers} | Next: ${v.nextAction}`).join("\n\n")}

FINANCES: Income ${p.finances.monthlyIncome} | Expenses ${p.finances.monthlyExpenses} | Savings ${p.finances.savings}
Budget: ${p.finances.budgetStructure} | Goal: ${p.finances.financialGoals}

GOALS:
90 days: ${p.goals["90day"].join(", ")}
12 months: ${p.goals["12month"].join(", ")}
Long-term: ${p.goals.longTerm}

MINDSET: Strengths: ${p.mindset.strengths.join(", ")} | Challenges: ${p.mindset.challenges.join(", ")}
Work style: ${p.mindset.workStyle} | Fear: ${p.mindset.biggestFear} | Needs: ${p.mindset.whatTheyNeed}

HOW TO SHOW UP: ${p.shadowCEOInstructions}${memory}

YOUR ROLE: You are ${p.name}'s sharpest, most trusted strategic partner. You remember everything from past sessions. You get smarter every conversation. Be direct, specific, honest. Never generic.`;
};

const STAGES = ["You", "Ventures", "Finances", "Goals", "Mindset"];

const FALLBACK_PROFILE = {
  name: "You", age: null,
  background: "An entrepreneur building multiple ventures simultaneously.",
  currentSituation: "Building while employed full-time.",
  ventures: [{ name: "Primary Venture", type: "Business", stage: "building", description: "Described during onboarding", revenue: "$0", goals: "Revenue and growth", blockers: "Time and capital", nextAction: "Identify highest leverage action" }],
  finances: { monthlyIncome: "TBD", monthlyExpenses: "TBD", savings: "TBD", budgetStructure: "TBD", financialGoals: "Financial freedom" },
  goals: { "90day": ["Build momentum", "First revenue", "Establish systems"], "12month": ["Scale ventures", "Hit targets", "Build audience"], longTerm: "Build lasting wealth through entrepreneurship" },
  mindset: { strengths: ["Vision", "Resilience"], challenges: ["Time", "Focus"], workStyle: "Self-directed and driven", biggestFear: "Not reaching full potential", whatTheyNeed: "Strategic accountability" },
  shadowCEOInstructions: "Be direct and strategic. Prioritize ruthlessly. Hold accountable. Celebrate wins."
};

// ─── STORAGE (localStorage for deployed app) ──────────────────────────────────
const store = {
  save: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  load: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  del: (key) => { try { localStorage.removeItem(key); } catch {} },
};

// ─── API ──────────────────────────────────────────────────────────────────────
async function askClaude(messages, system, maxTokens) {
  const r = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages })
  });
  if (!r.ok) throw new Error(r.status);
  const d = await r.json();
  const t = d?.content?.[0]?.text;
  if (!t) throw new Error("empty");
  return t;
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("loading");
  const [displayed, setDisplayed] = useState([]);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const [bldPct, setBldPct] = useState(0);
  const [bldLabel, setBldLabel] = useState("");
  const [profile, setProfile] = useState(null);
  const [dashSys, setDashSys] = useState("");
  const [tab, setTab] = useState("brief");
  const [convoDisplayed, setConvoDisplayed] = useState([]);
  const [advisorInput, setAdvisorInput] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [openV, setOpenV] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [returningUser, setReturningUser] = useState(false);

  const historyRef = useRef([]);
  const convoRef = useRef([]);
  const isSending = useRef(false);
  const chatEnd = useRef(null);
  const advisorEnd = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [displayed, loading]);
  useEffect(() => { advisorEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [convoDisplayed, advisorLoading]);
  useEffect(() => { setStageIdx(turnCount < 5 ? 0 : turnCount < 10 ? 1 : turnCount < 15 ? 2 : turnCount < 19 ? 3 : 4); }, [turnCount]);

  useEffect(() => {
    const savedProfile = store.load(KEYS.profile);
    const savedSys = store.load(KEYS.sys);
    const savedAdvisor = store.load(KEYS.advisor);
    const savedSessions = store.load(KEYS.sessions) || [];

    if (savedProfile && savedSys) {
      setProfile(savedProfile);
      setDashSys(savedSys);
      setSessions(savedSessions);
      setReturningUser(true);
      if (savedAdvisor?.length > 0) {
        convoRef.current = savedAdvisor;
        setConvoDisplayed(savedAdvisor);
      } else {
        const welcome = { role: "assistant", content: `Welcome back, ${savedProfile.name}.\n\nI remember everything. Your ventures, your goals, your last session. What do you need to work through today?` };
        convoRef.current = [welcome];
        setConvoDisplayed([welcome]);
      }
      setPhase("dashboard");
    } else {
      setPhase("welcome");
    }
  }, []);

  useEffect(() => {
    if (convoDisplayed.length > 0 && phase === "dashboard") {
      store.save(KEYS.advisor, convoDisplayed);
    }
  }, [convoDisplayed, phase]);

  async function startInterview() {
    setPhase("interview");
    setLoading(true);
    historyRef.current = [];
    try {
      const text = await askClaude([{ role: "user", content: "Begin the onboarding. One warm sentence then your first question." }], INTERVIEW_SYS, 150);
      const firstMsg = { role: "assistant", content: text };
      historyRef.current = [firstMsg];
      setDisplayed([firstMsg]);
    } catch {
      const firstMsg = { role: "assistant", content: "Let's build your profile — one question at a time.\n\nFirst: What's your name, and in one sentence, what are you building?" };
      historyRef.current = [firstMsg];
      setDisplayed([firstMsg]);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (isSending.current || loading || !inputVal.trim()) return;
    isSending.current = true;
    const userText = inputVal.trim();
    setInputVal("");
    setLoading(true);
    const userMsg = { role: "user", content: userText };
    historyRef.current = [...historyRef.current, userMsg];
    setDisplayed([...historyRef.current]);
    setTurnCount(n => n + 1);
    try {
      const reply = await askClaude(historyRef.current.map(m => ({ role: m.role, content: m.content })), INTERVIEW_SYS, 400);
      if (reply.includes("ONBOARDING_COMPLETE")) {
        const doneMsg = { role: "assistant", content: "I have everything I need. Building your Shadow CEO profile now..." };
        historyRef.current = [...historyRef.current, doneMsg];
        setDisplayed([...historyRef.current]);
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        let prof = null;
        if (jsonMatch) { try { prof = JSON.parse(jsonMatch[0]); } catch {} }
        if (!prof) {
          try {
            const r2 = await askClaude([...historyRef.current.map(m => ({ role: m.role, content: m.content })), { role: "user", content: "Output ONBOARDING_COMPLETE then the JSON profile." }], INTERVIEW_SYS, 2000);
            const m2 = r2.match(/\{[\s\S]*\}/);
            if (m2) prof = JSON.parse(m2[0]);
          } catch {}
        }
        startBuild(prof || FALLBACK_PROFILE);
      } else {
        const aiMsg = { role: "assistant", content: reply };
        historyRef.current = [...historyRef.current, aiMsg];
        setDisplayed([...historyRef.current]);
      }
    } catch {
      const errMsg = { role: "assistant", content: "Connection issue — please try again." };
      historyRef.current = [...historyRef.current, errMsg];
      setDisplayed([...historyRef.current]);
    }
    setLoading(false);
    isSending.current = false;
  }

  function startBuild(prof) {
    store.save(KEYS.profile, prof);
    setProfile(prof);
    const savedSessions = store.load(KEYS.sessions) || [];
    const sys = buildSys(prof, savedSessions);
    store.save(KEYS.sys, sys);
    setDashSys(sys);
    setSessions(savedSessions);
    setPhase("building");
    const steps = ["Mapping your ventures", "Analyzing finances", "Calibrating goals", "Building mindset profile", "Generating strategy layer", "Activating Shadow CEO"];
    let i = 0;
    const iv = setInterval(() => {
      setBldLabel(steps[i]); setBldPct(Math.round(((i + 1) / steps.length) * 100)); i++;
      if (i >= steps.length) {
        clearInterval(iv);
        setTimeout(() => {
          const welcome = { role: "assistant", content: `${prof.name}, your Shadow CEO is online.\n\nI know your ventures, your finances, and how you operate. I get sharper every time we talk.\n\nWhat do you need to think through today?` };
          convoRef.current = [welcome];
          setConvoDisplayed([welcome]);
          setPhase("dashboard");
        }, 600);
      }
    }, 650);
  }

  async function saveCurrentSession() {
    if (convoRef.current.length <= 1) return;
    try {
      const summary = await askClaude(
        [{ role: "user", content: `Summarize this conversation in 2-3 sentences: ${convoRef.current.map(m => `${m.role}: ${m.content}`).join("\n")}` }],
        "Summarize concisely. Output only the summary.", 150
      );
      const newSession = { date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), timestamp: Date.now(), summary, messages: convoRef.current };
      const updated = [...sessions, newSession].slice(-20);
      setSessions(updated);
      store.save(KEYS.sessions, updated);
      if (profile) { const sys = buildSys(profile, updated); setDashSys(sys); store.save(KEYS.sys, sys); }
    } catch {}
  }

  async function startNewSession() {
    await saveCurrentSession();
    const welcome = { role: "assistant", content: `Back again, ${profile?.name}.\n\nI remember everything from our previous sessions. What are we tackling today?` };
    convoRef.current = [welcome];
    setConvoDisplayed([welcome]);
    store.save(KEYS.advisor, [welcome]);
    setShowHistory(false);
  }

  function resetAll() {
    [KEYS.profile, KEYS.sys, KEYS.advisor, KEYS.sessions].forEach(k => store.del(k));
    setProfile(null); setDashSys(""); setSessions([]); historyRef.current = []; convoRef.current = [];
    setDisplayed([]); setConvoDisplayed([]); setBrief(null); setTurnCount(0); setPhase("welcome");
  }

  async function sendAdvisor() {
    if (!advisorInput.trim() || advisorLoading) return;
    const text = advisorInput.trim(); setAdvisorInput(""); setAdvisorLoading(true);
    const userMsg = { role: "user", content: text };
    convoRef.current = [...convoRef.current, userMsg];
    setConvoDisplayed([...convoRef.current]);
    try {
      const reply = await askClaude(convoRef.current.map(m => ({ role: m.role, content: m.content })), dashSys, 700);
      const aiMsg = { role: "assistant", content: reply };
      convoRef.current = [...convoRef.current, aiMsg];
      setConvoDisplayed([...convoRef.current]);
    } catch {
      const errMsg = { role: "assistant", content: "Connection issue — try again." };
      convoRef.current = [...convoRef.current, errMsg];
      setConvoDisplayed([...convoRef.current]);
    }
    setAdvisorLoading(false);
  }

  async function genBrief() {
    setBriefLoading(true);
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    try {
      const r = await askClaude([{ role: "user", content: `Strategic brief for ${today}. Raw JSON only:\n{"headline":"","focus":"","priorities":["","",""],"insight":"","question":"","warning":""}` }], dashSys, 600);
      setBrief(JSON.parse(r.replace(/```json|```/g, "").trim()));
    } catch {
      setBrief({ headline: "Clarity before speed — know your one move today.", focus: "Your most urgent lever is closest to revenue. Find it, do that first.", priorities: ["Identify highest-leverage action", "2 hours of protected deep work", "One outreach to client or partner"], insight: "Most entrepreneurs spread energy equally. Find the one move that advances multiple goals.", question: "If you could only make one call today — who is it?", warning: "Don't let urgent crowd out important. Schedule deep work first." });
    }
    setBriefLoading(false);
  }

  const Bubble = ({ m }) => (
    <div style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 9, alignItems: "flex-end" }}>
      {m.role === "assistant" && <div style={s.av}>⬡</div>}
      <div style={{ ...s.bub, background: m.role === "user" ? "#C9A84C" : "rgba(255,255,255,0.07)", color: m.role === "user" ? "#000" : "#fff", borderRadius: m.role === "user" ? "20px 20px 5px 20px" : "20px 20px 20px 5px", fontWeight: m.role === "user" ? 500 : 400 }}>{m.content}</div>
    </div>
  );
  const Typing = () => (
    <div style={{ display: "flex", justifyContent: "flex-start", gap: 9, alignItems: "flex-end" }}>
      <div style={s.av}>⬡</div>
      <div style={{ ...s.bub, background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}><span style={s.dots}>···</span></div>
    </div>
  );

  if (phase === "loading") return <div style={{ ...s.root, alignItems: "center", justifyContent: "center", gap: 12 }}><div style={{ fontSize: 44, color: "#C9A84C", animation: "pulse 1.4s ease-in-out infinite" }}>⬡</div><style>{css}</style></div>;

  if (phase === "welcome") return (
    <div style={s.root}>
      <div style={s.page}>
        <div style={s.glow} />
        <div style={{ textAlign: "center", paddingTop: 10 }}>
          <div style={s.hexBig}>⬡</div>
          <div style={s.brand}>SHADOW CEO</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}>Your AI business partner. Built around you.</div>
        </div>
        <div style={s.card}>
          <p style={{ fontSize: 17, fontWeight: 600, color: "#fff", lineHeight: 1.55, marginBottom: 12 }}>Before I can run alongside you, I need to <em>know</em> you.</p>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.56)", lineHeight: 1.7, marginBottom: 16 }}>I'll ask about your ventures, finances, goals, and how you operate. The more depth you give me, the sharper I become.</p>
          <div style={s.chip}>⏱ 8–12 minutes · One time only</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["Your ventures & current metrics", "Financial structure & goals", "90-day and 12-month targets", "How you think and operate", "Your long-term vision"].map(t => (
              <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 12, color: "#C9A84C", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <button onClick={startInterview} style={s.startBtn}>Begin Onboarding →</button>
        <p style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.17)" }}>Your data is saved locally to your device</p>
      </div>
      <style>{css}</style>
    </div>
  );

  if (phase === "interview") return (
    <div style={s.root}>
      <div style={s.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: 2 }}>⬡ SHADOW CEO</span>
          <span style={{ color: "rgba(255,255,255,0.2)" }}> · </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Onboarding</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#fff", fontWeight: 600, background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "5px 12px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C896", display: "inline-block" }} />{STAGES[stageIdx]}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", padding: "12px 18px 8px", flexShrink: 0 }}>
        {STAGES.map((st, i) => (
          <div key={st} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: i < stageIdx ? "#C9A84C" : i === stageIdx ? "#fff" : "rgba(255,255,255,0.13)", boxShadow: i === stageIdx ? "0 0 10px rgba(255,255,255,0.4)" : "none" }} />
            <div style={{ fontSize: 10, color: i === stageIdx ? "#fff" : i < stageIdx ? "#C9A84C" : "rgba(255,255,255,0.2)", fontWeight: i === stageIdx ? 700 : 400 }}>{st}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 2, background: "rgba(255,255,255,0.06)", margin: "0 18px", borderRadius: 1, overflow: "hidden", flexShrink: 0 }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg,#C9A84C,#FFE08A)", width: `${Math.min(100, (turnCount / 22) * 100)}%`, transition: "width 0.4s ease" }} />
      </div>
      <div style={s.chatArea}>
        {displayed.map((m, i) => <Bubble key={i} m={m} />)}
        {loading && <Typing />}
        <div ref={chatEnd} />
      </div>
      <div style={{ padding: "10px 16px 6px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 10, background: "#07090E", flexShrink: 0 }}>
        <textarea value={inputVal} onChange={e => setInputVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Your answer..." rows={2} style={s.textarea} />
        <button onClick={sendMessage} disabled={loading || !inputVal.trim()} style={{ ...s.sendBtn, opacity: loading || !inputVal.trim() ? 0.35 : 1 }}>↑</button>
      </div>
      <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.16)", padding: "4px 0 10px", flexShrink: 0 }}>Shift+Enter for new line</div>
      <style>{css}</style>
    </div>
  );

  if (phase === "building") return (
    <div style={s.root}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 40 }}>
        <div style={{ fontSize: 44, color: "#C9A84C", animation: "pulse 1.4s ease-in-out infinite" }}>⬡</div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, textAlign: "center" }}>Building Your Shadow CEO</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>{bldLabel}</div>
        <div style={{ width: "75%", height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg,#C9A84C,#FFE08A)", width: `${bldPct}%`, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontSize: 13, color: "#C9A84C", fontWeight: 700 }}>{bldPct}%</div>
      </div>
      <style>{css}</style>
    </div>
  );

  if (phase === "dashboard" && profile) return (
    <div style={s.root}>
      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 100, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800 }}>Past Sessions</div>
            <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 22, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {sessions.length === 0
              ? <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14, marginTop: 40 }}>No past sessions yet. Start chatting and your sessions will be saved here.</div>
              : [...sessions].reverse().map((sess, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700, color: "#C9A84C", marginBottom: 6 }}>{sess.date}</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{sess.summary}</div>
                </div>
              ))
            }
          </div>
          <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 10 }}>
            <button onClick={startNewSession} style={{ flex: 1, background: "#C9A84C", color: "#000", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'Syne',sans-serif" }}>Start New Session</button>
            <button onClick={resetAll} style={{ background: "rgba(255,60,60,0.15)", color: "rgba(255,100,100,0.8)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 12, padding: "13px 16px", fontSize: 12, cursor: "pointer" }}>Reset All</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, color: "#C9A84C" }}>⬡</span>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, letterSpacing: 2, color: "#C9A84C" }}>SHADOW CEO</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.26)" }}>{profile.name}'s OS · {sessions.length > 0 ? `${sessions.length} sessions` : "Session 1"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setShowHistory(true)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "5px 12px", fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>History</button>
          <div style={{ fontSize: 11, color: "#00C896", fontWeight: 700, letterSpacing: 1 }}>● LIVE</div>
        </div>
      </div>

      {returningUser && sessions.length > 0 && (
        <div style={{ background: "rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.15)", padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "rgba(201,168,76,0.8)" }}>📚 {sessions.length} past session{sessions.length !== 1 ? "s" : ""} loaded into memory</div>
          <button onClick={() => setReturningUser(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        {[{ id: "brief", l: "Brief" }, { id: "ventures", l: "Ventures" }, { id: "advisor", l: "Advisor" }, { id: "profile", l: "Profile" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "13px 4px", fontSize: 13, fontWeight: 700, fontFamily: "'Syne',sans-serif", color: tab === t.id ? "#C9A84C" : "rgba(255,255,255,0.35)", borderBottom: tab === t.id ? "2px solid #C9A84C" : "2px solid transparent" }}>{t.l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "22px 18px 48px" }}>
        {tab === "brief" && (
          <div>
            <div style={s.sh}><div style={s.st}>Daily Brief</div><div style={s.ss}>AI-generated strategy for today</div></div>
            {!brief && !briefLoading && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 10, textAlign: "center" }}>
                <div style={{ fontSize: 44, color: "rgba(201,168,76,0.2)" }}>⬡</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>Ready to brief you</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.2)", lineHeight: 1.6, marginBottom: 8 }}>Personalized priorities built around your ventures{sessions.length > 0 ? ` and ${sessions.length} past sessions` : ""}.</div>
                <button onClick={genBrief} style={s.goldBtn}>Generate Today's Brief</button>
              </div>
            )}
            {briefLoading && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}><div style={{ fontSize: 44, animation: "pulse 1s ease-in-out infinite" }}>⬡</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, color: "rgba(255,255,255,0.3)" }}>Analyzing...</div></div>}
            {brief && !briefLoading && (
              <div style={s.stack}>
                <div style={{ background: "linear-gradient(135deg,rgba(201,168,76,0.13),rgba(201,168,76,0.04))", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 14, padding: 18 }}>
                  <div style={s.tag}>TODAY'S HEADLINE</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 700, color: "#FFE08A", lineHeight: 1.45 }}>"{brief.headline}"</div>
                </div>
                <div style={s.ic}><div style={s.tag}>🎯 PRIMARY FOCUS</div><div style={s.cb}>{brief.focus}</div></div>
                <div style={s.ic}><div style={s.tag}>⚡ TOP 3 PRIORITIES</div>{brief.priorities.map((p, i) => (<div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}><div style={{ width: 24, height: 24, borderRadius: "50%", background: "#C9A84C", color: "#000", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div><div style={{ fontSize: 14, color: "rgba(255,255,255,0.66)" }}>{p}</div></div>))}</div>
                <div style={s.ic}><div style={s.tag}>💡 STRATEGIC INSIGHT</div><div style={s.cb}>{brief.insight}</div></div>
                <div style={s.ic}><div style={s.tag}>🧠 SIT WITH THIS</div><div style={{ fontSize: 15, fontStyle: "italic", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>"{brief.question}"</div></div>
                <div style={{ ...s.ic, borderColor: "rgba(255,80,80,0.18)", background: "rgba(255,30,30,0.04)" }}><div style={{ ...s.tag, color: "rgba(255,130,130,0.5)" }}>⚠ STOP DOING</div><div style={s.cb}>{brief.warning}</div></div>
                <button onClick={genBrief} style={{ background: "transparent", color: "rgba(255,255,255,0.26)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", width: "100%", marginTop: 4 }}>↺ Refresh</button>
              </div>
            )}
          </div>
        )}

        {tab === "ventures" && (
          <div>
            <div style={s.sh}><div style={s.st}>Your Ventures</div><div style={s.ss}>{profile.ventures.length} in your portfolio</div></div>
            <div style={s.stack}>
              {profile.ventures.map((v, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 18, cursor: "pointer" }} onClick={() => setOpenV(openV === i ? null : i)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 3 }}>{v.name}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{v.type} · {v.stage}</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, color: "#C9A84C", fontWeight: 700, marginBottom: 4 }}>{v.revenue || "$0"}/mo</div><div style={{ color: "rgba(255,255,255,0.2)", fontSize: 20 }}>{openV === i ? "−" : "+"}</div></div>
                  </div>
                  {openV === i && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.52)", lineHeight: 1.65, marginBottom: 14 }}>{v.description}</div>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
                      <div style={{ marginBottom: 10 }}><div style={s.vlbl}>GOAL</div><div style={{ fontSize: 13, color: "rgba(255,255,255,0.56)", lineHeight: 1.5 }}>{v.goals}</div></div>
                      <div style={{ marginBottom: 10 }}><div style={s.vlbl}>BLOCKER</div><div style={{ fontSize: 13, color: "rgba(255,155,115,0.85)", lineHeight: 1.5 }}>{v.blockers}</div></div>
                      <div style={{ background: "rgba(201,168,76,0.07)", borderRadius: 8, padding: "10px 12px" }}><div style={s.vlbl}>NEXT ACTION</div><div style={{ fontSize: 13, color: "#C9A84C", fontWeight: 600, lineHeight: 1.5 }}>{v.nextAction}</div></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "advisor" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 175px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div><div style={s.st}>AI Shadow CEO</div><div style={s.ss}>Session {sessions.length + 1} · {sessions.length > 0 ? `${sessions.length} in memory` : "First session"}</div></div>
              <button onClick={startNewSession} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "6px 12px", fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>New Session</button>
            </div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 12, flexShrink: 0 }}>
              {["What should I focus on this week?", "Where am I losing momentum?", "How do I land my first client?", "Am I spreading too thin?", "Highest leverage move right now?"].map(q => (
                <button key={q} onClick={() => setAdvisorInput(q)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", padding: "8px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{q}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingBottom: 8 }}>
              {convoDisplayed.map((m, i) => <Bubble key={i} m={m} />)}
              {advisorLoading && <Typing />}
              <div ref={advisorEnd} />
            </div>
            <div style={{ display: "flex", gap: 10, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <input value={advisorInput} onChange={e => setAdvisorInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAdvisor()} placeholder="Ask your Shadow CEO..." style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "13px 15px", color: "#fff", fontSize: 15, outline: "none" }} />
              <button onClick={sendAdvisor} disabled={advisorLoading || !advisorInput.trim()} style={{ ...s.sendBtn, opacity: advisorLoading || !advisorInput.trim() ? 0.35 : 1 }}>↑</button>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div>
            <div style={s.sh}><div style={s.st}>Your Profile</div><div style={s.ss}>What your Shadow CEO knows about you</div></div>
            <div style={s.stack}>
              <div style={s.ic}><div style={s.tag}>IDENTITY</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#C9A84C", marginBottom: 10 }}>{profile.name}{profile.age ? `, ${profile.age}` : ""}</div><div style={s.cb}>{profile.background}</div></div>
              <div style={s.ic}><div style={s.tag}>GOALS</div>{[["Next 90 Days", profile.goals["90day"]], ["12 Months", profile.goals["12month"]]].map(([l, gs]) => (<div key={l}><div style={s.sublbl}>{l}</div>{gs.map((g, i) => <div key={i} style={{ fontSize: 13, color: "rgba(255,255,255,0.56)", lineHeight: 1.6, marginBottom: 5 }}>→ {g}</div>)}</div>))}<div style={s.sublbl}>Long-Term</div><div style={{ fontSize: 14, color: "#C9A84C", fontStyle: "italic", lineHeight: 1.6 }}>"{profile.goals.longTerm}"</div></div>
              <div style={s.ic}><div style={s.tag}>MINDSET</div>{[["Strengths", profile.mindset.strengths, "rgba(201,168,76,0.76)", "rgba(201,168,76,0.22)"], ["Challenges", profile.mindset.challenges, "rgba(255,148,128,0.78)", "rgba(255,110,90,0.28)"]].map(([l, items, col, bc]) => (<div key={l}><div style={s.sublbl}>{l}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>{items.map((t, i) => <span key={i} style={{ fontSize: 11, color: col, border: `1px solid ${bc}`, borderRadius: 20, padding: "4px 10px" }}>{t}</span>)}</div></div>))}<div style={s.sublbl}>Work Style</div><div style={s.cb}>{profile.mindset.workStyle}</div></div>
              <div style={s.ic}><div style={s.tag}>FINANCES</div>{[["Income", profile.finances.monthlyIncome], ["Expenses", profile.finances.monthlyExpenses], ["Savings", profile.finances.savings], ["Goal", profile.finances.financialGoals]].map(([l, v]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}><span style={{ fontSize: 12, color: "rgba(255,255,255,0.36)" }}>{l}</span><span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>{v}</span></div>))}</div>
              {sessions.length > 0 && <div style={s.ic}><div style={s.tag}>SESSION MEMORY</div><div style={s.cb}>{sessions.length} past session{sessions.length !== 1 ? "s" : ""} in memory. Your Shadow CEO gets smarter every conversation.</div><button onClick={() => setShowHistory(true)} style={{ marginTop: 12, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C9A84C", cursor: "pointer", width: "100%" }}>View Past Sessions →</button></div>}
            </div>
          </div>
        )}
      </div>
      <style>{css}</style>
    </div>
  );

  return null;
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,wght@0,400;0,500;1,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0}textarea{resize:none}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(201,168,76,0.2);border-radius:2px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.25}}
@keyframes blink{0%,100%{opacity:0.15}50%{opacity:1}}
`;

const s = {
  root: { minHeight: "100dvh", background: "#07090E", color: "#fff", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" },
  page: { flex: 1, display: "flex", flexDirection: "column", padding: "38px 22px 30px", gap: 20, minHeight: "100dvh", position: "relative", overflow: "hidden" },
  glow: { position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 260, height: 260, background: "radial-gradient(circle,rgba(201,168,76,0.1) 0%,transparent 70%)", pointerEvents: "none" },
  hexBig: { fontSize: 44, color: "#C9A84C", display: "block", marginBottom: 12 },
  brand: { fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: 4, color: "#fff", marginBottom: 6 },
  card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 22 },
  chip: { display: "inline-block", fontSize: 12, color: "#C9A84C", background: "rgba(201,168,76,0.09)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 20, padding: "6px 14px", marginBottom: 18 },
  startBtn: { background: "#C9A84C", color: "#000", border: "none", borderRadius: 14, padding: "17px", fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: "'Syne',sans-serif", letterSpacing: 0.5, width: "100%" },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", flexShrink: 0 },
  chatArea: { flex: 1, overflowY: "auto", padding: "18px 18px 8px", display: "flex", flexDirection: "column", gap: 14 },
  av: { width: 30, height: 30, borderRadius: "50%", background: "rgba(201,168,76,0.11)", border: "1px solid rgba(201,168,76,0.24)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#C9A84C", flexShrink: 0 },
  bub: { padding: "12px 15px", fontSize: 15, lineHeight: 1.65, maxWidth: "84%", whiteSpace: "pre-wrap" },
  dots: { fontSize: 22, animation: "blink 1.2s ease infinite", letterSpacing: 3, display: "block" },
  textarea: { flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "12px 15px", color: "#fff", fontSize: 15, fontFamily: "'DM Sans',sans-serif", outline: "none", minHeight: 50 },
  sendBtn: { width: 50, height: 50, background: "#C9A84C", border: "none", borderRadius: 14, color: "#000", fontSize: 20, fontWeight: 800, cursor: "pointer", flexShrink: 0, alignSelf: "flex-end", transition: "opacity 0.2s" },
  sh: { marginBottom: 20 },
  st: { fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 4 },
  ss: { fontSize: 12, color: "rgba(255,255,255,0.3)" },
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  ic: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 18 },
  tag: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "rgba(255,255,255,0.26)", textTransform: "uppercase", marginBottom: 12, fontFamily: "'Syne',sans-serif" },
  cb: { fontSize: 14, color: "rgba(255,255,255,0.62)", lineHeight: 1.65 },
  goldBtn: { background: "#C9A84C", color: "#000", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "'Syne',sans-serif", width: "100%" },
  vlbl: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: "rgba(255,255,255,0.22)", textTransform: "uppercase", marginBottom: 4 },
  sublbl: { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "rgba(255,255,255,0.26)", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
};
