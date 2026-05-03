"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../context/LanguageContext";
import { T } from "../i18n/translations";
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8001";
/** 국가 직업훈련·고용 정보 (외부 링크) */
const WORK24_TRAINING_INFO_URL = "https://www.work24.go.kr/cm/main.do";
/** `globals.css` body와 동일 (SVG `<text>`는 상속이 약해 명시) */
const APP_FONT_STACK =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/* ── Korea SVG map helpers (Highcharts-style coords — tight viewBox + labels) ── */
const MAP_PAD = 4;
const MAP_INNER_W = 420;

type MapProject = (x: number, y: number) => { sx: number; sy: number };

type MapLayout = {
  vbW: number;
  vbH: number;
  project: MapProject;
};

type BBox = { minX: number; maxX: number; minY: number; maxY: number };

function updateBBox(b: BBox, x: number, y: number) {
  b.minX = Math.min(b.minX, x);
  b.maxX = Math.max(b.maxX, x);
  b.minY = Math.min(b.minY, y);
  b.maxY = Math.max(b.maxY, y);
}

function bboxFromGeometry(geometry: { type: string; coordinates: number[][][][] | number[][][] }): BBox | null {
  const rings: number[][][] =
    geometry.type === "Polygon"
      ? (geometry.coordinates as number[][][])
      : (geometry.coordinates as number[][][][]).flat(1);

  let b: BBox | null = null;
  for (const ring of rings) {
    for (const pt of ring) {
      const x = pt[0], y = pt[1];
      if (x <= -500 || y <= -500) continue;
      if (!b) b = { minX: x, maxX: x, minY: y, maxY: y };
      else updateBBox(b, x, y);
    }
  }
  return b;
}

function mergeBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function computeMapLayout(features: any[]): MapLayout | null {
  let merged: BBox | null = null;
  for (const f of features) {
    const b = bboxFromGeometry(f.geometry);
    if (!b) continue;
    merged = merged ? mergeBBox(merged, b) : b;
  }
  if (!merged) return null;
  const { minX, maxX, minY, maxY } = merged;
  const dataW = maxX - minX;
  const dataH = maxY - minY;
  if (dataW <= 0 || dataH <= 0) return null;

  const innerH = MAP_INNER_W * (dataH / dataW);
  const vbW = MAP_INNER_W + 2 * MAP_PAD;
  const vbH = innerH + 2 * MAP_PAD;
  const project: MapProject = (x, y) => ({
    sx: MAP_PAD + ((x - minX) / dataW) * MAP_INNER_W,
    sy: MAP_PAD + ((maxY - y) / dataH) * innerH,
  });
  return { vbW, vbH, project };
}

function toSvgPath(
  geometry: { type: string; coordinates: number[][][][] | number[][][] },
  project: MapProject,
): string {
  const rings: number[][][] =
    geometry.type === "Polygon"
      ? (geometry.coordinates as number[][][])
      : (geometry.coordinates as number[][][][]).flat(1);

  return rings
    .map((ring) => {
      const pts = ring.filter(([x, y]) => x > -500 && y > -500);
      if (pts.length < 3) return "";
      return (
        pts
          .map(([x, y], i) => {
            const { sx, sy } = project(x, y);
            return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
          })
          .join(" ") + " Z"
      );
    })
    .join(" ");
}

function featureCentroidRaw(geometry: { type: string; coordinates: number[][][][] | number[][][] }): [number, number] | null {
  const outerRings: number[][][] =
    geometry.type === "Polygon"
      ? [(geometry.coordinates as number[][][])[0]].filter(Boolean)
      : (geometry.coordinates as number[][][][]).map((p) => p[0]).filter(Boolean);

  let best: number[][] | null = null;
  let bestN = 0;
  for (const ring of outerRings) {
    const pts = ring.filter(([x, y]) => x > -500 && y > -500);
    if (pts.length > bestN) {
      bestN = pts.length;
      best = pts;
    }
  }
  if (!best || best.length === 0) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of best) {
    sx += x;
    sy += y;
  }
  return [sx / best.length, sy / best.length];
}

/**
 * GeoJSON 특성 `name` → `/training/by-region` 키 (도·특별시 단위, API와 동일)
 * 경기+인천, 대전·세종+충남, 대구+경북, 부산·울산·경남→경남
 */
