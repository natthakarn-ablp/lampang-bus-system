const SECRETARY_ONLY_FIELDS = ["decision", "conclusion", "owner", "dueDate"];

function secretaryIds(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isSecretary(user, configuredIds) {
  return Boolean(user?.userId && secretaryIds(configuredIds).has(user.userId));
}

export function authorizeEntriesRead(user, configuredIds) {
  if (!user?.userId) {
    return { status: 401, error: "กรุณาลงชื่อเข้าใช้ก่อนดูบันทึกการประชุม" };
  }
  if (!isSecretary(user, configuredIds)) {
    return { status: 403, error: "หน้านี้สำหรับเลขานุการที่ได้รับสิทธิ์เท่านั้น" };
  }
  return { status: 200 };
}

export function authorizeEntriesWrite(user, payload, configuredIds) {
  if (!user?.userId) {
    return { status: 401, error: "กรุณาลงชื่อเข้าใช้ก่อนบันทึกข้อมูล" };
  }
  if (isSecretary(user, configuredIds)) return { status: 200 };

  const writesMinutes = SECRETARY_ONLY_FIELDS.some((field) => {
    const value = payload?.[field];
    return typeof value === "string" ? value.trim().length > 0 : value != null;
  });
  const changesStatus =
    payload?.status != null && payload.status !== "" && payload.status !== "รอพิจารณา";

  if (writesMinutes || changesStatus) {
    return { status: 403, error: "ผู้เข้าร่วมบันทึกข้อเสนอได้ แต่บันทึกมติหรือมอบหมายงานไม่ได้" };
  }
  return { status: 200 };
}
