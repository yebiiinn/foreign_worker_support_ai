"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "./context/LanguageContext";
import { T } from "./i18n/translations";

type Category = "law" | "training";

type AskResponse = {
  region: string;
  industry: string;
  question: string;
  situation_result: Record<string, any>;
  retrieved_docs: Array<Record<string, any>>;
  final_answer: string;
  consultation_summary?: {
    one_liner: string;
    action_items: string[];
  };
};

type OptionsResponse = {
  regions: string[];
  industries: string[];
  languages: {
    code: string;
    label: string;
  }[];
};

type TrainingRecommendation = {
  year: string;
  round: string;
  course_name: string;
  course_name_en: string;
  start_date: string;
  end_date: string;
  capacity: string;
  hours: string;
  institution: string;
  phone: string;
  address: string;
  description: string;
  match_score: number;
  match_reason: string;
};

type TrainingRecommendResponse = {
  industry: string;
  keyword: string;
  recommendations: TrainingRecommendation[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type LawChatResponse = {
  conversation_id: string;
  assistant_message: string;
  consultation_summary?: {
    one_liner: string;
    action_items: string[];
  };
  situation_result: Record<string, any>;
  retrieved_docs: Array<Record<string, any>>;
  history: ChatMessage[];
};

type TrainingChatResponse = {
  conversation_id: string;
  industry: string;
  assistant_message: string;
  recommendations: TrainingRecommendation[];
  history: ChatMessage[];
};

type LakiAssetsResponse = {
  full: string[];
  face: string[];
};

const QUICK_QUESTIONS = [
  "사장이 월급을 늦게 줘요",
  "여권을 맡기라고 해요",
  "쉬는 시간이 없어요",
  "회사 옮기고 싶어요",
  "다쳤는데 산재가 되는지 모르겠어요",
];

const TRAINING_KEYWORDS = [
  "용접",
  "기계",
  "전기",
  "서비스",
  "한국어",
  "안전교육",
];

const SUPPORT_LINKS = [
  { label: "고용노동부 고객상담센터 1350", href: "https://www.moel.go.kr/1350/" },
  { label: "외국인근로자지원센터 안내", href: "https://www.moel.go.kr/policy/policyinfo/foreigner/list.do" },
  { label: "마이그레이션 포털(HiKorea)", href: "https://www.hikorea.go.kr/" },
];

const pickLakiByKeywords = (paths: string[], keywords: string[], fallbackIndex = 0): string | null => {
  if (!paths.length) return null;

  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const found = paths.find((p) => {
    const lower = p.toLowerCase();
    return lowerKeywords.some((k) => lower.includes(k));
  });

  if (found) return found;
  return paths[Math.min(fallbackIndex, paths.length - 1)];
};

export default function HomePage() {
  const { lang, setLang } = useLang();
  const tx = T[lang].home;
  const [fading, setFading] = useState(false);

  const handleLangChange = (l: typeof lang) => {
    if (l === lang) return;
    setFading(true);
    setTimeout(() => {
      setLang(l);
      setFading(false);
    }, 180);
  };

  const [category, setCategory] = useState<Category>("law");

  const [regions, setRegions] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);

  const [languages, setLanguages] = useState<{ code: string; label: string }[]>([]);
  const [language, setLanguage] = useState("ko");

  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [question, setQuestion] = useState("");

  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lawConversationId, setLawConversationId] = useState<string | null>(null);
  const [lawChatHistory, setLawChatHistory] = useState<ChatMessage[]>([]);
  const [followUpQuestion, setFollowUpQuestion] = useState("");

  const [result, setResult] = useState<AskResponse | null>(null);

  const [trainingIndustry, setTrainingIndustry] = useState("");
  const [trainingKeyword, setTrainingKeyword] = useState("");
  const [trainingSubmitted, setTrainingSubmitted] = useState(false);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState("");
  const [trainingResult, setTrainingResult] = useState<TrainingRecommendResponse | null>(null);
  const [trainingConversationId, setTrainingConversationId] = useState<string | null>(null);
  const [trainingChatHistory, setTrainingChatHistory] = useState<ChatMessage[]>([]);
  const [lakiAssets, setLakiAssets] = useState<LakiAssetsResponse>({ full: [], face: [] });
  const [lakiOpen, setLakiOpen] = useState(false);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setOptionsLoading(true);
        const response = await fetch("http://127.0.0.1:8001/options");

        if (!response.ok) {
          throw new Error("옵션 데이터를 불러오지 못했습니다.");
        }

        const data: OptionsResponse = await response.json();
        setRegions(data.regions || []);
        setIndustries(data.industries || []);
        setLanguages(data.languages || []);

        if (data.regions?.length) {
          setRegion(data.regions.includes("경기도") ? "경기도" : data.regions[0]);
        }

        if (data.industries?.length) {
          const defaultIndustry = data.industries.includes("제조업")
            ? "제조업"
            : data.industries[0];

          setIndustry(defaultIndustry);
          setTrainingIndustry(defaultIndustry);
        }

        if (data.languages?.length) {
          setLanguage("ko");
        }
      } catch (err: any) {
        setError(err?.message || "옵션 데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setOptionsLoading(false);
      }
    };

    fetchOptions();
  }, []);

  useEffect(() => {
    const fetchLakiAssets = async () => {
      try {
        const response = await fetch("/api/laki");
        if (!response.ok) return;
        const data: LakiAssetsResponse = await response.json();
        setLakiAssets({
          full: data.full || [],
          face: data.face || [],
        });
      } catch {
        // Ignore mascot loading failures to avoid breaking main UI.
      }
    };

    fetchLakiAssets();
  }, []);

  const heroLaki = useMemo(
    () => pickLakiByKeywords(lakiAssets.full, ["welcome", "hello", "happy", "smile", "basic"], 0),
    [lakiAssets.full],
  );

  const lawGuideFace = useMemo(
    () => pickLakiByKeywords(lakiAssets.face, ["guide", "explain", "help", "smile", "basic"], 0),
    [lakiAssets.face],
  );

  const lawInputFace = useMemo(
    () => pickLakiByKeywords(lakiAssets.face, ["listen", "question", "ask", "focus", "basic"], 0),
    [lakiAssets.face],
  );

  const lawStatusFace = useMemo(() => {
    if (loading) return pickLakiByKeywords(lakiAssets.face, ["thinking", "wait", "loading", "focus"], 0);
    if (error) return pickLakiByKeywords(lakiAssets.face, ["sad", "worry", "sorry", "panic"], 0);
    if (lawChatHistory.length > 0) return pickLakiByKeywords(lakiAssets.face, ["happy", "smile", "good"], 0);
    return pickLakiByKeywords(lakiAssets.face, ["neutral", "basic", "default"], 0);
  }, [lakiAssets.face, loading, error, lawChatHistory.length]);

  const trainingGuideFace = useMemo(
    () => pickLakiByKeywords(lakiAssets.face, ["idea", "recommend", "sparkle", "smile", "basic"], 0),
    [lakiAssets.face],
  );

  const lawSearchFace = useMemo(
    () => pickLakiByKeywords(lakiAssets.face, ["search", "find", "focus", "thinking", "basic"], 0),
    [lakiAssets.face],
  );

  const trainingKeywordFace = useMemo(
    () => pickLakiByKeywords(lakiAssets.face, ["keyword", "hint", "idea", "smile", "basic"], 0),
    [lakiAssets.face],
  );

  const canSubmitLaw = useMemo(() => {
    return region.trim() && industry.trim() && question.trim();
  }, [region, industry, question]);

  const canSubmitTraining = useMemo(() => {
    return trainingIndustry.trim() && trainingKeyword.trim();
  }, [trainingIndustry, trainingKeyword]);

  const handleAsk = async () => {
    if (!canSubmitLaw) return;

    try {
      setLoading(true);
      setError("");

      const response = await fetch("http://127.0.0.1:8001/chat/law/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: lawConversationId,
          region,
          industry,
          message: question,
          language,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || "요청 처리 중 오류가 발생했습니다.");
      }

      const data: LawChatResponse = await response.json();
      setLawConversationId(data.conversation_id);
      setLawChatHistory(data.history || []);
      setResult({
        region,
        industry,
        question,
        situation_result: data.situation_result,
        retrieved_docs: data.retrieved_docs,
        final_answer: data.assistant_message,
        consultation_summary: data.consultation_summary,
      });
      setQuestion("");
    } catch (err: any) {
      setError(err?.message || "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleLawFollowUpAsk = async () => {
    if (!followUpQuestion.trim()) return;

    try {
      setLoading(true);
      setError("");

      const response = await fetch("http://127.0.0.1:8001/chat/law/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: lawConversationId,
          region,
          industry,
          message: followUpQuestion,
          language,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || "추가 질문 처리 중 오류가 발생했습니다.");
      }

      const data: LawChatResponse = await response.json();
      setLawConversationId(data.conversation_id);
      setLawChatHistory(data.history || []);
      setResult({
        region,
        industry,
        question: followUpQuestion,
        situation_result: data.situation_result,
        retrieved_docs: data.retrieved_docs,
        final_answer: data.assistant_message,
        consultation_summary: data.consultation_summary,
      });
      setFollowUpQuestion("");
    } catch (err: any) {
      setError(err?.message || "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleTrainingSubmit = async () => {
    if (!canSubmitTraining) return;

    try {
      setTrainingLoading(true);
      setTrainingError("");
      setTrainingSubmitted(true);

      const response = await fetch("http://127.0.0.1:8001/chat/training/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: trainingConversationId,
          industry: trainingIndustry,
          message: trainingKeyword,
          top_k: 5,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || "직업훈련 추천 요청 중 오류가 발생했습니다.");
      }

      const data: TrainingChatResponse = await response.json();
      setTrainingConversationId(data.conversation_id);
      setTrainingChatHistory(data.history || []);
      setTrainingResult({
        industry: data.industry,
        keyword: trainingKeyword,
        recommendations: data.recommendations,
      });
      setTrainingKeyword("");
    } catch (err: any) {
      setTrainingError(err?.message || "직업훈련 추천 중 알 수 없는 오류가 발생했습니다.");
    } finally {
      setTrainingLoading(false);
    }
  };

  return (
    <main>
      {/* ── 풀스크린 히어로 ── */}
      <section className="home-hero-fs">
        <div className="home-glow home-glow-tl" />
        <div className="home-glow home-glow-br" />

        <div className="home-hero-content">
          {/* 언어 토글 */}
          <div style={{
            display: "inline-flex",
            background: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(191,219,254,0.7)",
            borderRadius: "24px",
            padding: "3px",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 12px rgba(30,58,138,0.07)",
          }}>
            {(["ko", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => handleLangChange(l)}
                style={{
                  fontSize: "12px",
                  fontWeight: lang === l ? 700 : 500,
                  padding: "5px 18px",
                  borderRadius: "20px",
                  border: "none",
                  background: lang === l ? "linear-gradient(135deg,#2563eb,#3b82f6)" : "transparent",
                  color: lang === l ? "#fff" : "#94a3b8",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: lang === l ? "0 2px 8px rgba(37,99,235,0.25)" : "none",
                  letterSpacing: "0.02em",
                }}
              >
                {l === "ko" ? "한국어" : "English"}
              </button>
            ))}
          </div>

          {/* 페이드 영역 */}
          <div style={{ opacity: fading ? 0 : 1, transition: "opacity 0.18s ease", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
            <div className="hero-badge" style={{ margin: 0 }}>{tx.badge}</div>
          </div>

          <h1
            className="hero-title"
            style={{ fontSize: "56px", fontWeight: 800, margin: "16px 0 0", textAlign: "center" }}
          >
            {tx.title}
          </h1>

          <p className="hero-desc" style={{ textAlign: "center", maxWidth: "900px", marginTop: "14px", whiteSpace: "nowrap" }}>
            {tx.desc}
          </p>

          {heroLaki && (
            <div
              onClick={() => setLakiOpen((prev) => !prev)}
              style={{
                position: "relative",
                width: lakiOpen ? "860px" : "420px",
                height: "390px",
                marginTop: "18px",
                animation: "laki-float 2.2s ease-in-out infinite",
                willChange: "transform",
                cursor: "pointer",
                transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              {/* 위쪽 큰 말풍선 — 클릭 전에만 표시 */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "100%",
                  background: "linear-gradient(180deg, #ffffff, #f8fbff)",
                  border: "1px solid rgba(191, 219, 254, 0.95)",
                  borderRadius: "28px",
                  padding: "22px 26px",
                  fontSize: "21px",
                  fontWeight: 800,
                  lineHeight: 1.45,
                  color: "#1e293b",
                  textAlign: "center",
                  boxShadow: "0 20px 40px rgba(30, 41, 59, 0.12)",
                  opacity: lakiOpen ? 0 : 1,
                  transition: "opacity 0.25s ease",
                  pointerEvents: "none",
                }}
              >
                <span>{tx.lakiGreet1}</span>
                <br />
                <span>{tx.lakiGreet2}</span>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "-12px",
                    width: "24px",
                    height: "24px",
                    background: "#f8fbff",
                    borderRight: "1px solid rgba(191, 219, 254, 0.95)",
                    borderBottom: "1px solid rgba(191, 219, 254, 0.95)",
                    transform: "translateX(-50%) rotate(45deg)",
                  }}
                />
              </div>

              {/* 라키 이미지 — 클릭 시 왼쪽으로 이동 */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  top: "90px",
                  left: lakiOpen ? "0px" : "75px",
                  width: "270px",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  transition: "left 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                <img
                  src={heroLaki}
                  alt="라키 마스코트"
                  style={{
                    width: "270px",
                    height: "100%",
                    objectFit: "contain",
                    objectPosition: "bottom",
                    filter: "drop-shadow(0 16px 28px rgba(37, 99, 235, 0.15))",
                    animation: "none",
                  }}
                />

                {/* 작은 힌트 말풍선 — 클릭 전에만 표시 */}
                <div
                  style={{
                    position: "absolute",
                    right: "-124px",
                    bottom: "100px",
                    opacity: lakiOpen ? 0 : 1,
                    transition: "opacity 0.2s ease",
                    pointerEvents: "none",
                    filter: "drop-shadow(0 3px 10px rgba(14, 165, 233, 0.28))",
                  }}
                >
                  {/* 내부 래퍼: 꼬리 기준점 */}
                  <div style={{ position: "relative", display: "inline-block" }}>
                    {/* 말풍선 꼬리 — 흰색 배경 + 좌하단만 하늘색 테두리, 우측은 본체에 가려짐 */}
                    <div
                      style={{
                        position: "absolute",
                        left: "-8px",
                        top: "50%",
                        width: "14px",
                        height: "14px",
                        background: "#ffffff",
                        borderLeft: "1.5px solid #bae6fd",
                        borderBottom: "1.5px solid #bae6fd",
                        borderRight: "1.5px solid #ffffff",
                        borderTop: "1.5px solid transparent",
                        transform: "translateY(-50%) rotate(45deg)",
                        zIndex: 0,
                      }}
                    />
                    {/* 말풍선 본체 — 꼬리의 우측을 덮어 자연스럽게 연결 */}
                    <div
                      style={{
                        position: "relative",
                        zIndex: 1,
                        background: "#ffffff",
                        border: "1.5px solid #bae6fd",
                        borderRadius: "14px",
                        padding: "8px 15px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#0369a1" }}>
                        {tx.lakiHint}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 오른쪽 설명 말풍선 — 클릭 후 슬라이드인 */}
              <div
                style={{
                  position: "absolute",
                  bottom: "18px",
                  left: lakiOpen ? "306px" : "240px",
                  width: "554px",
                  opacity: lakiOpen ? 1 : 0,
                  transition: "left 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease 0.15s",
                  pointerEvents: "none",
                }}
              >
                {/* 말풍선 왼쪽 꼬리 */}
                <div
                  style={{
                    position: "absolute",
                    left: "-11px",
                    bottom: "36px",
                    width: "22px",
                    height: "22px",
                    background: "#f0f7ff",
                    borderLeft: "1px solid rgba(191, 219, 254, 0.95)",
                    borderBottom: "1px solid rgba(191, 219, 254, 0.95)",
                    transform: "rotate(45deg)",
                    zIndex: 0,
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    background: "linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%)",
                    border: "1px solid rgba(191, 219, 254, 0.95)",
                    borderRadius: "20px",
                    padding: "20px 26px",
                    boxShadow: "0 12px 32px rgba(37, 99, 235, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: "10px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 800, color: "#1e40af" }}>
                      {tx.lakiInfoTitle}
                    </p>
                    <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#2563eb", letterSpacing: "0.08em" }}>
                      {tx.lakiInfoSub}
                    </p>
                  </div>
                  <p style={{ margin: "0 0 12px", fontSize: "14.5px", color: "#475569", lineHeight: 1.65, fontWeight: 400 }}>
                    {tx.lakiInfoDesc.split("\n").map((line, i) => (
                      <span key={i}>{line}{i === 0 && <br />}</span>
                    ))}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "14px", justifyContent: "center" }}>
                    {["한국어", "English", "Tiếng Việt", "中文", "ภาษาไทย", "O'zbekcha"].map((l) => (
                      <span
                        key={l}
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#2563eb",
                          background: "rgba(219, 234, 254, 0.7)",
                          border: "1px solid rgba(147, 197, 253, 0.6)",
                          borderRadius: "20px",
                          padding: "2px 9px",
                        }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                  <div style={{ borderTop: "1px solid rgba(191, 219, 254, 0.6)", paddingTop: "14px", display: "flex", gap: "10px" }}>
                    {[
                      [tx.lawTag, tx.lawCardDesc],
                      [tx.trainingTag, tx.trainingCardDesc],
                      [tx.mindTag, tx.mindCardDesc],
                    ].map(([title, desc]) => (
                      <div
                        key={title}
                        style={{
                          flex: 1,
                          background: "rgba(239, 246, 255, 0.7)",
                          border: "1px solid rgba(191, 219, 254, 0.5)",
                          borderRadius: "12px",
                          padding: "10px 14px",
                        }}
                      >
                        <p style={{ margin: "0 0 5px", fontSize: "14px", fontWeight: 700, color: "#1e40af" }}>{title}</p>
                        <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.55 }}>{desc}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#94a3b8", textAlign: "right" }}>
                    {tx.closeHint}
                  </p>
                </div>
              </div>
            </div>
          )}
          </div>{/* 페이드 영역 끝 */}
        </div>

        {/* 스크롤 유도 */}
        <div className="home-scroll-hint">
          <span>{tx.scrollHint}</span>
          <div className="home-scroll-arrow" />
        </div>
      </section>

      {/* ── 서비스 카드 섹션 ── */}
      <section className="home-services-section">
        <div className="home-svc-inner">
          <div style={{ textAlign: "center", marginBottom: "52px" }}>
            <div className="hero-badge">{tx.servicesBadge}</div>
            <h2 style={{ margin: "14px 0 12px", fontSize: "36px", fontWeight: 800, color: "#1e293b" }}>
              {tx.servicesTitle}
            </h2>
            <p style={{ color: "#6f8094", fontSize: "16px", margin: 0 }}>{tx.servicesDesc}</p>
          </div>

          <div className="home-svc-grid">
            {/* 법률 상담 */}
            <Link href="/law" className="home-svc-card" style={{ textDecoration: "none" }}>
              <div className="home-svc-img-area home-svc-img-law">
                <img src="/images/laki/full/laki-law.png" alt="law laki" className="home-svc-laki" />
              </div>
              <div className="home-svc-body">
                <span className="home-svc-tag home-svc-tag-law">{tx.lawTag}</span>
                <h3 className="home-svc-title">{tx.lawTitle}</h3>
                <p className="home-svc-desc">{tx.lawDesc}</p>
                <span className="home-svc-btn home-svc-btn-law">{tx.lawBtn}</span>
              </div>
            </Link>

            <Link href="/training" className="home-svc-card" style={{ textDecoration: "none" }}>
              <div className="home-svc-img-area home-svc-img-training">
                <img src="/images/laki/full/laki-training.png" alt="training laki" className="home-svc-laki home-svc-laki-training" />
              </div>
              <div className="home-svc-body">
                <span className="home-svc-tag home-svc-tag-training">{tx.trainingTag}</span>
                <h3 className="home-svc-title">{tx.trainingTitle}</h3>
                <p className="home-svc-desc">{tx.trainingDesc}</p>
                <span className="home-svc-btn home-svc-btn-training">{tx.trainingBtn}</span>
              </div>
            </Link>

            <Link href="/mindfulness" className="home-svc-card" style={{ textDecoration: "none" }}>
              <div className="home-svc-img-area home-svc-img-mind">
                <img src="/images/laki/full/laki-mind.png" alt="mindfulness laki" className="home-svc-laki home-svc-laki-mind" />
              </div>
              <div className="home-svc-body">
                <span className="home-svc-tag home-svc-tag-mind">{tx.mindTag}</span>
                <h3 className="home-svc-title">{tx.mindTitle}</h3>
                <p className="home-svc-desc">{tx.mindDesc}</p>
                <span className="home-svc-btn home-svc-btn-mind">{tx.mindBtn}</span>
              </div>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}