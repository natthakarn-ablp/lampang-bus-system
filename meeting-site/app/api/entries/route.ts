import { desc } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { meetingEntries } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeEntriesRead, authorizeEntriesWrite } from "../../../lib/meeting-access.mjs";

const categories=new Set(["ทดลองใช้ตามหน้าที่","เรื่องที่คณะทำงานต้องตัดสินใจ","กฎหมายและความเป็นส่วนตัว","การสำรองและกู้คืนระบบ","ข้อมูลจริงที่ต้องตรวจเอกสาร","ข้อเสนอเพิ่มเติม"]);
const statuses=new Set(["รอพิจารณา","รอข้อมูล","รอสภาพแวดล้อม","มีมติแล้ว","กำลังดำเนินการ","เสร็จแล้ว"]);
const testResults=new Set(["ผ่าน","พบปัญหา","ยังไม่ได้ตรวจ","ไม่เกี่ยวข้อง"]);
const stakeholderGroups=new Set(["สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 1","สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 2","สำนักงานเขตพื้นที่การศึกษาประถมศึกษาลำปาง เขต 3","สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาลำปาง ลำพูน","สำนักงานศึกษาธิการจังหวัดลำปาง","สำนักงานขนส่งจังหวัดลำปาง","สำนักงานป้องกันและบรรเทาสาธารณภัยจังหวัดลำปาง","สำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัดลำปาง","สำนักงานพระพุทธศาสนาจังหวัดลำปาง","ผู้แทนครูและคณะทำงาน","ทีมหน่วยงานสนับสนุน","องค์กรสมาชิกและภาคีเครือข่าย"]);
const issueChoices=new Set(["ไม่พบปัญหา","หาปุ่มหรือเมนูไม่พบ","ข้อความหรือคำถามเข้าใจยาก","ขั้นตอนมากเกินไป","ตัวหนังสือหรือปุ่มเล็กเกินไป","หน้าเว็บโหลดช้า","ข้อมูลที่แสดงไม่ถูกต้องหรือไม่ครบ","เข้าใช้งานบางหน้าไม่ได้","รายงานอ่านยากหรือข้อมูลไม่พอ"]);
const improvementChoices=new Set(["ยังไม่ต้องปรับ","ลดจำนวนขั้นตอน","ขยายตัวหนังสือและปุ่ม","เปลี่ยนชื่อเมนูหรือคำอธิบาย","เพิ่มคำแนะนำทีละขั้น","ปรับความเร็วของหน้าเว็บ","ปรับข้อมูลหรือรายงาน","แก้สิทธิ์การเข้าใช้งาน","เรื่องอื่น ๆ"]);
const shortFormVersion="short-5-20261021";
const shortParticipationChoices=new Set(["เสนอปัญหาหรือความต้องการ","ทดลองใช้หรือดูการสาธิตระบบ","เสนอแนวทางปรับปรุง","ร่วมพิจารณาข้อสรุป","รับผิดชอบนำไปดำเนินการต่อ"]);
const shortPriorityChoices=new Set(["ขั้นตอนใช้งานให้ง่ายขึ้น","ชื่อเมนูและคำอธิบายให้เข้าใจง่าย","ตัวหนังสือและปุ่มให้ใหญ่ขึ้น","ข้อมูลและรายงานให้ชัดเจนขึ้น","ความเร็วในการใช้งาน","ยังไม่พบเรื่องที่ต้องปรับ","ยังไม่ได้ทดลองใช้"]);
const clean=(value:unknown,limit:number)=>typeof value==="string"?value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").trim().slice(0,limit):"";
const checked=(value:unknown)=>value===true?1:0;
const score=(value:unknown)=>{const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=5?n:0};

