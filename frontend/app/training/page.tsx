"use client";

import Link from "next/link";
import { useEffect, useRef,useState } from "react";

type TrainingRecommendation = {
  course_name: string;
  start_date: string;
  end_date: string;
  institution: string;
  match_score: number;
  match_reason: string;
};

export default function TrainingPage() {
  const [industry, setIndustry] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<TrainingRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationWarning, setValidationWarning] = useState("");
  const resultRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setOptionsLoading(true);
        const res = await fetch("http://127.0.0.1:8001/options");
        const data = await res.json();

        const nextIndustries = data.industries || [];
        setIndustries(nextIndustries);

        if (nextIndustries.length > 0) {
          setIndustry(nextIndustries.includes("제조업") ? "제조업" : nextIndustries[0]);
        }
      } catch (e) {
        console.error("옵션 불러오기 실패:", e);
      } finally {
        setOptionsLoading(false);
      }
    };

    fetchOptions();
  }, []);

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

      const res = await fetch("http://127.0.0.1:8001/chat/training/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry,
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
                ← 홈으로
              </span>
            </Link>
            <div className="hero-badge" style={{ margin: 0 }}>직업훈련 서비스</div>
          </div>
          <h1 className="hero-title">직업훈련 추천</h1>
          <p className="hero-desc">
            관심 분야를 입력하면 맞춤 교육 과정을 추천해드릴게요!
          </p>
        </section>
        <section className="top-grid top-grid-training">
          <div className="card">
            <div className="card-header law-card-header-divided">
              <h2>🎯 직업훈련 추천 입력</h2>
              <p>현재 업종과 관심 분야를 입력하면 맞춤 교육 과정을 추천해드립니다.</p>
            </div>

            <div className="form-grid">
              <div className="field" style={{ marginTop: 0 }}>
                <label>현재 업종</label>
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
                <label>관심 분야</label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="예: 용접, 전기, 한국어"
                />
              </div>
            </div>

            <div className="action-row">
              <button className="primary-btn" onClick={handleSubmit} disabled={loading || !keyword.trim()}>
                {loading ? "추천 중..." : "추천 받기"}
              </button>
            </div>

            <div className="notice" style={{ marginTop: "10px"}}>
              추천 결과를 확인하면 아래 추천 결과 영역으로 자동 이동합니다.
            </div>

            <div className="law-info-box">
              💡 입력한 업종과 관심 키워드를 바탕으로 직업훈련 데이터를 조회해 연관 과정을 추천합니다.
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
              <h2>🔑 추천 예시 키워드</h2>
              <p>관심 있는 훈련 분야를 빠르게 참고할 수 있습니다.</p>
            </div>

            <div className="chip-wrap" style={{ marginTop: "22px" }}>
              {["용접", "기계", "전기", "서비스", "한국어", "안전교육"].map((item) => (
                <button key={item} className="chip" onClick={() => setKeyword(item)}>
                  {item}
                </button>
              ))}
            </div>

            <div className="step-list">
              <div className="step-item">
                <div className="step-num">1</div>
                <div>
                  <h3>업종 확인</h3>
                  <p>현재 종사 중인 업종을 기준으로 관련 교육 과정을 우선 탐색합니다.</p>
                </div>
              </div>

              <div className="step-item">
                <div className="step-num">2</div>
                <div>
                  <h3>관심 분야 입력</h3>
                  <p>배우고 싶은 기술이나 필요한 교육 분야를 키워드로 입력합니다.</p>
                </div>
              </div>

              <div className="step-item">
                <div className="step-num">3</div>
                <div>
                  <h3>추천 결과 확인</h3>
                  <p>추천된 과정의 일정, 기관, 추천 이유를 비교해 적합한 과정을 선택하세요.</p>
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
              <h2>🎓 추천 결과</h2>
              <p>입력한 업종과 관심 분야를 기준으로 추천된 교육 과정입니다.</p>
            </div>

            {result.length === 0 ? (
              <div className="law-empty-state">
                <div className="law-empty-icon">🎓</div>
                <p className="law-empty-title">아직 추천 결과가 없어요</p>
                <p className="law-empty-desc">업종과 관심 분야를 입력하고 추천을 받아보세요.</p>
              </div>
            ) : (
              <div className="training-result-list">
                {result.map((item, idx) => (
                  <div key={idx} className="training-result-card">
                    <div className="training-result-top">
                      <span className="training-result-num">{idx + 1}</span>
                      <h3 className="training-result-title">{item.course_name}</h3>
                    </div>
                    <div className="training-result-meta">
                      <span className="training-meta-chip">📅 {item.start_date} ~ {item.end_date}</span>
                      <span className="training-meta-chip">🏢 {item.institution}</span>
                    </div>
                    {item.match_reason && (
                      <div className="training-result-reason">
                        <span className="training-reason-label">💡 추천 이유</span>
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