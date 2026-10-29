import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import QuestionnaireClient from "./questionnaire-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getChatGPTUser();
  if (!user) redirect(chatGPTSignInPath("/"));
  return <QuestionnaireClient />;
}
