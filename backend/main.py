from dotenv import load_dotenv
import os
import re
import json
import uuid
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional, Tuple

import fitz  # PyMuPDF
import chromadb
import pandas as pd
from openai import OpenAI
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# =========================
# Environment / Config
# =========================
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY environment variable is not set.")

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_foreign_worker_law_db")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "foreign_worker_laws")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "data")

LAW_PDF_PATHS = [
    {
        "path": os.path.join(
            DATA_DIR,
            "외국인근로자의 고용 등에 관한 법률(법률)(제21065호)(20251001).pdf",
        ),
        "law_name": "외국인근로자의 고용 등에 관한 법률",
        "law_type": "law",
    },
    {
        "path": os.path.join(
            DATA_DIR,
            "외국인근로자의 고용 등에 관한 법률 시행령(대통령령)(제32844호)(20230203).pdf",
        ),
        "law_name": "외국인근로자의 고용 등에 관한 법률 시행령",
        "law_type": "enforcement_decree",
    },
    {
        "path": os.path.join(
            DATA_DIR,
            "외국인근로자의 고용 등에 관한 법률 시행규칙(고용노동부령)(제00442호)(20250602).pdf",
        ),
        "law_name": "외국인근로자의 고용 등에 관한 법률 시행규칙",
        "law_type": "enforcement_rule",
    },
]

E9_XLSX_PATH = os.getenv(
    "E9_XLSX_PATH",
    os.path.join(
        DATA_DIR,
        "행정구역_시도__업종별_일반고용허가제_E9__외국인_근로자_수_20260407180631.xlsx",
    ),
)

TRAINING_CSV_PATH = os.getenv(
    "TRAINING_CSV_PATH",
    os.path.join(DATA_DIR, "한국고용정보원_외국인_직업훈련 교육과정_20240830.csv"),
)

client = OpenAI(api_key=OPENAI_API_KEY)

# These globals are initialized on app startup.
chroma_client = None
collection = None
AVAILABLE_REGIONS: List[str] = []
AVAILABLE_INDUSTRIES: List[str] = []
TRAINING_COURSES: List[Dict[str, Any]] = []
LAW_CHAT_SESSIONS: Dict[str, List[Dict[str, str]]] = {}
TRAINING_CHAT_SESSIONS: Dict[str, List[Dict[str, str]]] = {}
MAX_CHAT_HISTORY = 20

# =========================
# Pydantic Schemas
# =========================
class AskRequest(BaseModel):
    region: str = Field(..., description="예: 서울특별시")
    industry: str = Field(..., description="예: 제조업")
    question: str = Field(..., description="사용자 질문")
    language: str = Field("ko", description="출력 언어 코드. 예: ko, en, vi, zh, th, uz")


class AskResponse(BaseModel):
    region: str
    industry: str
    question: str
    situation_result: Dict[str, Any]
    retrieved_docs: List[Dict[str, Any]]
    final_answer: str
    consulation_summary: Dict[str, Any]


class TrainingRecommendRequest(BaseModel):
    industry: str = Field(..., description="현재 업종")
    keyword: str = Field(..., description="관심 키워드")
    top_k: int = Field(5, ge=1, le=10, description="반환할 추천 개수")


class LawChatMessageRequest(BaseModel):
    conversation_id: Optional[str] = Field(None, description="대화 세션 ID")
    region: str = Field(..., description="예: 서울특별시")
    industry: str = Field(..., description="예: 제조업")
    message: str = Field(..., description="사용자 입력 메시지")
    language: str = Field("ko", description="출력 언어 코드")


class TrainingChatMessageRequest(BaseModel):
    conversation_id: Optional[str] = Field(None, description="대화 세션 ID")
    industry: str = Field(..., description="현재 업종")
    message: str = Field(..., description="사용자 입력 메시지")
    language: str = Field("ko", description="출력 언어 코드")
    top_k: int = Field(5, ge=1, le=10, description="반환할 추천 개수")


# =========================
# Utility Functions
# =========================
ARTICLE_HEADER_PATTERN = r"(제\d+조(?:의\d+)?\([^)]+\))"

RULE_KEYWORD_BOOSTS = {
    "사업장 변경": ["사업장 변경", "근무처 변경", "옮기", "이직", "변경"],
    "기숙사": ["기숙사", "숙소", "주거", "생활관"],
    "차별": ["차별", "외국인이라", "국적 때문에", "부당하게 다르게"],
    "임금": ["임금", "월급", "급여", "돈을 안 줘", "체불", "못 받았"],
    "보험": ["보험", "보증보험", "상해보험", "출국만기보험", "귀국비용보험"],
    "계약": ["계약", "근로계약", "표준근로계약서", "계약서"],
    "교육": ["교육", "취업교육", "사용자 교육"],
    "고용변동": ["해고", "퇴사", "계약 해지", "고용변동", "신고"],
    "산재안전": ["산재", "다쳤", "사고", "안전", "산업재해", "위험"],
}