const GEO_TO_DO_REGION: Record<string, string> = {
  Gyeonggi: "경기도",
  Incheon: "경기도",
  Seoul: "서울특별시",
  Sejong: "충청남도",
  Daejeon: "충청남도",
  "North Chungcheong": "충청북도",
  "South Chungcheong": "충청남도",
  Daegu: "경상북도",
  "North Gyeongsang": "경상북도",
  Busan: "경상남도",
  "South Gyeongsang": "경상남도",
  Ulsan: "경상남도",
  Gangwon: "강원특별자치도",
  "North Jeolla": "전북특별자치도",
  "South Jeolla": "전라남도",
  Jeju: "제주특별자치도",
  Gwangju: "광주광역시",
};

function getDoRegionKey(geoName: string): string {
  return GEO_TO_DO_REGION[geoName] ?? geoName;
}

/** 지도 위 짧은 도 이름 */
const DO_MAP_LABEL: Record<string, { ko: string; en: string }> = {
  경기도: { ko: "경기", en: "Gyeonggi" },
  서울특별시: { ko: "서울", en: "Seoul" },
  충청북도: { ko: "충북", en: "Chungbuk" },
  충청남도: { ko: "충남", en: "Chungnam" },
  경상북도: { ko: "경북", en: "Gyeongbuk" },
  경상남도: { ko: "경남", en: "Gyeongnam" },
  전북특별자치도: { ko: "전북", en: "Jeonbuk" },
  전라남도: { ko: "전남", en: "Jeonnam" },
  제주특별자치도: { ko: "제주", en: "Jeju" },
  광주광역시: { ko: "광주", en: "Gwangju" },
  강원특별자치도: { ko: "강원", en: "Gangwon" },
};

/** 패널 제목 (영문 짧은 명칭 — 포함 범위는 부제에서 안내) */
const DO_PANEL_TITLE_EN: Record<string, string> = {
  경기도: "Gyeonggi Province",
  서울특별시: "Seoul",
  충청북도: "North Chungcheong",
  충청남도: "South Chungcheong",
  경상북도: "North Gyeongsang",
  경상남도: "South Gyeongsang",
  전북특별자치도: "Jeonbuk",
  전라남도: "South Jeolla",
  제주특별자치도: "Jeju",
  광주광역시: "Gwangju",
  강원특별자치도: "Gangwon Province",
};

function panelSubtitleForDo(doKey: string, lang: "ko" | "en"): string | null {
  if (lang === "en") {
    if (doKey === "경기도") return "Including Incheon";
    if (doKey === "충청남도") return "Including Daejeon & Sejong";
    if (doKey === "경상북도") return "Including Daegu";
    if (doKey === "경상남도") return "Including Busan & Ulsan";
    return null;
  }
  if (doKey === "경기도") return "인천 포함";
  if (doKey === "충청남도") return "대전·세종 포함";
  if (doKey === "경상북도") return "대구 포함";
  if (doKey === "경상남도") return "부산·울산 포함";
  return null;
}

type TrainingRecommendation = {
  course_name: string;
  course_name_en: string;
  start_date: string;
  end_date: string;
  institution: string;
  match_score: number;
  match_reason: string;
};

type RegionCourse = {
  course_name: string;
  course_name_en: string;
  institution: string;
  address: string;
  start_date: string;
  end_date: string;
  hours: string;
};

/** 지역 패널: 훈련 시작일 기준 최신순 */
function regionCoursesSortedByStartDesc(courses: RegionCourse[]): RegionCourse[] {
  const startTs = (d: string) => {
    const t = new Date((d ?? "").trim()).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...courses].sort((a, b) => startTs(b.start_date) - startTs(a.start_date));
}

