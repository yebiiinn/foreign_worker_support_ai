import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPTS: Record<string, string> = {
  law: `당신은 질문의 관련성을 판단하는 분류기입니다.
주어진 질문이 다음 주제 중 하나와 관련이 있는지 판단하세요:
- 외국인 근로자의 노동법, 근로기준법
- 임금, 월급, 퇴직금, 수당
- 근무 환경, 근로 시간, 휴가, 휴일
- 산업재해, 업무상 재해
- 고용 계약, 해고, 이직, 사업장 변경
- 비자, 체류자격, 외국인 등록
- 직장 내 차별, 폭언, 괴롭힘
- 사회보험 (건강보험, 고용보험, 산재보험)

위 주제들과 관련이 있으면 "yes", 전혀 관련이 없으면 "no"로만 답하세요. 다른 말은 하지 마세요.`,

  training: `당신은 입력의 관련성을 판단하는 분류기입니다.
주어진 입력이 다음 주제 중 하나와 관련이 있는지 판단하세요:
- 직업훈련, 기술 교육, 자격증 취득
- 용접, 전기, 기계, IT, 한국어, 안전, 건설 등 직업 기술 분야
- 취업, 구직, 업무 스킬 향상
- 특정 산업 분야의 교육 과정 (제조업, 서비스업 등)
- 훈련 기관, 교육 일정, 수강 신청

위 주제들과 관련이 있으면 "yes", 전혀 관련이 없으면 "no"로만 답하세요. 다른 말은 하지 마세요.`,
};

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ valid: true });
  }

  let body: { question: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const { question, type = "law" } = body;
  if (!question?.trim()) {
    return NextResponse.json({ valid: false });
  }

  const systemPrompt = SYSTEM_PROMPTS[type] ?? SYSTEM_PROMPTS.law;

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        temperature: 0,
        max_tokens: 5,
      }),
    });

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "yes";
    const valid = answer.startsWith("yes");

    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: true });
  }
}
