"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
  const [regions, setRegions] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [languages, setLanguages] = useState<Array<{ code: string; label: string }>>([]);

  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [language, setLanguage] = useState("ko");
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
        const res = await fetch("http://127.0.0.1:8001/options");

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
          setLanguage(nextLanguages.some((item) => item.code === "ko") ? "ko" : nextLanguages[0].code);
        }
      } catch (e: any) {
        setError(e?.message || "옵션 데이터를 불러오는 중 오류가 발생했습니다.");
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
        setValidationWarning(
          "이 질문은 외국인 노동자 법률 서비스와 관련이 없는 것 같아요. 😅\n임금, 근로 환경, 산업재해, 비자, 고용 계약 등 근로와 관련된 질문을 입력해 주세요!"
        );
        return;
      }

      const res = await fetch("http://127.0.0.1:8001/chat/law/message", {
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
        throw new Error(data?.detail || "법률 상담 요청 중 오류가 발생했습니다.");
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
      setError(e?.message || "법률 상담 요청 중 오류가 발생했습니다.");
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
                ← 홈으로
              </span>
            </Link>
            <div className="hero-badge" style={{ margin: 0 }}>외국인 노동자 법률 서비스</div>
          </div>
          <h1 className="hero-title">외국인 노동자 법 설명</h1>
          <p className="hero-desc">
            질문을 분석하고 관련 법령을 근거로 이해하기 쉬운 상담 답변을 제공해드릴게요!
          </p>
        </section>

        <section className="top-grid top-grid-law">
          <div className="card law-input-card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>✍️ 질문 입력</h2>
              </div>
              <p>지역, 업종, 언어, 질문을 입력하면 법령 근거 기반 답변을 제공합니다.</p>
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
                <label>지역</label>
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
                <label>업종</label>
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
                <label>언어</label>
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
                <label>질문</label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="예: 사장이 월급을 늦게 줘요. 기다리라고만 해요."
                />
              </div>
            </div>

            <div className="action-row">
              <button
                className="primary-btn"
                onClick={() => handleAsk(question)}
                disabled={loading || !question.trim() || optionsLoading}
              >
                {loading ? "분석 중..." : "분석 시작"}
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
                초기화
              </button>
            </div>

            <div className="notice" style={{ marginTop: "10px"}}>
              분석을 시작하면 아래 답변 결과 영역으로 자동 이동합니다.
            </div>

            <div className="law-info-box">
              💡 입력한 질문은 1차 상황 분석 후, 관련 법률·시행령·시행규칙 조문을 검색하여 답변을 생성합니다.
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
                <h2>🚨 지금 이런 상황인가요?</h2>
              </div>
              <p>해당하는 상황을 선택하면 질문창에 자동으로 입력돼요.</p>
            </div>

            <div className="emergency-scenario-list">
              {EMERGENCY_SCENARIOS.map((item) => (
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
                <h2>📋 답변 결과</h2>
              </div>
              <p>법령 근거를 바탕으로 생성된 최종 답변입니다.</p>
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
                        {msg.role === "user" ? "나" : "🤖 라키"}
                      </div>
                      <div className="chat-content">{msg.content}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="law-empty-state">
                  <div className="law-empty-icon">⚖️</div>
                  <p className="law-empty-title">아직 답변이 없어요</p>
                  <p className="law-empty-desc">왼쪽에서 질문을 입력하고 분석을 시작해보세요.</p>
                </div>
              )}

              {summary && (
                <div className="summary-card">
                  <div className="summary-title">상담 요약</div>
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
                    <label className="followup-label">추가 질문</label>
                    <p className="followup-helper">위 답변과 이어서 궁금한 내용을 편하게 입력해 주세요.</p>
                  </div>
                  <textarea
                    value={followUpQuestion}
                    onChange={(e) => setFollowUpQuestion(e.target.value)}
                    placeholder="예: 신고 후 진행 절차는 어떻게 되나요?"
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
                      {loading ? "전송 중..." : "추가 질문 보내기"}
                    </button>
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div className="support-links-card">
                  <div className="summary-title">바로 상담/신고하기</div>
                  <div className="support-links">
                    {SUPPORT_LINKS.map((link) => (
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
                <h2>🔍 관련 법령 검색 결과</h2>
              </div>
              <p>질문과 관련된 법률·시행령·시행규칙 조문을 확인할 수 있습니다.</p>
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
                  <p className="law-empty-title">검색된 법령이 없어요</p>
                  <p className="law-empty-desc">질문을 입력하면 관련 법령 조문이 여기에 표시됩니다.</p>
                </div>
              )}
            </div>
          </div>
        </section>
        <section style={{ marginTop: "20px" }}>
          <div className="card">
            <div className="card-header law-card-header-divided">
              <div className="card-title-row">
                <h2>🚔 신고하면 어떻게 되나요?</h2>
              </div>
              <p>신고 절차와 체류자격 보호에 대해 미리 알아보세요. 신고는 여러분의 권리입니다.</p>
            </div>

            <div className="report-sim-notice">
              <span className="report-sim-notice-icon">🛡️</span>
              <span>
                <strong>신고해도 비자·체류자격은 보호됩니다.</strong>&nbsp;피해를 신고한다는 이유만으로 체류자격을 취소하거나 강제 추방할 수 없어요. 익명 신고도 가능합니다.
              </span>
            </div>

            <div className="report-sim-flow">
              <div className="report-sim-step">
                <div className="report-sim-num">1</div>
                <div className="report-sim-content">
                  <div className="report-sim-title">신고·접수</div>
                  <div className="report-sim-desc">고용노동부 1350(무료)에 전화하거나 온라인으로 신고해요. 익명 접수도 가능해요.</div>
                  <span className="report-sim-tag">📞 1350 (24시간)</span>
                </div>
              </div>

              <div className="report-sim-arrow">→</div>

              <div className="report-sim-step">
                <div className="report-sim-num">2</div>
                <div className="report-sim-content">
                  <div className="report-sim-title">근로감독관 조사</div>
                  <div className="report-sim-desc">근로감독관이 사업장을 조사하고 사용자(고용주)에게 소명을 요구해요.</div>
                  <span className="report-sim-tag">📋 피해자 진술 포함</span>
                </div>
              </div>

              <div className="report-sim-arrow">→</div>

              <div className="report-sim-step">
                <div className="report-sim-num">3</div>
                <div className="report-sim-content">
                  <div className="report-sim-title">체류자격 보호</div>
                  <div className="report-sim-desc">신고 기간 중 체류자격 연장 또는 사업장 변경 조치를 받을 수 있어요.</div>
                  <span className="report-sim-tag">🏠 사업장 변경 가능</span>
                </div>
              </div>

              <div className="report-sim-arrow">→</div>

              <div className="report-sim-step">
                <div className="report-sim-num">4</div>
                <div className="report-sim-content">
                  <div className="report-sim-title">결과 처리</div>
                  <div className="report-sim-desc">임금 지급 명령, 과태료 부과, 형사 고발 등 위반 내용에 따라 처벌돼요.</div>
                  <span className="report-sim-tag">⚖️ 밀린 임금 받을 수 있어요</span>
                </div>
              </div>
            </div>

            <div className="report-sim-links">
              <div className="report-sim-links-title">📌 바로 신고·상담하기</div>
              <div className="report-sim-links-row">
                <a className="report-sim-link-btn" href="https://www.moel.go.kr/1350/" target="_blank" rel="noreferrer">고용노동부 1350</a>
                <a className="report-sim-link-btn" href="https://minwon.moel.go.kr/" target="_blank" rel="noreferrer">온라인 민원 신고</a>
                <a className="report-sim-link-btn" href="https://www.moel.go.kr/policy/policyinfo/foreigner/list.do" target="_blank" rel="noreferrer">외국인근로자지원센터</a>
                <a className="report-sim-link-btn" href="https://www.hikorea.go.kr/" target="_blank" rel="noreferrer">체류자격 안내 (HiKorea)</a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}