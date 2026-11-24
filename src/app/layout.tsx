import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "StudyHub — Nền tảng tự học & luyện thi cá nhân",
    template: "%s | StudyHub",
  },
  description:
    "Nền tảng tự học, ôn tập flashcard, nhập đề thông minh không dùng AI và luyện thi trắc nghiệm dành cho học sinh, sinh viên và bạn bè.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <a href="#main-content" className="skip-to-content">
          Chuyển đến nội dung chính
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
