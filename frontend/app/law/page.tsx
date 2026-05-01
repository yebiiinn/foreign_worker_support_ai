"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLang } from "../context/LanguageContext";
import { T } from "../i18n/translations";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8001";

type OptionsResponse = {
  regions: string[];
  industries: string[];
  languages?: Array<{ code: string; label: string }>;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type LawRetrievedDoc = {
  law_name: string;
  article_no: string;
  article_title: string;
  text: string;
  final_score?: number;
};

type LawChatResponse = {
  conversation_id: string;
  assistant_message: string;
  consultation_summary?: {
    one_liner: string;
    action_items: string[];
  };
  situation_result: Record<string, any>;
  retrieved_docs: LawRetrievedDoc[];
  history: ChatMessage[];
};

const EMERGENCY_SCENARIOS = [
  {
    icon: "📛",
    title: "여권·통장을 빼앗겼어요",
    desc: "고용주나 브로커가 여권, 통장을 보관하고 있어요",
    question: "고용주(또는 브로커)가 제 여권과 통장을 빼앗아서 돌려주지 않아요. 어떻게 해야 하나요?",
  },
  {
    icon: "💰",
    title: "월급을 못 받고 있어요",
    desc: "임금이 지급되지 않거나 브로커가 중간에 가져가요",
    question: "사장이 월급을 제때 주지 않거나 일부만 줘요. 브로커가 임금을 중간에 가져가고 있어요. 어떻게 신고할 수 있나요?",
  },
  {
    icon: "📋",
    title: "합의서 서명을 강요받아요",
    desc: "신고하지 않겠다는 합의서에 서명하라고 해요",
    question: "앞으로 신고나 민원을 제기하지 않겠다는 합의서에 서명하라고 강요받고 있어요. 이 합의서에 서명해야 하나요? 서명하면 어떻게 되나요?",
  },
  {
    icon: "✈️",
    title: "강제 귀국을 요구받고 있어요",
    desc: "본인 의사와 관계없이 귀국하라고 강요받고 있어요",
    question: "브로커나 고용주가 저를 강제로 귀국시키려 해요. 제 의사와 관계없이 귀국 버스에 태우려 했어요. 이걸 거부할 수 있나요?",
  },
  {
    icon: "⚠️",
    title: "신고하면 추방된다고 협박받아요",
    desc: "문제를 신고하면 추방당한다고 위협해요",
    question: "신고하면 추방시키겠다고 협박을 받고 있어요. 실제로 신고하면 제 비자나 체류자격에 문제가 생기나요?",
  },
];

const SUPPORT_LINKS = [
  { label: "고용노동부 고객상담센터 1350", href: "https://1350.moel.go.kr/home/" },
  { label: "외국인근로자지원센터 안내", href: "https://www.moel.go.kr/policy/policyinfo/foreigner/list.do" },
  { label: "마이그레이션 포털(HiKorea)", href: "https://www.hikorea.go.kr/" },
];

export default function LawPage() {
  const { lang } = useLang();
  const tx = T[lang].law;
  const txC = T[lang].common;
  const langRef = useRef(lang);
  langRef.current = lang;

  const [regions, setRegions] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [languages, setLanguages] = useState<Array<{ code: string; label: string }>>([]);

  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [language, setLanguage] = useState<string>(lang);

  useEffect(() => {
    setLanguage(lang);
  }, [lang]);
  const [question, setQuestion] = useState("");
  const [followUpQuestion, setFollowUpQuestion] = useState("");

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [retrievedDocs, setRetrievedDocs] = useState<LawRetrievedDoc[]>([]);
  const [summary, setSummary] = useState<{ one_liner: string; action_items: string[] } | null>(null);

  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState("");
  const [validationWarning, setValidationWarning] = useState("");

  const resultRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setOptionsLoading(true);
        const res = await fetch(`${BACKEND_URL}/options`);

        if (!res.ok) {
          throw new Error("옵션 데이터를 불러오지 못했습니다.");
        }

        const data: OptionsResponse = await res.json();
        const nextRegions = data.regions || [];
        const nextIndustries = data.industries || [];
        const nextLanguages = data.languages || [];

        setRegions(nextRegions);
        setIndustries(nextIndustries);
        setLanguages(nextLanguages);

        if (nextRegions.length > 0) {
          setRegion(nextRegions.includes("경기도") ? "경기도" : nextRegions[0]);
        }

        if (nextIndustries.length > 0) {
          setIndustry(nextIndustries.includes("제조업") ? "제조업" : nextIndustries[0]);
        }

        if (nextLanguages.length > 0) {
          // 전역 언어 설정 우선, 없으면 ko 기본값
          const preferred = nextLanguages.find((item) => item.code === lang);
          setLanguage(preferred ? preferred.code : (nextLanguages.some((item) => item.code === "ko") ? "ko" : nextLanguages[0].code));
        }
      } catch (e: any) {
        setError(e?.message || T[langRef.current].law.optionsFetchError);
      } finally {
        setOptionsLoading(false);
      }
    };

    fetchOptions();
  }, []);

  const handleAsk = async (message: string) => {
    if (!message.trim()) return;

    try {
      setLoading(true);
      setError("");
      setValidationWarning("");

      // 관련성 검증
      const validateRes = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: message }),
      });
      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setValidationWarning(tx.validationWarning);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/chat/law/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          region,
          industry,
          language,
          message,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || tx.apiCallError);
      }

      const typedData = data as LawChatResponse;
      setConversationId(typedData.conversation_id);
      setHistory(typedData.history || []);
      setRetrievedDocs(typedData.retrieved_docs || []);
      setSummary(typedData.consultation_summary || null);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (e: any) {
      setError(e?.message || tx.apiCallError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <section className="hero" style={{ marginBottom: "30px" }}>
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

        <section className="top-grid top-grid-law">
          <div className="card law-input-card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>{tx.inputTitle}</h2>
              </div>
              <p>{tx.inputDesc}</p>
            </div>

            <div
              className="form-grid"
              style={{
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                alignItems: "end",
                gap: "18px",
              }}
            >
              <div className="field" style={{ marginTop: 0 }}>
                <label>{tx.regionLabel}</label>
                <div className="select-wrap">
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    disabled={optionsLoading}
                  >
                    {regions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <span className="select-arrow">⌄</span>
                </div>
              </div>

              <div className="field" style={{ marginTop: 0 }}>
                <label>{tx.industryLabel}</label>
                <div className="select-wrap">
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    disabled={optionsLoading}
                  >
                    {industries.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <span className="select-arrow">⌄</span>
                </div>
              </div>

              <div className="field" style={{ marginTop: 0 }}>
                <label>{tx.languageLabel}</label>
                <div className="select-wrap">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={optionsLoading}
                  >
                    {languages.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="select-arrow">⌄</span>
                </div>
              </div>

              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>{tx.questionLabel}</label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={tx.questionPlaceholder}
                />
              </div>
            </div>

            <div className="action-row">
              <button
                className="primary-btn"
                onClick={() => handleAsk(question)}
                disabled={loading || !question.trim() || optionsLoading}
              >
                {loading ? tx.loadingBtn : tx.submitBtn}
              </button>

              <button
                className="ghost-btn"
                onClick={() => {
                  setQuestion("");
                  setFollowUpQuestion("");
                  setHistory([]);
                  setRetrievedDocs([]);
                  setSummary(null);
                  setConversationId(null);
                  setError("");
                  setValidationWarning("");
                }}
              >
                {tx.resetBtn}
              </button>
            </div>

            <div className="notice" style={{ marginTop: "10px"}}>
              {tx.analysisNotice}
            </div>

            <div className="law-info-box">
              {tx.analysisInfoBox}
            </div>

            {validationWarning && (
              <div className="law-validation-warning">
                <div className="law-validation-icon">🚫</div>
                <div>
                  {validationWarning.split("\n").map((line, i) => (
                    <p key={i} style={{ margin: i === 0 ? "0 0 6px" : "0", fontWeight: i === 0 ? 700 : 400 }}>
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="error-box">{error}</div>}
          </div>

          <div className="card law-faq-card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>{tx.emergencyTitle}</h2>
              </div>
              <p>{tx.emergencyDesc}</p>
            </div>

            <div className="emergency-scenario-list">
              {tx.scenarios.map((item) => (
                <button
                  key={item.title}
                  className="emergency-scenario-btn"
                  onClick={() => setQuestion(item.question)}
                >
                  <span className="emergency-scenario-icon">{item.icon}</span>
                  <span className="emergency-scenario-body">
                    <span className="emergency-scenario-title">{item.title}</span>
                    <span className="emergency-scenario-desc">{item.desc}</span>
                  </span>
                  <span className="emergency-scenario-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section 
        ref={resultRef}
        className="bottom-grid"
        style={{ marginTop: "20px", scrollMarginTop: "24px"}}>
          <div className="card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>{tx.chatResultTitle}</h2>
              </div>
              <p>{tx.chatResultDesc}</p>
            </div>

            <div className="result-section">
              {history.length > 0 ? (
                <div className="chat-history">
                  {history.map((msg, idx) => (
                    <div
                      key={`${msg.role}-${idx}`}
                      className={`chat-item ${msg.role === "user" ? "chat-item-user" : "chat-item-assistant"}`}
                    >
                      <div className={`chat-role ${msg.role === "assistant" ? "chat-role-laki" : ""}`}>
                        {msg.role === "user" ? (lang === "en" ? "Me" : "나") : "🤖 Laki"}
                      </div>
                      <div className="chat-content">{msg.content}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="law-empty-state">
                  <div className="law-empty-icon">⚖️</div>
                  <p className="law-empty-title">{tx.emptyTitle}</p>
                  <p className="law-empty-desc">{tx.emptyDesc}</p>
                </div>
              )}

              {summary && (
                <div className="summary-card">
                  <div className="summary-title">{tx.summaryShortTitle}</div>
                  <div className="summary-line">{summary.one_liner}</div>
                  {!!summary.action_items?.length && (
                    <ul className="summary-actions">
                      {summary.action_items.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {history.length > 0 && (
                <div className="followup-box">
                  <div className="followup-head">
                    <label className="followup-label">{tx.followUpLabel}</label>
                    <p className="followup-helper">{tx.followUpHelper}</p>
                  </div>
                  <textarea
                    value={followUpQuestion}
                    onChange={(e) => setFollowUpQuestion(e.target.value)}
                    placeholder={tx.followUpPlaceholder}
                    className="followup-textarea"
                  />
                  <div className="action-row followup-action-row">
                    <button
                      className="primary-btn"
                      onClick={() => {
                        const next = followUpQuestion;
                        setFollowUpQuestion("");
                        handleAsk(next);
                      }}
                      disabled={loading || !followUpQuestion.trim()}
                    >
                      {loading ? tx.followUpLoadingBtn : tx.followUpBtn}
                    </button>
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div className="support-links-card">
                  <div className="summary-title">{tx.supportLinksTitle}</div>
                  <div className="support-links">
                    {tx.supportLinks.map((link) => (
                      <a
                        key={link.href}
                        className="support-link-btn"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>{tx.docsResultTitle}</h2>
              </div>
              <p>{tx.docsResultDesc}</p>
            </div>

            <div className="law-docs-area">
              {retrievedDocs.length > 0 ? (
                <div className="law-list" style={{ marginTop: 0 }}>
                  {retrievedDocs.map((doc, idx) => (
                    <div key={`${doc.article_no}-${idx}`} className="law-item">
                      <div className="law-top">
                        <span className="law-badge">{doc.law_name}</span>
                        <span className="law-title">
                          {doc.article_no} {doc.article_title}
                        </span>
                      </div>
                      <div className="law-text">{doc.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="law-empty-state">
                  <div className="law-empty-icon">📚</div>
                  <p className="law-empty-title">{tx.docsEmptyTitle}</p>
                  <p className="law-empty-desc">{tx.docsEmptyDesc}</p>
                </div>
              )}
            </div>
          </div>
        </section>
        <section style={{ marginTop: "20px" }}>
          <div className="card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>{tx.reportTitle}</h2>
              </div>
              <p>{tx.reportDesc}</p>
            </div>

            <div className="report-sim-notice">
              <span className="report-sim-notice-icon">🛡️</span>
              <span>{tx.reportNotice}</span>
            </div>

            <div className="report-sim-flow">
              {tx.reportSteps.map((step, idx) => (
                <div key={step.num} style={{ display: "contents" }}>
                  {idx > 0 && <div className="report-sim-arrow">→</div>}
                  <div className="report-sim-step">
                    <div className="report-sim-num">{step.num}</div>
                    <div className="report-sim-content">
                      <div className="report-sim-title">{step.title}</div>
                      <div className="report-sim-desc">{step.desc}</div>
                      <span className="report-sim-tag">{step.tag}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="report-sim-links">
              <div className="report-sim-links-title">{tx.reportLinksTitle}</div>
              <div className="report-sim-links-row">
                {tx.reportLinks.map((link) => (
                  <a key={link.href} className="report-sim-link-btn" href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}