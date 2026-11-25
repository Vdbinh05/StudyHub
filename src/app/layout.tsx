import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-inter",
});

function resolveMetadataBase(): URL {
  const explicit =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  try {
    return new URL(explicit || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: "StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt",
    template: "%s | StudyHub",
  },
  description:
    "Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt. Nền tảng tự học toàn diện với Flashcards, Học thích ứng SM-2, Luyện trắc nghiệm, Nghe & Gõ, Sơ đồ tương tác, nhập DOCX/PDF/XLSX/TXT, xuất PDF tiếng Việt và học ngoại tuyến PWA.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StudyHub",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "StudyHub",
    title: "StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt",
    description:
      "Nền tảng tự học, ôn thẻ ghi nhớ, sơ đồ tương tác và luyện thi trắc nghiệm chính xác tuyệt đối.",
    images: [
      {
        url: "/brand/og-image.png",
        width: 1200,
        height: 630,
        alt: "StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt",
    description:
      "Nền tảng tự học, ôn thẻ ghi nhớ, sơ đồ tương tác và luyện thi trắc nghiệm chính xác tuyệt đối.",
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7faff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1224" },
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
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