export default function TrainingPage() {
  const { lang } = useLang();
  const tx = T[lang].training;
  const txC = T[lang].common;

  const [activeTab, setActiveTab] = useState<"recommend" | "map">("recommend");

  /* ── 추천 탭 ── */
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<TrainingRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationWarning, setValidationWarning] = useState("");
  const resultRef = useRef<HTMLElement | null>(null);

  /* ── 지도 탭 ── */
  const [regionData, setRegionData] = useState<Record<string, RegionCourse[]>>({});
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [geoFeatures, setGeoFeatures] = useState<any[]>([]);

  useEffect(() => {
    if (activeTab !== "map") return;
    const needsRegion = Object.keys(regionData).length === 0;
    const needsGeo = geoFeatures.length === 0;
    if (!needsRegion && !needsGeo) return;

    setMapLoading(true);
    Promise.all([
      needsRegion
        ? fetch(`${BACKEND_URL}/training/by-region`).then((r) => r.json())
        : Promise.resolve(null),
      needsGeo
        ? fetch("/korea-provinces.json").then((r) => r.json())
        : Promise.resolve(null),
    ])
      .then(([regionRes, geoRes]) => {
        if (regionRes) setRegionData(regionRes.regions ?? {});
        if (geoRes) setGeoFeatures(geoRes.features ?? []);
      })
      .catch(console.error)
      .finally(() => setMapLoading(false));
  }, [activeTab, regionData, geoFeatures]);

  const mapLayout = useMemo(() => computeMapLayout(geoFeatures), [geoFeatures]);

  const mapLabels = useMemo(() => {
    if (!mapLayout) return [] as { doKey: string; sx: number; sy: number }[];
    const acc: Record<string, { sx: number; sy: number; n: number }> = {};
    for (const feat of geoFeatures) {
      const geoName: string = feat.properties?.name ?? "";
      const doKey = getDoRegionKey(geoName);
      const raw = featureCentroidRaw(feat.geometry);
      if (!raw) continue;
      const { sx, sy } = mapLayout.project(raw[0], raw[1]);
      if (!acc[doKey]) acc[doKey] = { sx: 0, sy: 0, n: 0 };
      acc[doKey].sx += sx;
      acc[doKey].sy += sy;
      acc[doKey].n += 1;
    }
    return Object.entries(acc).map(([doKey, v]) => ({
      doKey,
      sx: v.sx / v.n,
      sy: v.sy / v.n,
    }));
  }, [geoFeatures, mapLayout]);

  /** 같은 도로 묶인 행정구역은 path를 합쳐 내부 경계선을 없앰 */
  const mergedPathByDo = useMemo(() => {
    if (!mapLayout) return {} as Record<string, string>;
    const parts: Record<string, string[]> = {};
    for (const feat of geoFeatures) {
      const geoName: string = feat.properties?.name ?? "";
      const doKey = getDoRegionKey(geoName);
      const d = toSvgPath(feat.geometry, mapLayout.project);
      if (!d) continue;
      (parts[doKey] ??= []).push(d);
    }
    const out: Record<string, string> = {};
    for (const [k, arr] of Object.entries(parts)) {
      out[k] = arr.join(" ");
    }
    return out;
  }, [geoFeatures, mapLayout]);

  const maxCount = Math.max(1, ...Object.values(regionData).map((v) => v.length));

  const getColorForDoKey = (doKey: string) => {
    const count = regionData[doKey]?.length ?? 0;
    if (count === 0) return "#dbeafe";
    const lightness = Math.round(85 - (count / maxCount) * 45);
    return `hsl(213, 80%, ${lightness}%)`;
  };

  const mapPanelSubtitle = selectedRegion
    ? panelSubtitleForDo(selectedRegion, lang === "en" ? "en" : "ko")
    : null;

  const handleSubmit = async () => {
    if (!keyword.trim()) return;
    try {
      setLoading(true);
      setValidationWarning("");

      const validateRes = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: keyword, type: "training" }),
      });
      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setValidationWarning(tx.validationWarning);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/chat/training/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: keyword, top_k: 5 }),
      });
      const data = await res.json();
      setResult(data.recommendations ?? []);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        {/* Hero */}
        <section className="hero" style={{ marginBottom: "24px" }}>
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

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {(["recommend", "map"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "9px 22px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                background: activeTab === tab ? "#2563eb" : "#f1f5f9",
                color: activeTab === tab ? "#fff" : "#64748b",
                transition: "all 0.15s",
              }}
            >
              {tab === "recommend"
                ? (lang === "en" ? "🔍 Recommendations" : "🔍 과정 추천받기")
                : (lang === "en" ? "🗺️ Find by Region" : "🗺️ 지역별 찾기")}
            </button>
          ))}
        </div>

        {/* ── 추천 탭 ── */}
        {activeTab === "recommend" && (
          <>
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !loading && keyword.trim()) handleSubmit();
                      }}
                    />
                  </div>
                </div>
                <div className="action-row">
                  <button className="primary-btn" onClick={handleSubmit} disabled={loading || !keyword.trim()}>
                    {loading ? tx.loadingBtn : tx.submitBtn}
                  </button>
                </div>
                <div className="notice" style={{ marginTop: "10px" }}>{tx.notice}</div>
                <div className="law-info-box">{tx.infoBox}</div>
                {validationWarning && (
                  <div className="law-validation-warning">
                    <div className="law-validation-icon">🚫</div>
                    <div>
                      {validationWarning.split("\n").map((line, i) => (
                        <p key={i} style={{ margin: i === 0 ? "0 0 6px" : "0", fontWeight: i === 0 ? 700 : 400 }}>{line}</p>
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
                    <button key={item} className="chip" onClick={() => setKeyword(item)}>{item}</button>
                  ))}
                </div>
                <div className="step-list">
                  {[
                    { num: 1, title: tx.step1Title, desc: tx.step1Desc },
                    { num: 2, title: tx.step2Title, desc: tx.step2Desc },
                    { num: 3, title: tx.step3Title, desc: tx.step3Desc },
                  ].map((s) => (
                    <div key={s.num} className="step-item">
                      <div className="step-num">{s.num}</div>
                      <div><h3>{s.title}</h3><p>{s.desc}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section ref={resultRef} style={{ marginTop: "20px", scrollMarginTop: "24px" }}>
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
          </>
        )}

        {/* ── 지도 탭 ── */}
        {activeTab === "map" && (
          <div className="card" style={{ padding: "28px" }}>
            <div className="card-header law-card-header-divided" style={{ marginBottom: "24px" }}>
              <h2>🗺️ {lang === "en" ? "Training Courses by Region" : "지역별 훈련과정"}</h2>
              <p>{lang === "en"
                ? "Click a region on the map to view available training courses."
                : "지도에서 지역을 클릭하면 해당 지역의 훈련과정을 확인할 수 있어요."}</p>
            </div>

            {mapLoading ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#64748b" }}>
                <div style={{ fontSize: "40px", marginBottom: "14px" }}>🗺️</div>
                <p style={{ fontSize: "15px" }}>{lang === "en" ? "Loading map data..." : "지역 데이터를 불러오는 중..."}</p>
              </div>
            ) : (
              <div className="training-map-split">

                {/* 지도 */}
                <div>
                  <div style={{ background: "#f0f7ff", borderRadius: "12px", padding: "4px 4px 2px" }}>
                    {mapLayout && (
                    <svg
                      viewBox={`0 0 ${mapLayout.vbW} ${mapLayout.vbH}`}
                      style={{ width: "100%", height: "auto", display: "block", verticalAlign: "top" }}
                    >
                      {Object.entries(mergedPathByDo).map(([doKey, pathD]) => {
                        const isSelected = selectedRegion === doKey;
                        const isHovered = hoveredRegion === doKey;
                        return (
                          <path
                            key={doKey}
                            d={pathD}
                            fill={isSelected ? "#2563eb" : isHovered ? "#93c5fd" : getColorForDoKey(doKey)}
                            stroke="none"
                            style={{ cursor: "pointer", transition: "fill 0.15s" }}
                            onClick={() => setSelectedRegion(doKey)}
                            onMouseEnter={() => setHoveredRegion(doKey)}
                            onMouseLeave={() => setHoveredRegion(null)}
                          />
                        );
                      })}
                      {mapLabels.map(({ doKey, sx, sy }) => {
                        const isSelected = selectedRegion === doKey;
                        const short = DO_MAP_LABEL[doKey];
                        const text = short
                          ? (lang === "en" ? short.en : short.ko)
                          : doKey.replace(/특별자치도|특별자치시|광역시|특별시|도$/g, "").trim() || doKey;
                        return (
                          <text
                            key={`lbl-${doKey}`}
                            x={sx}
                            y={sy}
                            textAnchor="middle"
                            dominantBaseline="central"
                            style={{
                              fontSize: lang === "en" ? 10.5 : 12,
                              fontWeight: 700,
                              fill: isSelected ? "#ffffff" : "#0f172a",
                              pointerEvents: "none",
                              paintOrder: "stroke",
                              stroke: isSelected ? "rgba(15,23,42,0.35)" : "rgba(255,255,255,0.9)",
                              strokeWidth: isSelected ? 2 : 2.5,
                              strokeLinejoin: "round",
                              fontFamily: APP_FONT_STACK,
                            }}
                          >
                            {text}
                          </text>
                        );
                      })}
                    </svg>
                    )}
                  </div>

                  {/* 범례 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center", marginTop: "10px" }}>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>{lang === "en" ? "Fewer" : "적음"}</span>
                    {[0.05, 0.25, 0.5, 0.75, 0.95].map((v) => (
                      <div
                        key={v}
                        style={{
                          width: "22px", height: "12px", borderRadius: "3px",
                          background: `hsl(213, 80%, ${Math.round(88 - v * 48)}%)`,
                        }}
                      />
                    ))}
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>{lang === "en" ? "More" : "많음"}</span>
                  </div>
                </div>

                {/* 사이드 패널 */}
                <div>
                  {selectedRegion ? (
                    <>
                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                            📍 {lang === "en"
                              ? (DO_PANEL_TITLE_EN[selectedRegion] ?? selectedRegion)
                              : selectedRegion}
                          </h3>
                          <span style={{
                            background: (regionData[selectedRegion]?.length ?? 0) === 0 ? "#e2e8f0" : "#dbeafe",
                            color: (regionData[selectedRegion]?.length ?? 0) === 0 ? "#64748b" : "#1d4ed8",
                            borderRadius: "20px", padding: "3px 12px",
                            fontSize: "12px", fontWeight: 700,
                          }}>
                            {regionData[selectedRegion]?.length ?? 0}
                            {lang === "en" ? " courses" : "개 과정"}
                          </span>
                        </div>
                        {mapPanelSubtitle && (
                          <p style={{ fontSize: "12px", color: "#64748b", margin: "8px 0 0" }}>
                            {mapPanelSubtitle}
                          </p>
                        )}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "440px", overflowY: "auto", paddingRight: "4px" }}>
                        {(() => {
                          const courses = regionCoursesSortedByStartDesc(regionData[selectedRegion] ?? []);
                          if (courses.length === 0) {
                            return (
                              <div
                                style={{
                                  background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
                                  border: "1px dashed #cbd5e1",
                                  borderRadius: "16px",
                                  padding: "28px 22px",
                                  textAlign: "center",
                                }}
                              >
                                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
                                <p style={{ fontSize: "15px", fontWeight: 700, color: "#334155", margin: "0 0 10px", lineHeight: 1.5 }}>
                                  {tx.mapRegionEmptyTitle}
                                </p>
                                <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 8px", lineHeight: 1.65, whiteSpace: "pre-line" }}>
                                  {tx.mapRegionEmptyDesc}
                                </p>
                                <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px", lineHeight: 1.65, whiteSpace: "pre-line" }}>
                                  {tx.mapRegionEmptyTip}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab("recommend")}
                                  style={{
                                    display: "inline-block",
                                    width: "100%",
                                    maxWidth: "280px",
                                    padding: "11px 18px",
                                    borderRadius: "12px",
                                    border: "none",
                                    background: "#2563eb",
                                    color: "#fff",
                                    fontSize: "14px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    marginBottom: "14px",
                                  }}
                                >
                                  {tx.mapRegionEmptyCta}
                                </button>
                                <div>
                                  <a
                                    href={WORK24_TRAINING_INFO_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      fontSize: "13px",
                                      fontWeight: 600,
                                      color: "#1d4ed8",
                                      textDecoration: "underline",
                                      textUnderlineOffset: "3px",
                                    }}
                                  >
                                    {tx.mapRegionEmptyLink} ↗
                                  </a>
                                </div>
                              </div>
                            );
                          }
                          return courses.map((course, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              borderRadius: "12px",
                              padding: "14px 16px",
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b", marginBottom: "8px", lineHeight: 1.4 }}>
                              {lang === "en" && course.course_name_en ? course.course_name_en : course.course_name}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              <span style={{ background: "#e0f2fe", color: "#0369a1", borderRadius: "6px", padding: "2px 8px", fontSize: "12px" }}>
                                🏢 {course.institution}
                              </span>
                              {course.start_date && (
                                <span style={{ background: "#f0fdf4", color: "#166534", borderRadius: "6px", padding: "2px 8px", fontSize: "12px" }}>
                                  📅 {course.start_date} ~ {course.end_date}
                                </span>
                              )}
                              {course.hours && (
                                <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: "6px", padding: "2px 8px", fontSize: "12px" }}>
                                  ⏱️ {course.hours}H
                                </span>
                              )}
                            </div>
                          </div>
                          ));
                        })()}
                      </div>
                    </>
                  ) : (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", height: "340px",
                      color: "#94a3b8", gap: "12px",
                      background: "#f8fafc", borderRadius: "16px",
                    }}>
                      <div style={{ fontSize: "52px" }}>🗺️</div>
                      <p style={{ fontSize: "15px", fontWeight: 600, color: "#64748b" }}>
                        {lang === "en" ? "Click a region on the map" : "지도에서 지역을 클릭해보세요"}
                      </p>
                      <p style={{ fontSize: "13px", textAlign: "center", lineHeight: 1.6 }}>
                        {lang === "en"
                          ? "Training courses in the\nselected region will appear here."
                          : "해당 지역의 훈련과정이\n여기에 표시됩니다."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