ARTICLE_RULE_HINTS = {
    "제22조": ["차별"],
    "제22조의2": ["기숙사"],
    "제25조": ["사업장 변경"],
    "제23조": ["보험", "임금"],
    "제13조": ["보험"],
    "제15조": ["보험"],
    "제9조": ["계약"],
    "제11조": ["교육"],
    "제11조의2": ["교육"],
    "제17조": ["고용변동"],
}

TRAINING_INDUSTRY_HINTS = {
    "제조업": ["기계", "용접", "전기", "전자", "설비", "가공", "지게차", "굴삭기"],
    "건설업": ["용접", "전기", "설비", "지게차", "굴삭기", "안전", "시공"],
    "서비스업": ["한국어", "요리", "미용", "서비스", "응대", "자격"],
    "농축산업": ["농업", "축산", "기계", "안전"],
}

RETRIEVAL_QUALITY_THRESHOLD = 0.32

EMERGENCY_KEYWORDS = [
    "여권", "통장", "빼앗", "압수", "강제 귀국", "강제귀국", "협박", "추방",
    "감금", "폭행", "합의서", "서명 강요", "지금 당장", "지금 빼앗겼",
    "도망", "탈출", "신변", "위험", "긴급",
]


def is_emergency_question(question: str) -> bool:
    return any(kw in question for kw in EMERGENCY_KEYWORDS)


def check_retrieval_quality(retrieved_docs: List[Dict[str, Any]]) -> bool:
    if not retrieved_docs:
        return False
    avg_score = sum(d.get("distance_score", 0.0) for d in retrieved_docs) / len(retrieved_docs)
    return avg_score >= RETRIEVAL_QUALITY_THRESHOLD


