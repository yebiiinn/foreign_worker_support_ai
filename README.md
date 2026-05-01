# 🤖 LAKI — 외국인 고용·근로 통합 AI 서비스

**Labor · AI · Key**

한국에서 일하는 외국인 근로자를 위한 AI 통합 지원 서비스입니다.  
언어와 제도의 벽 없이 노동법 상담, 직업훈련 추천, 마음 챙기기까지 한곳에서 제공합니다.

---

## 주요 기능

| 서비스 | 설명 |
|---|---|
| ⚖️ **법률 상담** | 외국인근로자 고용 등에 관한 법률·시행령·시행규칙 기반 RAG 상담 |
| 🎓 **직업훈련 추천** | 업종과 관심 키워드로 맞춤 직업훈련 과정 추천 |
| 🧘 **마음 챙기기** | 낯선 환경의 외로움·스트레스를 라키와 함께 대화 |

### 지원 언어

한국어 · English · Tiếng Việt · 中文 · ภาษาไทย · O'zbekcha

---

## 기술 스택

### Frontend
- **Next.js 16** (React 19, TypeScript)
- **Tailwind CSS v4**

### Backend
- **FastAPI** + **Uvicorn**
- **OpenAI** `gpt-4o-mini` (Chat), `text-embedding-3-small` (Embedding)
- **ChromaDB** — 법령 벡터 데이터베이스
- **PyMuPDF** — PDF 법령 문서 파싱

### 배포
- **Railway** (Backend · Frontend 각각 배포)

---

## 프로젝트 구조

```
project/
├── backend/
│   ├── main.py                  # FastAPI 앱 + RAG 파이프라인
│   ├── requirements.txt
│   ├── railway.toml
│   └── chroma_foreign_worker_law_db/   # 벡터 DB (자동 생성)
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # 메인 홈 (히어로 + 서비스 카드)
│   │   ├── law/                 # 법률 상담 페이지
│   │   ├── training/            # 직업훈련 추천 페이지
│   │   ├── mindfulness/         # 마음 챙기기 페이지
│   │   └── api/                 # Next.js API Routes (마스코트 등)
│   └── package.json
├── data/
│   ├── 외국인근로자의 고용 등에 관한 법률*.pdf   # 법률/시행령/시행규칙
│   ├── 행정구역_시도__업종별_일반고용허가제_E9_*.xlsx
│   └── 한국고용정보원_외국인_직업훈련 교육과정_*.csv
├── Dockerfile
└── railway.toml
```

---

## 로컬 실행

### 사전 요구사항
- Python 3.11+
- Node.js 20+
- OpenAI API Key

### 1. Backend

```bash
cd backend

# 가상환경 생성 및 활성화
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 패키지 설치
pip install -r requirements.txt

# 환경 변수 설정
cp .env.example .env
# .env 파일에 OPENAI_API_KEY 입력

# 서버 실행 (포트 8001)
python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

### 2. Frontend

```bash
cd frontend

# 패키지 설치
npm install

# 환경 변수 설정 (필요 시)
cp .env.local.example .env.local

# 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/health` | 서버 상태 확인 |
| `GET` | `/options` | 지역·업종·언어 목록 조회 |
| `POST` | `/chat/law/message` | 법률 상담 챗 (대화형 RAG) |
| `POST` | `/chat/training/message` | 직업훈련 추천 챗 |
| `POST` | `/ask` | 단건 법령 RAG 질의 |
| `POST` | `/training/recommend` | 직업훈련 직접 추천 |
| `GET` | `/docs` | Swagger UI |

---

## RAG 파이프라인

```
사용자 질문
    │
    ▼
1단계: 상황 분석 (LLM)
    └─ 카테고리 / 키워드 / 가능한 이슈 추출
    │
    ▼
2단계: 법령 검색 (ChromaDB)
    └─ 임베딩 유사도 검색 → 키워드 기반 Re-ranking
    │
    ▼
3단계: 답변 생성 (LLM)
    └─ 검색된 법령 근거 기반 grounded answer
    └─ 긴급 상황 감지 (여권 압수 / 폭행 등) → 우선 안내
```

---

## 환경 변수

### Backend (`.env`)

| 변수명 | 설명 | 기본값 |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API 키 | **필수** |
| `EMBEDDING_MODEL` | 임베딩 모델 | `text-embedding-3-small` |
| `CHAT_MODEL` | 채팅 모델 | `gpt-4o-mini` |
| `CHROMA_DB_PATH` | ChromaDB 경로 | `./chroma_foreign_worker_law_db` |

---

## 마스코트: 라키 (LAKI)

**Labor · AI · Key** — 노동 문제 해결의 열쇠

한국에서 일하는 외국인 근로자들이 언어와 제도의 벽 없이 안전하게 일할 수 있도록 돕는 AI 도우미입니다.

---

## 참고 자료 및 출처

- [외국인근로자의 고용 등에 관한 법률](https://www.law.go.kr/) (국가법령정보센터)
- [고용노동부 고객상담센터 1350](https://www.moel.go.kr/1350/)
- [외국인근로자지원센터](https://www.moel.go.kr/policy/policyinfo/foreigner/list.do)
- [HiKorea 포털](https://www.hikorea.go.kr/)
- 한국고용정보원 외국인 직업훈련 교육과정 데이터
- 행정구역 시도·업종별 일반고용허가제(E-9) 외국인 근로자 수 통계