export async function GET(){
  const access=authorizeEntriesRead(await getChatGPTUser(),env.MEETING_SECRETARY_USER_IDS);
  if(access.status!==200)return Response.json({error:access.error},{status:access.status,headers:{"Cache-Control":"no-store"}});
  try{return Response.json({entries:await getDb().select().from(meetingEntries).orderBy(desc(meetingEntries.id)).limit(500)},{headers:{"Cache-Control":"no-store"}})}
  catch{return Response.json({error:"ยังอ่านฐานข้อมูลการประชุมไม่ได้"},{status:500})}
}
export async function POST(request:Request){
  try{
    const user=await getChatGPTUser();
    if(!user)return Response.json({error:"กรุณาลงชื่อเข้าใช้ก่อนบันทึกข้อมูล"},{status:401});
    const p=await request.json() as Record<string,unknown>;
    const access=authorizeEntriesWrite(user,p,env.MEETING_SECRETARY_USER_IDS);
    if(access.status!==200)return Response.json({error:access.error},{status:access.status});
    if(clean(p.website,100))return Response.json({error:"ไม่สามารถบันทึกรายการนี้ได้"},{status:400});
    if(p.formVersion===shortFormVersion){
      const stakeholderGroup=clean(p.organization,120);
      const participation=Array.isArray(p.participation)?[...new Set(p.participation.map(value=>clean(value,120)))]:[];
      const rawBenefits=Array.isArray(p.benefits)?p.benefits:[];
      const benefits=rawBenefits.map(value=>Number(value));
      const improvementChoice=clean(p.priority,120),proposal=clean(p.suggestion,400);
      if(!stakeholderGroups.has(stakeholderGroup))return Response.json({error:"กรุณาเลือกหน่วยงานของท่าน"},{status:400});
      if(participation.some(value=>!shortParticipationChoices.has(value)))return Response.json({error:"กรุณาตรวจคำตอบเรื่องการมีส่วนร่วม"},{status:400});
      if(rawBenefits.length!==3||rawBenefits.some(value=>!/^([0-5])$/.test(String(value)))||benefits.some(value=>!Number.isInteger(value)))return Response.json({error:"กรุณาเลือกคำตอบในแต่ละด้าน หรือเลือก ‘ยังประเมินไม่ได้’"},{status:400});
      if(!shortPriorityChoices.has(improvementChoice))return Response.json({error:"กรุณาเลือกเรื่องที่อยากให้ปรับก่อน"},{status:400});
      const [entry]=await getDb().insert(meetingEntries).values({formVersion:shortFormVersion,participationChoices:participation.join(" | "),category:"ทดลองใช้ตามหน้าที่",topic:"แบบประเมินฉบับสั้น 5 ข้อ",role:"ผู้ตอบแบบประเมิน",reporter:"ไม่เก็บชื่อผู้ประเมิน",testResult:"ไม่เกี่ยวข้อง",stakeholderGroup,educationBenefitScore:benefits[0],transportBenefitScore:benefits[1],networkBenefitScore:benefits[2],improvementChoice,proposal,status:"รอพิจารณา"}).returning();
      return Response.json({entry},{status:201});
    }
    if(p.confirmSafe!==true)return Response.json({error:"กรุณายืนยันว่าไม่มีข้อมูลส่วนบุคคลหรือข้อมูลลับ"},{status:400});
    const category=clean(p.category,80),topic=clean(p.topic,180),status=clean(p.status,40),testResult=clean(p.testResult,40)||"ยังไม่ได้ตรวจ",testedWork=clean(p.testedWork,500),issue=clean(p.issue,1600),proposal=clean(p.proposal,1600),decision=clean(p.decision,1600),conclusion=clean(p.conclusion,1600),dueDate=clean(p.dueDate,10),stakeholderGroup=clean(p.stakeholderGroup,120),improvementChoice=clean(p.improvementChoice,120);
    const issueOptions=Array.isArray(p.issueOptions)?[...new Set(p.issueOptions.map(v=>clean(v,120)).filter(v=>issueChoices.has(v)))]:[];
    const participatedProblemDefinition=checked(p.participatedProblemDefinition),participatedDataReview=checked(p.participatedDataReview),participatedSystemTrial=checked(p.participatedSystemTrial),participatedDecision=checked(p.participatedDecision),participatedImplementation=checked(p.participatedImplementation),participatedFollowup=checked(p.participatedFollowup);
    const educationBenefitScore=score(p.educationBenefitScore),transportBenefitScore=score(p.transportBenefitScore),networkBenefitScore=score(p.networkBenefitScore),participationScore=score(p.participationScore),researchUseAcknowledged=checked(p.researchUseAcknowledged);
    if(!categories.has(category)||!topic)return Response.json({error:"หมวดหรือหัวข้อไม่ถูกต้อง"},{status:400});
    if(!statuses.has(status))return Response.json({error:"สถานะไม่ถูกต้อง"},{status:400});
    if(!testResults.has(testResult))return Response.json({error:"ผลการตรวจไม่ถูกต้อง"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!stakeholderGroups.has(stakeholderGroup))return Response.json({error:"กรุณาเลือกกลุ่มหน่วยงานของผู้ประเมิน"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&![participatedProblemDefinition,participatedDataReview,participatedSystemTrial,participatedDecision,participatedImplementation,participatedFollowup].some(Boolean))return Response.json({error:"กรุณาเลือกอย่างน้อยหนึ่งขั้นตอนที่ได้มีส่วนร่วม"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&![educationBenefitScore,transportBenefitScore,networkBenefitScore,participationScore].every(Boolean))return Response.json({error:"กรุณาให้คะแนนทั้ง 4 ข้อ ตั้งแต่ 1 ถึง 5"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!researchUseAcknowledged)return Response.json({error:"กรุณารับทราบวิธีนำคำตอบแบบไม่ระบุตัวบุคคลไปสรุปผล"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!testedWork)return Response.json({error:"กรุณาระบุว่าคุณทดลองทำงานอะไร"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!clean(p.deviceBrowser,200))return Response.json({error:"กรุณาเลือกอุปกรณ์ที่ใช้"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!issueOptions.length)return Response.json({error:"กรุณาเลือกปัญหาที่พบ หรือเลือก ‘ไม่พบปัญหา’"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&!improvementChoices.has(improvementChoice))return Response.json({error:"กรุณาเลือกสิ่งที่ควรปรับเป็นอันดับแรก"},{status:400});
    if(category==="ทดลองใช้ตามหน้าที่"&&testResult==="พบปัญหา"&&issueOptions.includes("ไม่พบปัญหา"))return Response.json({error:"ผลการใช้งานและปัญหาที่เลือกไม่ตรงกัน"},{status:400});
    if(issueOptions.includes("ไม่พบปัญหา")&&issueOptions.length>1)return Response.json({error:"หากเลือก ‘ไม่พบปัญหา’ ไม่ควรเลือกปัญหาอื่นร่วมด้วย"},{status:400});
    if(category!=="ทดลองใช้ตามหน้าที่"&&![issue,proposal,decision,conclusion].some(Boolean))return Response.json({error:"กรุณากรอกปัญหา ข้อเสนอ มติ หรือข้อสรุปอย่างน้อยหนึ่งช่อง"},{status:400});
    if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return Response.json({error:"วันที่กำหนดเสร็จไม่ถูกต้อง"},{status:400});
    if([issue,proposal,decision,conclusion].reduce((n,v)=>n+v.length,0)>5000)return Response.json({error:"ข้อความยาวเกินไป กรุณาสรุปเฉพาะสาระสำคัญ"},{status:400});
    const [entry]=await getDb().insert(meetingEntries).values({category,topic,role:clean(p.role,100)||"ไม่ระบุบทบาท",reporter:category==="ทดลองใช้ตามหน้าที่"?"ไม่เก็บชื่อผู้ประเมิน":clean(p.reporter,100)||"ไม่ระบุชื่อ",testedWork,deviceBrowser:clean(p.deviceBrowser,200),testResult,stakeholderGroup:category==="ทดลองใช้ตามหน้าที่"?stakeholderGroup:"",participatedProblemDefinition:category==="ทดลองใช้ตามหน้าที่"?participatedProblemDefinition:0,participatedDataReview:category==="ทดลองใช้ตามหน้าที่"?participatedDataReview:0,participatedSystemTrial:category==="ทดลองใช้ตามหน้าที่"?participatedSystemTrial:0,participatedDecision:category==="ทดลองใช้ตามหน้าที่"?participatedDecision:0,participatedImplementation:category==="ทดลองใช้ตามหน้าที่"?participatedImplementation:0,participatedFollowup:category==="ทดลองใช้ตามหน้าที่"?participatedFollowup:0,educationBenefitScore:category==="ทดลองใช้ตามหน้าที่"?educationBenefitScore:0,transportBenefitScore:category==="ทดลองใช้ตามหน้าที่"?transportBenefitScore:0,networkBenefitScore:category==="ทดลองใช้ตามหน้าที่"?networkBenefitScore:0,participationScore:category==="ทดลองใช้ตามหน้าที่"?participationScore:0,researchUseAcknowledged:category==="ทดลองใช้ตามหน้าที่"?researchUseAcknowledged:0,observedIssueOptions:category==="ทดลองใช้ตามหน้าที่"?issueOptions.join(" | "):"",improvementChoice:category==="ทดลองใช้ตามหน้าที่"?improvementChoice:"",issue,proposal,decision,conclusion,owner:clean(p.owner,120),dueDate,status}).returning();
    return Response.json({entry},{status:201});
  }catch{return Response.json({error:"บันทึกไม่สำเร็จ กรุณาลองใหม่"},{status:500})}
}