def load_training_courses_from_csv(csv_path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Training CSV not found: {csv_path}")

    last_error: Optional[Exception] = None
    raw_df = None
    for encoding in ("cp949", "euc-kr", "utf-8-sig"):
        try:
            raw_df = pd.read_csv(csv_path, encoding=encoding)
            break
        except Exception as exc:
            last_error = exc

    if raw_df is None:
        raise ValueError(f"Failed to read training CSV: {csv_path}") from last_error

    # Keep schema stable even when source headers vary.
    cols = list(raw_df.columns)
    if len(cols) < 12:
        raise ValueError("Training CSV has unexpected column count.")

    col_map = {
        "year": cols[0],
        "round": cols[1],
        "course_name": cols[2],
        "course_name_en": cols[3],
        "start_date": cols[4],
        "end_date": cols[5],
        "capacity": cols[6],
        "hours": cols[7],
        "institution": cols[8],
        "phone": cols[9],
        "address": cols[10],
        "description": cols[11],
    }

    df = raw_df.rename(columns={v: k for k, v in col_map.items()})[list(col_map.keys())].fillna("")
    records = df.to_dict(orient="records")
    return [{k: str(v).strip() for k, v in row.items()} for row in records]


def normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def recommend_training_courses(industry: str, keyword: str, top_k: int = 5) -> List[Dict[str, Any]]:
    global TRAINING_COURSES
    if not TRAINING_COURSES:
        raise RuntimeError("Training course data is not initialized.")

    q_keyword = normalize_for_match(keyword)
    q_industry = industry.strip()
    industry_hints = TRAINING_INDUSTRY_HINTS.get(q_industry, [])

    scored: List[Dict[str, Any]] = []
    for row in TRAINING_COURSES:
        searchable = normalize_for_match(
            " ".join(
                [
                    row.get("course_name", ""),
                    row.get("course_name_en", ""),
                    row.get("description", ""),
                    row.get("institution", ""),
                ]
            )
        )
        score = 0.0
        reasons: List[str] = []

        if q_keyword and q_keyword in searchable:
            score += 3.0
            reasons.append("관심 키워드 일치")
        elif q_keyword:
            for token in q_keyword.split():
                if token and token in searchable:
                    score += 1.2
                    reasons.append(f"관심 키워드 부분 일치({token})")

        hint_hits = [hint for hint in industry_hints if normalize_for_match(hint) in searchable]
        if hint_hits:
            score += min(2.0, 0.5 * len(hint_hits))
            reasons.append(f"업종 연관 키워드 일치({', '.join(hint_hits[:3])})")

        if score > 0:
            scored.append(
                {
                    **row,
                    "match_score": round(score, 3),
                    "match_reason": ", ".join(reasons),
                }
            )

    if not scored:
        fallback = sorted(
            TRAINING_COURSES,
            key=lambda x: (x.get("year", ""), x.get("start_date", "")),
            reverse=True,
        )[:top_k]
        return [{**row, "match_score": 0.0, "match_reason": "직접 일치가 없어 최신 과정 기준 추천"} for row in fallback]

    scored.sort(key=lambda x: (x["match_score"], x.get("year", ""), x.get("start_date", "")), reverse=True)
    return scored[:top_k]


def append_chat_message(session_store: Dict[str, List[Dict[str, str]]], conversation_id: str, role: str, content: str) -> None:
    if conversation_id not in session_store:
        session_store[conversation_id] = []

    session_store[conversation_id].append(
        {
            "role": role,
            "content": content.strip(),
        }
    )

    if len(session_store[conversation_id]) > MAX_CHAT_HISTORY:
        session_store[conversation_id] = session_store[conversation_id][-MAX_CHAT_HISTORY:]


def history_to_text(history: List[Dict[str, str]], max_turns: int = 6) -> str:
    if not history:
        return ""

    recent = history[-(max_turns * 2) :]
    lines = []
    for h in recent:
        speaker = "사용자" if h.get("role") == "user" else "상담AI"
        lines.append(f"{speaker}: {h.get('content', '').strip()}")
    return "\n".join(lines).strip()


def build_contextual_question_from_history(history: List[Dict[str, str]], current_message: str) -> str:
    recent_user_messages = [h.get("content", "").strip() for h in history if h.get("role") == "user" and h.get("content")]
    context_parts = recent_user_messages[-2:] + [current_message.strip()]
    return "\n".join([p for p in context_parts if p]).strip()


def format_training_assistant_message(
    industry: str,
    user_message: str,
    recommendations: List[Dict[str, Any]],
) -> str:
    if not recommendations:
        return (
            f"입력한 내용({user_message}) 기준으로 바로 추천할 과정을 찾지 못했습니다.\n"
            "키워드를 조금 더 구체적으로 바꿔서 다시 입력해 주세요.\n"
            "예: 용접, 지게차, 전기, 한국어"
        )

    lines = [
        f"요청한 내용({user_message})과 현재 업종({industry})을 기준으로 추천 과정을 찾았습니다.",
        "아래 과정을 먼저 확인해 보세요.",
        "",
    ]

    for i, rec in enumerate(recommendations[:3], start=1):
        lines.append(
            f"- {i}. {rec.get('course_name', '-')}"
            f" | 기관: {rec.get('institution', '-')}"
            f" | 기간: {rec.get('start_date', '-')} ~ {rec.get('end_date', '-')}"
        )

    lines.extend(
        [
            "",
            "원하면 다음 질문으로 더 좁혀서 추천해 드릴 수 있습니다.",
            "- 평일/주말 과정만 보고 싶어요",
            "- 지역이 가까운 기관 위주로 추천해줘",
            "- 한국어 과정만 다시 보여줘",
        ]
    )
    return "\n".join(lines).strip()


def extract_text_from_pdf(pdf_path: str) -> str:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    texts = []
    for page in doc:
        text = page.get_text("text")
        if text:
            texts.append(text)
    return "\n".join(texts)


def clean_law_text(text: str) -> str:
    lines = text.splitlines()
    cleaned = []

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("법제처"):
            continue
        if "국가법령정보센터" in line:
            continue
        if re.match(r"^제?\d+\s*/\s*\d+$", line):
            continue
        cleaned.append(line)

    text = "\n".join(cleaned)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def split_law_into_articles(full_text: str, law_name: str, law_type: str) -> List[Dict[str, Any]]:
    full_text = clean_law_text(full_text)
    parts = re.split(ARTICLE_HEADER_PATTERN, full_text)

    documents: List[Dict[str, Any]] = []
    current_header: Optional[str] = None

    for part in parts:
        part = part.strip()
        if not part:
            continue

        if re.match(ARTICLE_HEADER_PATTERN, part):
            current_header = part
        else:
            if current_header:
                article_no_match = re.match(r"(제\d+조(?:의\d+)?)", current_header)
                article_no = article_no_match.group(1) if article_no_match else ""

                title_match = re.match(r"제\d+조(?:의\d+)?\(([^)]+)\)", current_header)
                article_title_only = title_match.group(1) if title_match else ""

                full_article_text = f"{current_header}\n{part}".strip()

                documents.append(
                    {
                        "id": str(uuid.uuid4()),
                        "law_name": law_name,
                        "law_type": law_type,
                        "article_no": article_no,
                        "article_title": article_title_only,
                        "article_header": current_header,
                        "text": full_article_text,
                    }
                )
                current_header = None

    return documents


def build_law_corpus(pdf_infos: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    corpus: List[Dict[str, Any]] = []
    for info in pdf_infos:
        raw_text = extract_text_from_pdf(info["path"])
        docs = split_law_into_articles(
            full_text=raw_text,
            law_name=info["law_name"],
            law_type=info["law_type"],
        )
        corpus.extend(docs)
    return corpus


def get_embedding(text: str, model: str = EMBEDDING_MODEL) -> List[float]:
    response = client.embeddings.create(model=model, input=text)
    return response.data[0].embedding


def get_chroma_collection(
    persist_path: str = CHROMA_DB_PATH,
    collection_name: str = COLLECTION_NAME,
):
    local_chroma_client = chromadb.PersistentClient(path=persist_path)
    try:
        local_collection = local_chroma_client.get_collection(name=collection_name)
    except Exception:
        local_collection = local_chroma_client.create_collection(name=collection_name)
    return local_chroma_client, local_collection


def get_language_instruction(language: str) -> str:
    lang = (language or "ko").lower().strip()

    mapping = {
        "ko": "한국어",
        "en": "English",
        "vi": "Tiếng Việt",
        "zh": "中文",
        "th": "ภาษาไทย",
        "uz": "O'zbekcha",
    }

    return mapping.get(lang, "한국어")

def build_index_text(doc: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"법령명: {doc['law_name']}",
            f"법령종류: {doc['law_type']}",
            f"조문번호: {doc['article_no']}",
            f"조문제목: {doc['article_title']}",
            f"조문본문: {doc['text']}",
        ]
    )


def upsert_law_corpus_to_chroma(corpus: List[Dict[str, Any]], target_collection, batch_size: int = 20) -> None:
    existing_count = target_collection.count()
    if existing_count > 0:
        return

    for i in range(0, len(corpus), batch_size):
        batch = corpus[i : i + batch_size]

        ids = []
        documents = []
        embeddings = []
        metadatas = []

        for doc in batch:
            index_text = build_index_text(doc)
            emb = get_embedding(index_text)

            ids.append(doc["id"])
            documents.append(index_text)
            embeddings.append(emb)
            metadatas.append(
                {
                    "law_name": doc["law_name"],
                    "law_type": doc["law_type"],
                    "article_no": doc["article_no"],
                    "article_title": doc["article_title"],
                    "article_header": doc["article_header"],
                    "raw_text": doc["text"],
                }
            )

        target_collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )


