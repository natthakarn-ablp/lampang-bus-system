import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import { authorizeEntriesRead } from "../../lib/meeting-access.mjs";
import SecretaryClient from "./secretary-client";

export const dynamic = "force-dynamic";

export default async function SecretaryPage() {
  const user = await getChatGPTUser();
  const access = authorizeEntriesRead(user, env.MEETING_SECRETARY_USER_IDS);
  if (access.status === 401) redirect(chatGPTSignInPath("/secretary"));
  if (access.status === 403) {
    return (
      <main className="shortPage">
        <section className="thankYou">
          <p className="eyebrow dark">จำกัดสิทธิ์</p>
          <h1>หน้านี้สำหรับเลขานุการ</h1>
          <p>บัญชีนี้ยังไม่ได้รับสิทธิ์ดูบันทึกหรือจัดการมติการประชุม</p>
          <a href="/">กลับไปแบบประเมิน</a>
        </section>
      </main>
    );
  }
  return <SecretaryClient />;
}
