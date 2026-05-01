"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLang } from "../context/LanguageContext";
import { T } from "../i18n/translations";

type SurveyQuestion = {
  id: number;
  text: string;
  type: "scale" | "text";
  leftLabel?: string;
  rightLabel?: string;
};

type SurveyAnswer = {
  questionId: number;
  value: number | string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type ConversationRecord = {
  id: string;
  date: string;
  surveyAnswers: SurveyAnswer[];
  messages: ChatMessage[];
  preview: string;
};

type PageState = "greeting" | "survey" | "analyzing" | "counseling" | "history";

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: 1,
    text: "오늘 직장이나 일터에서 기분이 어땠어?",
    type: "scale",
    leftLabel: "매우 나빴어",
    rightLabel: "매우 좋았어",
  },
  {
    id: 2,
    text: "요즘 충분히 쉬고 잠을 잘 자고 있어?",
    type: "scale",
    leftLabel: "전혀 못 쉬고 있어",
    rightLabel: "충분히 쉬고 있어",
  },
  {
    id: 3,
    text: "혼자라는 느낌이 들거나 외롭다고 느끼고 있어?",
    type: "scale",
    leftLabel: "전혀 안 느껴",
    rightLabel: "매우 많이 느껴",
  },
  {
    id: 4,
    text: "고향, 가족, 친구들이 많이 그립지?",
    type: "scale",
    leftLabel: "전혀 안 그리워",
    rightLabel: "너무 너무 그리워",
  },
  {
    id: 5,
    text: "일이 너무 힘들다고 느끼고 있어?",
    type: "scale",
    leftLabel: "전혀 안 힘들어",
    rightLabel: "정말 많이 힘들어",
  },
  {
    id: 6,
    text: "고민이 있어도 마음을 털어놓을 사람이 없다고 느껴?",
    type: "scale",
    leftLabel: "주변에 사람 있어",
    rightLabel: "아무도 없어",
  },
  {
    id: 7,
    text: "미래나 한국 생활에 대한 걱정이 많아?",
    type: "scale",
    leftLabel: "전혀 안 걱정돼",
    rightLabel: "매우 많이 걱정돼",
  },
  {
    id: 8,
    text: "한국 문화나 언어 때문에 불편하거나 힘든 점이 있어?",
    type: "scale",
    leftLabel: "전혀 없어",
    rightLabel: "매우 많이 있어",
  },
  {
    id: 9,
    text: "최근에 즐겁거나 행복하다고 느낀 적이 있어?",
    type: "scale",
    leftLabel: "전혀 없었어",
    rightLabel: "자주 있었어",
  },
  {
    id: 10,
    text: "지금 이 순간, 전반적인 마음 상태가 어때?",
    type: "scale",
    leftLabel: "매우 힘들어",
    rightLabel: "매우 좋아",
  },
  {
    id: 11,
    text: "지금 마음속에 있는 고민이나 하고 싶은 말을 자유롭게 써줘 (선택 사항이야 ☺️)",
    type: "text",
  },
];

const SCALE_COUNT = SURVEY_QUESTIONS.filter((q) => q.type === "scale").length;
const STORAGE_KEY = "laki_mindfulness_conversations";

