"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useLang } from "../context/LanguageContext";
import { T } from "../i18n/translations";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8001";

type TrainingRecommendation = {
  course_name: string;
  course_name_en: string;
  start_date: string;
  end_date: string;
  institution: string;
  match_score: number;
  match_reason: string;
};

export default function TrainingPage() {
  const { lang } = useLang();
  const tx = T[lang].training;
  const txC = T[lang].common;

  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<TrainingRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationWarning, setValidationWarning] = useState("");
  const resultRef = useRef<HTMLElement | null>(null);

  const handleSubmit = async () => {
    if (!keyword.trim()) return;

    try {
      setLoading(true);
      setValidationWarning("");

      // 관련성 검증
      const validateRes = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: keyword, type: "training" }),
      });
      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setValidationWarning(
          "입력한 내용이 직업훈련 서비스와 관련이 없는 것 같아요. 😅\n용접, 전기, 한국어, 안전교육 등 배우고 싶은 기술이나 교육 분야를 입력해 주세요!"
        );
        return;
      }

      const res = await fetch(`${BACKEND_URL}/chat/training/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: keyword,
          top_k: 5,
        }),
      });

      const data = await res.json();
      setResult(data.recommendations || []);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (e) {
      console.error(e);
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
        <section className="top-grid top-grid-training">
          <div className="card">
            <div className="card-header law-card-header-divided">
              <h2>{tx.inputTitle}</h2>
              <p>{tx.inputDesc}</p>
            </div>

            <div className="form-grid">
              <div className="field" style={{ marginTop: 0 }}>
                <label>{tx.keywordLabel}</label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={tx.keywordPlaceholder}
                  onKeyDown={(e) => { if (e.key === "Enter" && !loading && keyword.trim()) handleSubmit(); }}
                />
              </div>
            </div>

            <div className="action-row">
              <button className="primary-btn" onClick={handleSubmit} disabled={loading || !keyword.trim()}>
                {loading ? tx.loadingBtn : tx.submitBtn}
              </button>
            </div>

            <div className="notice" style={{ marginTop: "10px"}}>
              {tx.notice}
            </div>

            <div className="law-info-box">
              {tx.infoBox}
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
          </div>

          <div className="card">
            <div className="card-header law-card-header-divided">
              <h2>{tx.keywordsTitle}</h2>
              <p>{tx.keywordsDesc}</p>
            </div>

            <div className="chip-wrap" style={{ marginTop: "22px" }}>
              {tx.keywords.map((item) => (
                <button key={item} className="chip" onClick={() => setKeyword(item)}>
                  {item}
                </button>
              ))}
            </div>

            <div className="step-list">
              <div className="step-item">
                <div className="step-num">1</div>
                <div>
                  <h3>{tx.step1Title}</h3>
                  <p>{tx.step1Desc}</p>
                </div>
              </div>

              <div className="step-item">
                <div className="step-num">2</div>
                <div>
                  <h3>{tx.step2Title}</h3>
                  <p>{tx.step2Desc}</p>
                </div>
              </div>

              <div className="step-item">
                <div className="step-num">3</div>
                <div>
                  <h3>{tx.step3Title}</h3>
                  <p>{tx.step3Desc}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section 
        ref={resultRef}
        style={{ marginTop: "20px", scrollMarginTop: "24px"}}>
          <div className="card">
            <div className="card-header law-card-header-divided">
              <h2>{tx.resultTitle}</h2>
              <p>{tx.resultDesc}</p>
            </div>

            {result.length === 0 ? (
              <div className="law-empty-state">
                  <div className="law-empty-icon">{tx.emptyIcon}</div>
                  <p className="law-empty-title">{tx.emptyTitle}</p>
                  <p className="law-empty-desc">{tx.emptyDesc}</p>
              </div>
            ) : (
              <div className="training-result-list">
                {result.map((item, idx) => (
                  <div key={idx} className="training-result-card">
                    <div className="training-result-top">
                      <span className="training-result-num">{idx + 1}</span>
                      <h3 className="training-result-title">
                        {lang === "en" && item.course_name_en ? item.course_name_en : item.course_name}
                      </h3>
                    </div>
                    <div className="training-result-meta">
                      <span className="training-meta-chip">📅 {item.start_date} ~ {item.end_date}</span>
                      <span className="training-meta-chip">🏢 {item.institution}</span>
                    </div>
                    {item.match_reason && (
                      <div className="training-result-reason">
                        <span className="training-reason-label">{tx.reasonLabel}</span>
                        <p className="training-reason-text">{item.match_reason}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}