def load_region_industry_options_from_excel(
    xlsx_path: str,
    latest_quarter: Optional[str] = None,
) -> Tuple[List[str], List[str]]:
    if not os.path.exists(xlsx_path):
        raise FileNotFoundError(f"Excel not found: {xlsx_path}")

    raw = pd.read_excel(xlsx_path, sheet_name="데이터", header=None, engine="openpyxl")

    quarters = raw.iloc[0].astype(str).str.strip().tolist()
    industries = raw.iloc[1].astype(str).str.strip().tolist()

    quarter_candidates = []
    for q in quarters[1:]:
        if q and q != "nan" and "행정구역" not in q:
            quarter_candidates.append(q)

    if not quarter_candidates:
        raise ValueError("No quarter information found in Excel.")

    selected_quarter = latest_quarter or sorted(set(quarter_candidates))[-1]

    selected_cols = [0]
    for i in range(1, len(quarters)):
        if quarters[i] == selected_quarter:
            selected_cols.append(i)

    df = raw.iloc[2:, selected_cols].copy()
    new_columns = ["region"] + [industries[i] for i in selected_cols[1:]]
    df.columns = new_columns
    df = df.reset_index(drop=True)

    df = df[df["region"] != "계"].copy()

    if "계" in df.columns:
        df = df.drop(columns=["계"])

    regions = sorted(df["region"].dropna().astype(str).str.strip().unique().tolist())
    industry_list = [col for col in df.columns if col != "region"]

    return regions, industry_list


def get_available_options() -> Dict[str, List[str]]:
    global AVAILABLE_REGIONS, AVAILABLE_INDUSTRIES
    return {
        "regions": AVAILABLE_REGIONS,
        "industries": AVAILABLE_INDUSTRIES,
    }


def build_user_context(region: str, industry: str, question: str) -> Dict[str, Any]:
    return {
        "region": region.strip(),
        "industry": industry.strip(),
        "question": question.strip(),
    }


def preprocess_question(question: str) -> str:
    question = question.replace("\n", " ").replace("\t", " ")
    question = re.sub(r"\s+", " ", question).strip()
    return question


def build_situation_input(context: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "region": context["region"],
        "industry": context["industry"],
        "question": preprocess_question(context["question"]),
    }


def extract_situation_with_llm(llm_input: Dict[str, Any], language: str = "ko") -> str:
    system_prompt = """
당신은 외국인근로자 노동상담 서비스의 상황 분석 AI입니다.
사용자의 질문을 읽고 아래 JSON 형식으로만 답하세요.

중요:
- 사용자가 어떤 언어로 입력하든 의미를 정확히 파악하세요.
- 출력 JSON의 모든 값은 한국어로 작성하세요.
- summary도 반드시 한국어로 작성하세요.

필수 키:
- main_category
- sub_category
- possible_issues
- keywords
- summary

규칙:
- main_category는 다음 중 하나를 우선 사용: 임금, 근로조건, 계약, 권리침해, 안전, 차별, 기타
- possible_issues와 keywords는 반드시 리스트
- JSON 이외의 텍스트를 출력하지 마세요.
""".strip()

    user_prompt = json.dumps(llm_input, ensure_ascii=False)
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
    )
    return response.choices[0].message.content or "{}"


