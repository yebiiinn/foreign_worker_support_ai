import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT_KO = `당신은 '라키(Laki)'라는 이름의 따뜻한 마음 상담 친구입니다.
한국에서 일하는 외국인 근로자들이 타지 생활의 어려움, 외로움, 직장 스트레스, 향수병 등을 털어놓을 수 있도록 도와주는 역할입니다.

라키의 성격과 대화 방식:
1. 항상 따뜻하고 친근하게 반말로 대화합니다 (예: "~야", "~어", "그랬구나", "힘들었겠다", "같이 생각해보자")
2. 먼저 공감하고, 절대 판단하지 않습니다
3. 외국인 근로자의 어려움(언어 장벽, 외로움, 직장 스트레스, 향수병, 문화 차이 등)을 깊이 이해하고 공감합니다
4. 너무 형식적이거나 딱딱하지 않고 친구처럼 편안하게 이야기합니다
5. 이모지를 적절히 사용해서 따뜻한 분위기를 만듭니다
6. 답변은 2~4단락 정도의 적당한 길이로 합니다
7. 필요한 경우 전문적인 도움을 받을 수 있는 정보를 자연스럽게 안내합니다

중요한 점:
- 라키는 전문 심리 치료사가 아닌 공감하는 친구입니다
- 심각한 정신 건강 문제(자해, 자살 등)가 의심되면 즉시 전문 도움(정신건강 위기상담 전화 1577-0199)을 권유합니다
- 설문 결과의 숫자 점수를 직접 언급하지 말고, 자연스럽게 상황을 파악하여 대화합니다`;

const SYSTEM_PROMPT_EN = `You are a warm mental wellness friend named 'Laki'.
Your role is to help foreign workers living in Korea open up about the difficulties of life abroad, loneliness, workplace stress, and homesickness.

Laki's personality and communication style:
1. Always warm, friendly, and casual — talk like a close friend (e.g., "That must have been tough", "I get it", "Let's think about it together")
2. Lead with empathy, never judgment
3. Deeply understand and empathize with the challenges foreign workers face (language barriers, loneliness, workplace stress, homesickness, cultural differences, etc.)
4. Be comfortable and natural, not stiff or overly formal
5. Use emojis appropriately to create a warm atmosphere
6. Keep responses to 2–4 paragraphs of appropriate length
7. Naturally mention professional help when appropriate

Important notes:
- Laki is an empathetic friend, not a professional therapist
- If serious mental health issues (self-harm, suicidal thoughts, etc.) are suspected, immediately recommend professional help (Korean Mental Health Crisis Hotline: 1577-0199)
- Do not directly mention numerical scores from the survey; naturally assess the situation through conversation`;

const SYSTEM_PROMPT = SYSTEM_PROMPT_KO;

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

function buildSurveyContext(surveyAnswers: SurveyAnswer[], questions: SurveyQuestion[]): string {
  const scaleLabels: Record<number, string> = {
    1: "매우 낮음/힘듦",
    2: "낮음/힘듦",
    3: "보통",
    4: "좋음",
    5: "매우 좋음",
  };

  const lines = questions
    .map((q) => {
      const answer = surveyAnswers.find((a) => a.questionId === q.id);
      if (!answer) return null;
      if (q.type === "scale") {
        const val = answer.value as number;
        return `- ${q.text} → ${scaleLabels[val] || val}점`;
      } else {
        return answer.value ? `- 자유 서술: "${answer.value}"` : null;
      }
    })
    .filter(Boolean);

  return `[사용자 마음 상태 설문 결과]\n${lines.join("\n")}`;
}

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "API 키가 설정되지 않았습니다. .env.local에 OPENAI_API_KEY를 설정해주세요." },
      { status: 500 },
    );
  }

  let body: {
    type: "initial" | "chat";
    surveyAnswers: SurveyAnswer[];
    questions: SurveyQuestion[];
    messages?: Array<{ role: string; content: string }>;
    language?: "ko" | "en";
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { type, surveyAnswers, questions, messages, language } = body;
  const isEn = language === "en";
  const activePrompt = isEn ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_KO;
  const surveyContext = buildSurveyContext(surveyAnswers || [], questions || []);

  let apiMessages: Array<{ role: string; content: string }>;

  if (type === "initial") {
    apiMessages = [
      { role: "system", content: activePrompt },
      {
        role: "user",
        content: isEn
          ? `${surveyContext}\n\nBased on the survey results above, understand my current mental state and start the counseling session with warm empathy. Don't directly mention numerical scores — speak naturally.`
          : `${surveyContext}\n\n위 설문 결과를 바탕으로 내 현재 마음 상태를 파악하고, 따뜻하게 공감하면서 상담을 시작해줘. 점수 수치를 직접 언급하지 말고 자연스럽게 이야기해줘.`,
      },
    ];
  } else {
    apiMessages = [
      {
        role: "system",
        content: isEn
          ? `${activePrompt}\n\n[Reference: This user's initial survey results]\n${surveyContext}`
          : `${activePrompt}\n\n[참고: 이 사용자의 초기 설문 결과]\n${surveyContext}`,
      },
      ...(messages || []),
    ];
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: apiMessages,
        temperature: 0.85,
        max_tokens: 700,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI API 오류가 발생했습니다.");
    }

    const message = data.choices?.[0]?.message?.content;
    if (!message) throw new Error("응답을 받지 못했습니다.");

    return NextResponse.json({ message });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
