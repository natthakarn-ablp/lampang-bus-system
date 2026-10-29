import type { Metadata } from "next";
import "@fontsource/sarabun/400.css";
import "@fontsource/sarabun/600.css";
import "@fontsource/sarabun/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ชุดตรวจรับระบบและมติคณะทำงาน | School Bus Lampang",
  description: "พื้นที่สาธารณะสำหรับบันทึกข้อเสนอ ปัญหา มติ ข้อสรุป และผู้รับผิดชอบจากการตรวจรับระบบ School Bus Lampang",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="antialiased">{children}</body>
    </html>
  );
}