function loadConversations(): ConversationRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveConversation(record: ConversationRecord): void {
  try {
    const existing = loadConversations();
    const filtered = existing.filter((c) => c.id !== record.id);
    const updated = [record, ...filtered].slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export default function MindfulnessPage() {
  const { lang } = useLang();
  const tx = T[lang].mindfulness;
  const txC = T[lang].common;

  const SURVEY_QUESTIONS = tx.questions;
  const SCALE_COUNT_DYN = SURVEY_QUESTIONS.filter((q) => q.type === "scale").length;

  const [pageState, setPageState] = useState<PageState>("greeting");
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswer[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const [lakiAssets, setLakiAssets] = useState<{ full: string[]; face: string[] }>({
    full: [],
    face: [],
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/laki")
      .then((r) => r.json())
      .then((data) => setLakiAssets(data))
      .catch(() => {});

    setHasHistory(loadConversations().length > 0);
  }, []);

  useEffect(() => {
    if (pageState === "history") {
      setConversations(loadConversations());
    }
  }, [pageState]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  const lakiDefault = lakiAssets.full.find((p) => p.includes("default")) || lakiAssets.full[0] || null;
  const lakiWondering = lakiAssets.full.find((p) => p.includes("wondering")) || lakiDefault;
  const lakiFace = lakiAssets.face.find((p) => p.includes("default")) || lakiAssets.face[0] || null;

  const answeredCount = SURVEY_QUESTIONS.filter(
    (q) => q.type === "scale" && surveyAnswers.some((a) => a.questionId === q.id),
  ).length;
  const canSubmit = answeredCount === SCALE_COUNT_DYN;

  const handleStartSurvey = () => {
    setConversationId(`conv_${Date.now()}`);
    setSurveyAnswers([]);
    setChatHistory([]);
    setError("");
    setPageState("survey");
  };

  const handleScaleAnswer = (questionId: number, value: number) => {
    setSurveyAnswers((prev) => [...prev.filter((a) => a.questionId !== questionId), { questionId, value }]);
  };

  const handleTextAnswer = (questionId: number, value: string) => {
    setSurveyAnswers((prev) => [...prev.filter((a) => a.questionId !== questionId), { questionId, value }]);
  };

  const getScale = (qId: number): number | undefined =>
    surveyAnswers.find((a) => a.questionId === qId)?.value as number | undefined;

  const getText = (qId: number): string =>
    (surveyAnswers.find((a) => a.questionId === qId)?.value as string) || "";

  const handleSubmitSurvey = async () => {
    if (!canSubmit) return;
    setPageState("analyzing");
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/mindfulness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "initial", surveyAnswers, questions: SURVEY_QUESTIONS, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "상담 준비 중 오류가 발생했습니다.");

      const firstMsg: ChatMessage = { role: "assistant", content: data.message, timestamp: new Date().toISOString() };
      setChatHistory([firstMsg]);
      setPageState("counseling");

      const record: ConversationRecord = {
        id: conversationId,
        date: new Date().toLocaleString("ko-KR"),
        surveyAnswers,
        messages: [firstMsg],
        preview: data.message.slice(0, 80),
      };
      saveConversation(record);
      setHasHistory(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      setPageState("survey");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || loading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date().toISOString(),
    };
    const updated = [...chatHistory, userMsg];
    setChatHistory(updated);
    setInputMessage("");
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/mindfulness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat",
          messages: updated.map((m) => ({ role: m.role, content: m.content })),
          surveyAnswers,
          questions: SURVEY_QUESTIONS,
          language: lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "응답 생성 중 오류가 발생했습니다.");

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.message,
        timestamp: new Date().toISOString(),
      };
      const final = [...updated, assistantMsg];
      setChatHistory(final);

      const stored = loadConversations();
      const idx = stored.findIndex((c) => c.id === conversationId);
      if (idx !== -1) {
        stored[idx].messages = final;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "응답을 받지 못했어. 다시 시도해줘.");
    } finally {
      setLoading(false);
    }
  };

  const handleContinueConversation = (record: ConversationRecord) => {
    setConversationId(record.id);
    setSurveyAnswers(record.surveyAnswers);
    setChatHistory(record.messages);
    setPageState("counseling");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ─────────────────────────── GREETING ───────────────────────────
  const renderGreeting = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "28px" }}>
      <div className="ms-welcome-card">
        {lakiDefault && (
          <img
            src={lakiDefault}
            alt="라키"
            style={{
              width: "160px",
              height: "160px",
              objectFit: "contain",
              animation: "laki-float 2.4s ease-in-out infinite",
            }}
          />
        )}

        <div className="ms-speech-bubble">
          {tx.greetBubble1}
          <br />
          <span style={{ fontSize: "15px", fontWeight: 500, color: "#5a7a9a" }}>
            {tx.greetBubble2}
          </span>
        </div>

        <p className="ms-welcome-desc">
          {tx.greetDesc.split("\n").map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            className="primary-btn"
            onClick={handleStartSurvey}
            style={{ fontSize: "16px", padding: "14px 28px", minWidth: "200px" }}
          >
            {tx.startBtn}
          </button>
          {hasHistory && (
            <button className="ghost-btn" onClick={() => setPageState("history")} style={{ minWidth: "160px" }}>
              {tx.historyBtn}
            </button>
          )}
        </div>
      </div>

      <div className="ms-feature-grid">
        {tx.features.map((f) => (
          <div key={f.title} className="ms-feature-card">
            <div style={{ fontSize: "28px", marginBottom: "10px" }}>{f.icon}</div>
            <h3 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 800, color: "#1e3a5f" }}>{f.title}</h3>
            <p style={{ margin: 0, fontSize: "13px", color: "#6b8197", lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  // ─────────────────────────── SURVEY ───────────────────────────
  const renderSurvey = () => (
    <div className="card ms-survey-card">
      <div className="ms-progress-row">
        <div className="ms-progress-bar">
          <div className="ms-progress-fill" style={{ width: `${(answeredCount / SCALE_COUNT_DYN) * 100}%` }} />
        </div>
        <span className="ms-progress-text">{tx.surveyProgress(answeredCount, SCALE_COUNT_DYN)}</span>
      </div>

      <div className="card-header">
        <h2>{tx.surveyTitle}</h2>
        <p>{tx.surveySubtitle}</p>
      </div>

      <div className="ms-questions">
        {SURVEY_QUESTIONS.filter((q) => q.type === "scale").map((q, idx) => {
          const selected = getScale(q.id);
          return (
            <div key={q.id} className={`ms-q-item ${selected !== undefined ? "ms-q-item-answered" : ""}`}>
              <div className="ms-q-num">{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <p className="ms-q-text">{q.text}</p>
                <div className="ms-scale-row">
                  <span className="ms-scale-label">{q.leftLabel}</span>
                  <div className="ms-scale-btns">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        key={val}
                        className={`ms-scale-btn ${selected === val ? "ms-scale-btn-on" : ""}`}
                        onClick={() => handleScaleAnswer(q.id, val)}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <span className="ms-scale-label ms-scale-label-right">{q.rightLabel}</span>
                </div>
              </div>
            </div>
          );
        })}

        {SURVEY_QUESTIONS.filter((q) => q.type === "text").map((q) => (
          <div key={q.id} className="ms-q-item">
            <div className="ms-q-num" style={{ fontSize: "18px", background: "none", color: "#38bdf8" }}>💭</div>
            <div style={{ flex: 1 }}>
              <p className="ms-q-text">{q.text}</p>
              <textarea
                value={getText(q.id)}
                onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                placeholder={tx.freeTextPlaceholder}
                className="ms-free-textarea"
              />
            </div>
          </div>
        ))}
      </div>

      {error && <div className="error-box" style={{ marginTop: "16px" }}>{error}</div>}

      <div className="action-row" style={{ justifyContent: "center", marginTop: "28px" }}>
        <button
          className="primary-btn"
          onClick={handleSubmitSurvey}
          disabled={!canSubmit}
          style={{ minWidth: "220px", fontSize: "16px", padding: "15px 28px" }}
        >
          {tx.submitSurveyBtn(SCALE_COUNT_DYN - answeredCount)}
        </button>
        <button className="ghost-btn" onClick={() => setPageState("greeting")}>
          {txC.back}
        </button>
      </div>
    </div>
  );

  // ─────────────────────────── ANALYZING ───────────────────────────
  const renderAnalyzing = () => (
    <div className="ms-analyzing">
      {lakiWondering && (
        <img
          src={lakiWondering}
          alt="라키"
          style={{
            width: "160px",
            height: "160px",
            objectFit: "contain",
            animation: "laki-float 1.6s ease-in-out infinite",
          }}
        />
      )}
      <p style={{ fontSize: "22px", fontWeight: 800, color: "#1e3a5f", margin: "0 0 8px" }}>
        {tx.analyzingTitle}
      </p>
      <p style={{ color: "#6b8fb0", fontSize: "15px", margin: 0 }}>{tx.analyzingDesc}</p>
      <div className="ms-dots">
        <span /><span /><span />
      </div>
    </div>
  );

  // ─────────────────────────── COUNSELING ───────────────────────────
  const renderCounseling = () => (
    <div className="ms-chat-layout">
      <div className="ms-sidebar">
        {lakiDefault && (
          <img
            src={lakiDefault}
            alt="라키"
            style={{
              width: "110px",
              height: "110px",
              objectFit: "contain",
              animation: loading ? "laki-float 1.2s ease-in-out infinite" : "laki-float 2.4s ease-in-out infinite",
            }}
          />
        )}
        <div style={{ fontSize: "16px", fontWeight: 800, color: "#1e3a5f" }}>{tx.sidebarName}</div>
        <div style={{ fontSize: "12px", color: "#7a9ab5", fontWeight: 600 }}>{tx.sidebarRole}</div>
        {loading && <div className="ms-typing-label">{tx.sidebarTyping}</div>}
        <div style={{ width: "100%", marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            className="ghost-btn"
            style={{ fontSize: "13px", padding: "8px 10px", width: "100%" }}
            onClick={() => setPageState("history")}
          >
            {tx.historyBtn2}
          </button>
          <button
            className="ghost-btn"
            style={{ fontSize: "13px", padding: "8px 10px", width: "100%" }}
            onClick={handleStartSurvey}
          >
            {tx.newChatBtn}
          </button>
        </div>
      </div>

      <div className="ms-chat-main">
        <div className="ms-chat-messages">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`ms-msg ${msg.role === "user" ? "ms-msg-user" : "ms-msg-laki"}`}>
              {msg.role === "assistant" && lakiFace && (
                <img
                  src={lakiFace}
                  alt="라키"
                  style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "50%", flexShrink: 0 }}
                />
              )}
              <div className={`ms-bubble ${msg.role === "user" ? "ms-bubble-user" : "ms-bubble-laki"}`}>
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ms-msg ms-msg-laki">
              {lakiFace && (
                <img
                  src={lakiFace}
                  alt="라키"
                  style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "50%", flexShrink: 0 }}
                />
              )}
              <div className="ms-bubble ms-bubble-laki" style={{ padding: "14px 20px" }}>
                <div className="ms-dots"><span /><span /><span /></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {error && <div className="error-box" style={{ margin: "0 12px 8px" }}>{error}</div>}

        <div className="ms-input-area">
          <textarea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tx.inputPlaceholder}
            className="ms-chat-textarea"
            disabled={loading}
          />
          <button
            className="primary-btn"
            onClick={handleSendMessage}
            disabled={loading || !inputMessage.trim()}
            style={{ minWidth: "70px", alignSelf: "flex-end" }}
          >
            {txC.send}
          </button>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────── HISTORY ───────────────────────────
  const renderHistory = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
        <button className="ghost-btn" onClick={() => setPageState("greeting")}>{txC.back}</button>
        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 800 }}>{tx.historyTitle}</h2>
      </div>

      {conversations.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "56px 20px" }}>
          <p style={{ fontSize: "40px", margin: "0 0 12px" }}>🌱</p>
          <p style={{ color: "#6b8197", fontSize: "16px", margin: 0 }}>{tx.historyEmpty}</p>
          <button className="primary-btn" onClick={handleStartSurvey} style={{ marginTop: "20px" }}>
            {tx.firstChatBtn}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {conversations.map((conv) => (
            <div key={conv.id} className="card ms-history-card">
              <div className="ms-history-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", color: "#7a9ab5", fontWeight: 600, marginBottom: "4px" }}>
                    📅 {conv.date}
                  </div>
                  <div style={{ fontSize: "14px", color: "#334155", lineHeight: 1.5 }}>
                    {conv.preview}...
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  <button
                    className="primary-btn"
                    style={{ fontSize: "13px", padding: "8px 14px" }}
                    onClick={() => handleContinueConversation(conv)}
                  >
                    {tx.continueBtn}
                  </button>
                  <button
                    className="ghost-btn"
                    style={{ fontSize: "13px", padding: "8px 14px" }}
                    onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                  >
                    {expandedConvId === conv.id ? tx.collapseBtn : tx.viewBtn}
                  </button>
                </div>
              </div>

              {expandedConvId === conv.id && (
                <div className="ms-history-messages">
                  {conv.messages.map((msg, idx) => (
                    <div key={idx} className={`ms-msg ${msg.role === "user" ? "ms-msg-user" : "ms-msg-laki"}`}>
                      <div
                        className={`ms-bubble ${msg.role === "user" ? "ms-bubble-user" : "ms-bubble-laki"}`}
                        style={{ maxWidth: "85%" }}
                      >
                        <div style={{ fontSize: "11px", color: "#9bafc2", marginBottom: "4px", fontWeight: 600 }}>
                          {msg.role === "user" ? tx.meLabel : tx.lakiLabel}
                        </div>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─────────────────────────── MAIN RENDER ───────────────────────────
  return (
    <main className="page">
      <div className="page-inner">
        <section className="hero" style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <Link href="/" style={{ textDecoration: "none" }}>
              <span className="ghost-btn" style={{ display: "inline-block", fontSize: "13px", padding: "6px 12px", cursor: "pointer" }}>
                {txC.backHome}
              </span>
            </Link>
            <div className="hero-badge" style={{ margin: 0 }}>{tx.badge}</div>
          </div>
          <h1 className="hero-title">{tx.title}</h1>
          <p className="hero-desc">{tx.desc}</p>
        </section>

        {pageState === "greeting" && renderGreeting()}
        {pageState === "survey" && renderSurvey()}
        {pageState === "analyzing" && renderAnalyzing()}
        {pageState === "counseling" && renderCounseling()}
        {pageState === "history" && renderHistory()}
      </div>
    </main>
  );
}