def parse_llm_json_result(result_text: str) -> Dict[str, Any]:
    text = result_text.strip()
    text = re.sub(r"^```json", "", text).strip()
    text = re.sub(r"^```", "", text).strip()
    text = re.sub(r"```$", "", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse LLM JSON result: {text}") from exc

    if "possible_issues" not in parsed or not isinstance(parsed.get("possible_issues"), list):
        parsed["possible_issues"] = []
    if "keywords" not in parsed or not isinstance(parsed.get("keywords"), list):
        parsed["keywords"] = []

    return parsed

def parse_answer_json_result(result_text: str) -> Dict[str, Any]:
    text = result_text.strip()
    text = re.sub(r"^```json", "", text).strip()
    text = re.sub(r"^```", "", text).strip()
    text = re.sub(r"```$", "", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse answer JSON result: {text}") from exc

    final_answer = normalize_final_answer_text(str(parsed.get("final_answer", "")).strip())
    consultation_summary = parsed.get("consultation_summary", {}) or {}

    one_liner = str(consultation_summary.get("one_liner", "")).strip()
    action_items = consultation_summary.get("action_items", [])
    if not isinstance(action_items, list):
        action_items = []

    return {
        "final_answer": final_answer,
        "consultation_summary": {
            "one_liner": one_liner,
            "action_items": [str(x).strip() for x in action_items if str(x).strip()],
        },
    }

def run_stage_1_and_2(region: str, industry: str, question: str, language: str = "ko") -> Dict[str, Any]:
    context = build_user_context(region, industry, question)
    llm_input = build_situation_input(context)
    raw_result = extract_situation_with_llm(llm_input, language)
    parsed_result = parse_llm_json_result(raw_result)

    return {
        "context": context,
        "llm_input": llm_input,
        "situation_result_parsed": parsed_result,
    }


def build_retrieval_query(question: str, situation_result: Dict[str, Any]) -> str:
    main_category = situation_result.get("main_category", "")
    sub_category = situation_result.get("sub_category", "")
    possible_issues = situation_result.get("possible_issues", [])
    keywords = situation_result.get("keywords", [])

    possible_issues_text = ", ".join(possible_issues) if isinstance(possible_issues, list) else str(possible_issues)
    keywords_text = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)

    return f"""
사용자 질문: {question}
주요 문제 유형: {main_category}
세부 문제: {sub_category}
가능한 이슈: {possible_issues_text}
핵심 키워드: {keywords_text}

위 질문과 가장 관련 있는 외국인근로자 고용 법률, 시행령, 시행규칙의 조문을 검색하기 위한 질의
""".strip()


def get_keyword_hits(question: str) -> List[str]:
    hits = []
    q = question.lower()
    for label, words in RULE_KEYWORD_BOOSTS.items():
        for w in words:
            if w.lower() in q:
                hits.append(label)
                break
    return hits


def rerank_results(question: str, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    keyword_hits = get_keyword_hits(question)
    reranked = []

    for r in results:
        score = r["distance_score"]
        article_no = r.get("article_no", "")

        if article_no in ARTICLE_RULE_HINTS:
            related_labels = ARTICLE_RULE_HINTS[article_no]
            overlap = len(set(keyword_hits) & set(related_labels))
            score += overlap * 0.15

        reranked.append({**r, "final_score": score})

    reranked.sort(key=lambda x: x["final_score"], reverse=True)
    return reranked


def retrieve_relevant_articles(
    question: str,
    situation_result: Dict[str, Any],
    top_k: int = 8,
    rerank_top_k: int = 5,
) -> List[Dict[str, Any]]:
    global collection
    if collection is None:
        raise RuntimeError("Chroma collection is not initialized.")

    query_text = build_retrieval_query(question, situation_result)
    query_emb = get_embedding(query_text)

    res = collection.query(query_embeddings=[query_emb], n_results=top_k)

    results = []
    ids = res.get("ids", [[]])[0]
    metadatas = res.get("metadatas", [[]])[0]
    distances = res.get("distances", [[]])[0]

    for _id, meta, dist in zip(ids, metadatas, distances):
        similarity = 1 / (1 + dist) if dist is not None else 0.0
        results.append(
            {
                "id": _id,
                "law_name": meta.get("law_name", ""),
                "law_type": meta.get("law_type", ""),
                "article_no": meta.get("article_no", ""),
                "article_title": meta.get("article_title", ""),
                "article_header": meta.get("article_header", ""),
                "text": meta.get("raw_text", ""),
                "distance_score": similarity,
            }
        )

    reranked = rerank_results(question, results)
    return reranked[:rerank_top_k]


def format_retrieved_docs(retrieved_docs: List[Dict[str, Any]]) -> str:
    chunks = []
    for i, doc in enumerate(retrieved_docs, start=1):
        chunk = f"""
[{i}]
법령명: {doc['law_name']}
조문번호: {doc['article_no']}
조문제목: {doc['article_title']}
본문:
{doc['text']}
""".strip()
        chunks.append(chunk)
    return "\n\n".join(chunks)


def build_grounded_answer_prompt(
    question: str,
    region: str,
    industry: str,
    situation_result: Dict[str, Any],
    retrieved_docs: List[Dict[str, Any]],
    conversation_history_text: str = "",
    language: str = "ko",
    is_emergency: bool = False,
    low_quality_retrieval: bool = False,
) -> str:
    target_language = get_language_instruction(language)
    retrieved_text = format_retrieved_docs(retrieved_docs)

    emergency_instruction = ""
    if is_emergency:
        emergency_instruction = f"""
[긴급 상황 감지]
이 질문은 긴급한 상황을 포함합니다.
final_answer의 가장 첫 번째 항목으로 반드시 "지금 당장 할 수 있는 행동"을 {target_language}로 작성하고,
고용노동부 1350 또는 관련 긴급 연락처를 포함하세요.
""".strip()

    quality_instruction = ""
    if low_quality_retrieval:
        quality_instruction = f"""
[검색 품질 경고]
검색된 법령이 질문과 완전히 일치하지 않을 수 있습니다.
final_answer 시작에 "{target_language}로 '관련 법령을 정확히 찾지 못했을 수 있어 참고용으로만 활용하세요'라는 안내를 추가하세요.
""".strip()

    format_instruction = f"""
답변 형식 안내 ({target_language}로 작성):
- 긴급 상황이면: 지금 당장 할 수 있는 행동 → 핵심 안내 → 관련 법 조문 → 주의사항
- 일반 질문이면: 핵심 안내 → 관련 법 조문 → 사용자가 바로 할 수 있는 행동 → 주의사항
- 간단한 질문이면: 핵심 안내 → 관련 법 조문 (불필요한 항목은 생략 가능)
- 각 항목은 내용이 있을 때만 포함하고, 내용이 없으면 해당 항목은 생략하세요.
- 항목 제목은 한국어로 유지, 내용은 {target_language}로 작성하세요.
""".strip()

    return f"""
당신은 외국인근로자를 위한 노동법 안내 AI입니다.

사용자 정보:
- 지역: {region}
- 업종: {industry}

사용자 질문:
{question}

이전 대화 맥락:
{conversation_history_text if conversation_history_text else "없음"}

1차 상황 분석 결과:
{json.dumps(situation_result, ensure_ascii=False, indent=2)}

검색된 법령 근거:
{retrieved_text}

{emergency_instruction}
{quality_instruction}

지시사항:
1. 반드시 위에 제공된 검색된 법령 내용에 근거해서 답변하세요.
2. 법령에 없는 내용을 단정적으로 말하지 마세요. 불확실한 내용은 "확인이 필요합니다"로 표현하세요.
3. 사용자가 이해하기 쉬운 표현을 사용하고, 법률전문가처럼 단정하지 마세요.
4. Markdown 문법(**, __, #, `)은 사용하지 마세요.
5. JSON 이외의 텍스트를 출력하지 마세요.
6. consultation_summary.one_liner는 {target_language}로 한 줄 요약을 작성하세요.
7. consultation_summary.action_items는 {target_language}로 최대 3개, 가장 중요한 행동 우선 작성하세요.

{format_instruction}

반드시 아래 JSON 형식으로만 답하세요:
{{
  "final_answer": "항목명:\\n내용\\n\\n항목명:\\n내용",
  "consultation_summary": {{
    "one_liner": "한 줄 요약",
    "action_items": ["행동 1", "행동 2", "행동 3"]
  }}
}}
""".strip()


def normalize_final_answer_text(answer_text: str) -> str:
    text = (answer_text or "").replace("**", "").replace("__", "").strip()
    cleaned_lines = []
    for line in text.splitlines():
        line = re.sub(r"^\s{0,3}#{1,6}\s*", "", line)
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def generate_grounded_answer(
    question: str,
    region: str,
    industry: str,
    situation_result: Dict[str, Any],
    retrieved_docs: List[Dict[str, Any]],
    conversation_history_text: str = "",
    language: str = "ko",
    is_emergency: bool = False,
    low_quality_retrieval: bool = False,
) -> Dict[str, Any]:
    target_language = get_language_instruction(language)
    prompt = build_grounded_answer_prompt(
        question=question,
        region=region,
        industry=industry,
        situation_result=situation_result,
        retrieved_docs=retrieved_docs,
        conversation_history_text=conversation_history_text,
        language=language,
        is_emergency=is_emergency,
        low_quality_retrieval=low_quality_retrieval,
    )

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": f"당신은 검색된 법령 근거를 바탕으로만 답변하는 {target_language} 상담 AI입니다. 반드시 JSON으로만 답하세요.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    raw_answer = response.choices[0].message.content or ""
    return parse_answer_json_result(raw_answer)

def run_full_rag_pipeline(region: str, industry: str, question: str, language: str = "ko") -> Dict[str, Any]:
    stage_result = run_stage_1_and_2(region=region, industry=industry, question=question, language=language)
    situation_result = stage_result["situation_result_parsed"]

    retrieved_docs = retrieve_relevant_articles(
        question=question,
        situation_result=situation_result,
        top_k=8,
        rerank_top_k=5,
    )

    answer_result = generate_grounded_answer(
        question=question,
        region=region,
        industry=industry,
        situation_result=situation_result,
        retrieved_docs=retrieved_docs,
        language=language,
        is_emergency=is_emergency_question(question),
        low_quality_retrieval=not check_retrieval_quality(retrieved_docs),
    )
    final_answer = answer_result["final_answer"]
    consultation_summary = answer_result["consultation_summary"]
    return {
        "region": region,
        "industry": industry,
        "question": question,
        "situation_result": situation_result,
        "retrieved_docs": retrieved_docs,
        "final_answer": final_answer,
        "consultation_summary": consultation_summary,
    }


def run_law_chat_pipeline(conversation_id: str, region: str, industry: str, message: str, language: str = "ko",) -> Dict[str, Any]:
    global LAW_CHAT_SESSIONS
    append_chat_message(LAW_CHAT_SESSIONS, conversation_id, "user", message)

    history_before_answer = LAW_CHAT_SESSIONS.get(conversation_id, [])[:-1]
    conversation_history_text = history_to_text(history_before_answer, max_turns=5)
    contextual_question = build_contextual_question_from_history(history_before_answer, message)

    stage_result = run_stage_1_and_2(region=region, industry=industry, question=contextual_question, language=language)
    situation_result = stage_result["situation_result_parsed"]

    retrieved_docs = retrieve_relevant_articles(
        question=contextual_question,
        situation_result=situation_result,
        top_k=8,
        rerank_top_k=5,
    )

    answer_result = generate_grounded_answer(
        question=message,
        region=region,
        industry=industry,
        situation_result=situation_result,
        retrieved_docs=retrieved_docs,
        conversation_history_text=conversation_history_text,
        language=language,
        is_emergency=is_emergency_question(message),
        low_quality_retrieval=not check_retrieval_quality(retrieved_docs),
    )
    final_answer = answer_result["final_answer"]
    consultation_summary = answer_result["consultation_summary"]
    
    append_chat_message(LAW_CHAT_SESSIONS, conversation_id, "assistant", final_answer)

    return {
        "conversation_id": conversation_id,
        "assistant_message": final_answer,
        "consultation_summary": consultation_summary,
        "situation_result": situation_result,
        "retrieved_docs": retrieved_docs,
        "history": LAW_CHAT_SESSIONS.get(conversation_id, []),
    }


def enrich_recommendations_with_llm_reasons(
    recommendations: List[Dict[str, Any]],
    industry: str,
    keyword: str,
    language: str = "ko",
) -> List[Dict[str, Any]]:
    if not recommendations:
        return recommendations

    target_language = get_language_instruction(language)
    courses_text = "\n".join([
        f"{i + 1}. {r.get('course_name', '')} (기관: {r.get('institution', '')})"
        for i, r in enumerate(recommendations)
    ])

    system_prompt = (
        f"당신은 외국인근로자 직업훈련 추천 전문가입니다. "
        f"각 훈련 과정이 사용자의 업종과 관심 키워드에 왜 적합한지 {target_language}로 한 문장씩 설명해주세요. "
        f"반드시 JSON 배열 형태로만 답하세요: [\"이유1\", \"이유2\", ...]"
    )
    user_prompt = (
        f"업종: {industry}\n관심 키워드: {keyword}\n\n추천 과정 목록:\n{courses_text}\n\n"
        f"각 과정의 추천 이유를 {target_language}로 한 문장씩 작성해주세요."
    )

    try:
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )
        raw = response.choices[0].message.content or "[]"
        raw = re.sub(r"^```json", "", raw).strip()
        raw = re.sub(r"^```", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
        reasons: List[str] = json.loads(raw)

        enriched = []
        for i, rec in enumerate(recommendations):
            reason = reasons[i] if i < len(reasons) else rec.get("match_reason", "")
            enriched.append({**rec, "match_reason": str(reason).strip()})
        return enriched
    except Exception:
        return recommendations


def run_training_chat_pipeline(
    conversation_id: str,
    industry: str,
    message: str,
    top_k: int = 5,
    language: str = "ko",
) -> Dict[str, Any]:
    global TRAINING_CHAT_SESSIONS
    append_chat_message(TRAINING_CHAT_SESSIONS, conversation_id, "user", message)

    recommendations = recommend_training_courses(industry=industry, keyword=message, top_k=top_k)
    enriched_recommendations = enrich_recommendations_with_llm_reasons(
        recommendations=recommendations,
        industry=industry,
        keyword=message,
        language=language,
    )

    assistant_message = format_training_assistant_message(
        industry=industry,
        user_message=message,
        recommendations=enriched_recommendations,
    )

    append_chat_message(TRAINING_CHAT_SESSIONS, conversation_id, "assistant", assistant_message)

    return {
        "conversation_id": conversation_id,
        "industry": industry,
        "assistant_message": assistant_message,
        "recommendations": enriched_recommendations,
        "history": TRAINING_CHAT_SESSIONS.get(conversation_id, []),
    }


# =========================
# FastAPI App Lifecycle
# =========================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global chroma_client, collection, AVAILABLE_REGIONS, AVAILABLE_INDUSTRIES, TRAINING_COURSES

    chroma_client, collection = get_chroma_collection()

    corpus = build_law_corpus(LAW_PDF_PATHS)
    upsert_law_corpus_to_chroma(corpus, collection)

    AVAILABLE_REGIONS, AVAILABLE_INDUSTRIES = load_region_industry_options_from_excel(E9_XLSX_PATH)
    TRAINING_COURSES = load_training_courses_from_csv(TRAINING_CSV_PATH)

    yield


app = FastAPI(
    title="Foreign Worker Law RAG API",
    description="외국인근로자 법령 기반 상담 API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 배포 때는 프론트 도메인만 허용하는 게 좋음
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# API Endpoints
# =========================
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "collection_name": COLLECTION_NAME,
        "document_count": collection.count() if collection else 0,
    }


@app.get("/options")
def get_options():
    return {
        **get_available_options(),
        "languages": [
            {"code": "ko", "label": "한국어"},
            {"code": "en", "label": "English"},
            {"code": "vi", "label": "Tiếng Việt"},
            {"code": "zh", "label": "中文"},
            {"code": "th", "label": "ภาษาไทย"},
            {"code": "uz", "label": "O'zbekcha"},
        ],
    }


@app.post("/training/recommend")
def recommend_training(req: TrainingRecommendRequest):
    try:
        recommendations = recommend_training_courses(
            industry=req.industry,
            keyword=req.keyword,
            top_k=req.top_k,
        )
        return {
            "industry": req.industry,
            "keyword": req.keyword,
            "recommendations": recommendations,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}") from exc


@app.post("/chat/law/message")
def chat_law_message(req: LawChatMessageRequest):
    try:
        conversation_id = req.conversation_id or str(uuid.uuid4())
        return run_law_chat_pipeline(
            conversation_id=conversation_id,
            region=req.region,
            industry=req.industry,
            message=req.message,
            language=req.language,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}") from exc


@app.post("/chat/training/message")
def chat_training_message(req: TrainingChatMessageRequest):
    try:
        conversation_id = req.conversation_id or str(uuid.uuid4())
        return run_training_chat_pipeline(
            conversation_id=conversation_id,
            industry=req.industry,
            message=req.message,
            top_k=req.top_k,
            language=req.language,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}") from exc


@app.post("/ask", response_model=AskResponse)
def ask_question(req: AskRequest):
    try:
        result = run_full_rag_pipeline(
            region=req.region,
            industry=req.industry,
            question=req.question,
            language=req.language,
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}") from exc


@app.post("/retrieve")
def retrieve_only(req: AskRequest):
    try:
        stage_result = run_stage_1_and_2(
            region=req.region,
            industry=req.industry,
            question=req.question,
            language=req.language,
        )
        situation_result = stage_result["situation_result_parsed"]
        retrieved_docs = retrieve_relevant_articles(
            question=req.question,
            situation_result=situation_result,
            top_k=8,
            rerank_top_k=5,
        )
        return {
            "situation_result": situation_result,
            "retrieved_docs": retrieved_docs,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}") from exc


@app.get("/")
def root():
    return {
        "message": "Foreign Worker Law RAG API is running.",
        "docs": "/docs",
        "health": "/health",
        "options_endpoint": "/options",
        "ask_endpoint": "/ask",
        "training_recommend_endpoint": "/training/recommend",
        "law_chat_endpoint": "/chat/law/message",
        "training_chat_endpoint": "/chat/training/message",
    }


# Run locally:
# python3 -m uvicorn main:app --host 127.0.0.1 --port 8011