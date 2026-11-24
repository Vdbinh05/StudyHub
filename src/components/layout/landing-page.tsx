"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GraduationCap,
  Layers,
  Lock,
  PenLine,
  Repeat,
  ShieldCheck,
  Shuffle,
  Upload,
  Users,
} from "lucide-react";
import { FadeIn, StaggerItem, StaggerList } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { BrandLogo } from "./brand-logo";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";

export function LandingPage() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";

  const studyModes = [
    {
      icon: Layers,
      title: vi ? "Thẻ ghi nhớ (Flashcards)" : "3D Flashcards",
      desc: vi
        ? "Lật thẻ mượt mà, điều khiển bằng bàn phím, lọc riêng thẻ chưa thuộc và đọc phát âm trực tiếp."
        : "Crisp card flips, keyboard shortcuts, unknown-card review loop, and browser speech playback.",
    },
    {
      icon: Repeat,
      title: vi ? "Học sâu lặp lại ngắt quãng" : "Adaptive Learn (SM-2)",
      desc: vi
        ? "Lịch ôn tập khoa học: câu trả lời sai tự động xuất hiện lại đúng nhịp để ghi nhớ bền lâu."
        : "Spaced repetition scheduling: missed questions re-enter your queue at the right interval.",
    },
    {
      icon: CheckCircle2,
      title: vi ? "Luyện trắc nghiệm linh hoạt" : "Custom Practice",
      desc: vi
        ? "Hiện đáp án và giải thích ngay sau mỗi câu; lọc nhanh theo nhiều môn, chương, câu sai hoặc câu gắn sao."
        : "Instant answer feedback with explanations; filter by subjects, chapters, mistakes, or starred items.",
    },
    {
      icon: PenLine,
      title: vi ? "Gõ đáp án tự luận ngắn" : "Typed Recall (Write)",
      desc: vi
        ? "Kiểm tra trí nhớ chủ động bằng cách tự nhập câu trả lời, tùy chọn so khớp linh hoạt hoa thường và dấu."
        : "Active recall grading against accepted answers with strict or flexible matching options.",
    },
    {
      icon: Shuffle,
      title: vi ? "Ghép cặp bấm giờ" : "Timed Match",
      desc: vi
        ? "Ghép cặp câu hỏi — đáp án rõ ràng không trùng nghĩa, hỗ trợ chuột, cảm ứng và bàn phím."
        : "Disambiguated pair matching with timer, touch support, and complete keyboard navigation.",
    },
    {
      icon: Clock,
      title: vi ? "Thi thử nhiều môn & Phủ 100%" : "Multi-Subject Mock Exams",
      desc: vi
        ? "Ghép nhiều môn vào một đề thi, chọn số câu bất kỳ, tự lưu bài làm và phân tích điểm theo từng môn & chương."
        : "Combine multiple subjects, pick any question count, autosave progress, and break down scores by topic.",
    },
  ];

  const importFormats = [
    {
      icon: FileText,
      name: "Word (.docx)",
      detail: vi
        ? "Tự nhận diện đáp án in đậm, tô sáng, gạch chân, màu chữ, bảng Word và nhiều chương."
        : "Detects bold, highlight, underline, font color, Word tables, and multi-chapter keys.",
    },
    {
      icon: FileText,
      name: "EduQuiz & Văn bản (.txt)",
      detail: vi
        ? "Hỗ trợ dấu sao *B., dòng Đáp án: A và bảng đáp án đặt ở cuối tài liệu."
        : "Supports *B. markers, inline Answer: A lines, and end-of-document answer keys.",
    },
    {
      icon: FileSpreadsheet,
      name: "Excel & Bảng tính (.xlsx / .csv)",
      detail: vi
        ? "Tự nhận diện cột đề thi mẫu, hỗ trợ tiếng Việt có dấu chuẩn xác và xuất lại nhanh chóng."
        : "Visual column mapper, full Vietnamese UTF-8 support, and lossless round-trip export.",
    },
    {
      icon: Upload,
      name: "Quizlet TSV & Sao lưu JSON",
      detail: vi
        ? "Nhập trực tiếp từ bộ thẻ Quizlet và sao lưu, khôi phục toàn bộ dữ liệu học tập bất cứ lúc nào."
        : "Import Quizlet term/definition lists plus lossless JSON backup and restore anytime.",
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col overflow-x-clip">
      {/* Header */}
      <header className="border-border bg-card/90 sticky top-0 z-30 border-b backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <Link href="/" aria-label="StudyHub" className="shrink-0">
            <BrandLogo />
          </Link>

          <nav
            aria-label={vi ? "Điều hướng trang chủ" : "Landing"}
            className="hidden items-center gap-6 md:flex"
          >
            <a
              href="#import"
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {vi ? "Nhập đề đa định dạng" : "Bulk Import"}
            </a>
            <a
              href="#modes"
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {vi ? "6 Chế độ học" : "6 Study Modes"}
            </a>
            <a
              href="#sharing"
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {vi ? "Chia sẻ & Riêng tư" : "Sharing & Privacy"}
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LanguageToggle />
            <ThemeToggle compact />
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="hidden min-h-11 px-2.5 sm:inline-flex sm:min-h-9 sm:px-3"
            >
              <Link href="/login">{t("nav.signIn")}</Link>
            </Button>
            <Button
              size="sm"
              asChild
              className="min-h-11 px-3 sm:min-h-9 sm:px-4"
            >
              <Link href="/register">{t("nav.signUp")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {/* Hero Section */}
        <section className="border-border border-b py-12 sm:py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12">
            <FadeIn aboveFold className="space-y-6 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  <span>
                    {vi
                      ? "Chấm điểm đúng 100% theo đáp án gốc"
                      : "100% Exact Answer-Key Grading"}
                  </span>
                </Badge>
                <Badge variant="secondary">
                  {vi
                    ? "Miễn phí cá nhân & nhóm bạn"
                    : "Free for personal & study groups"}
                </Badge>
              </div>

              <h1 className="text-foreground text-3xl font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.15]">
                {vi
                  ? "Tự học, ôn thẻ ghi nhớ và luyện thi trắc nghiệm chính xác tuyệt đối."
                  : "Study flashcards, drill question banks, and run timed mock exams with zero guesswork."}
              </h1>

              <p className="text-muted-foreground max-w-2xl text-base leading-relaxed sm:text-lg">
                {vi
                  ? "Nhập nhanh ngân hàng hàng nghìn câu hỏi từ Word, Excel, TXT; ghép nhiều môn học thành đề thi thử bấm giờ hoặc phủ trọn 100% ngân hàng câu hỏi — không quảng cáo, không giới hạn lượt làm bài."
                  : "Import thousands of questions from Word, Excel, and TXT; combine multiple subjects into timed mock exams or non-repeating full-coverage cycles — no ads, no artificial limits."}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button size="lg" asChild className="min-h-11 px-6">
                  <Link href="/register">
                    <span>
                      {vi ? "Tạo tài khoản miễn phí" : "Create free account"}
                    </span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="min-h-11 px-5"
                >
                  <Link href="/exams/new">
                    <FileCheck2 className="size-4" aria-hidden="true" />
                    <span>{t("nav.customExam")}</span>
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  asChild
                  className="min-h-11 px-4"
                >
                  <Link href="/login">{t("nav.signIn")}</Link>
                </Button>
              </div>

              <dl className="border-border grid grid-cols-2 gap-4 border-t pt-6 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Quy mô bộ đề" : "Bank scale"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    10,000+
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Chế độ ôn & thi" : "Study & exam modes"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    6
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Định dạng nhập/xuất" : "Import formats"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-base font-bold whitespace-nowrap sm:text-lg">
                    DOCX · XLSX · TXT
                  </dd>
                </div>
              </dl>
            </FadeIn>

            {/* Structured Product Workflow Preview */}
            <FadeIn aboveFold className="lg:col-span-5">
              <Card className="border-border shadow-sm">
                <CardHeader className="border-border border-b pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GraduationCap
                        className="text-primary size-5"
                        aria-hidden="true"
                      />
                      <span>
                        {vi ? "Quy trình ôn thi 3 bước" : "3-Step Exam Workflow"}
                      </span>
                    </CardTitle>
                    <Badge variant="success">
                      {vi ? "Không giới hạn" : "Unlimited"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {[
                    {
                      step: "01",
                      title: vi
                        ? "Nhập đề từ Word, Excel, TXT, Quizlet"
                        : "Import DOCX, XLSX, TXT, Quizlet",
                      desc: vi
                        ? "Tự phát hiện đáp án in đậm, tô sáng, màu chữ, *B. và báo ngay câu thiếu đáp án để bạn kiểm tra."
                        : "Detects bold, highlight, font color, and *B. markers with inline review before saving.",
                    },
                    {
                      step: "02",
                      title: vi
                        ? "Ôn tập khoa học theo lịch lặp lại"
                        : "Master via Spaced Repetition",
                      desc: vi
                        ? "Thẻ ghi nhớ, Học sâu, Luyện trắc nghiệm, Gõ đáp án và Ghép cặp đồng bộ tiến độ từng câu hỏi."
                        : "Flashcards, Learn, Practice, Write, and Match track mastery per question.",
                    },
                    {
                      step: "03",
                      title: vi
                        ? "Thi thử nhiều môn như thi thật"
                        : "Multi-Subject Timed Mock Exams",
                      desc: vi
                        ? "Đảo câu hỏi và đảo đáp án A/B/C/D không bao giờ lệch đáp án, tự lưu bài làm và chấm điểm chi tiết theo môn."
                        : "Shuffled options always preserve exact grading, with live autosave and subject breakdowns.",
                    },
                  ].map((item) => (
                    <div
                      key={item.step}
                      className="bg-secondary/60 flex items-start gap-3.5 rounded-lg p-3.5"
                    >
                      <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold tabular-nums">
                        {item.step}
                      </span>
                      <div className="min-w-0">
                        <p className="text-foreground text-sm font-semibold">
                          {item.title}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </FadeIn>
          </div>
        </section>

        {/* Multi-Format Bulk Import Section */}
        <section id="import" className="py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
                {vi
                  ? "Nhập ngân hàng câu hỏi đa định dạng, kiểm tra rõ từng đáp án"
                  : "Multi-format bulk import with clear answer verification"}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
                {vi
                  ? "Trình nhập đề kiểm tra lỗi định dạng, câu thiếu đáp án và câu trùng lặp trực tiếp trên danh sách mượt mà ngay cả với hàng nghìn câu hỏi trước khi lưu vào thư viện."
                  : "Our step-by-step import wizard catches missing answers, formatting conflicts, and duplicates inline across thousands of questions before saving to your library."}
              </p>
            </div>

            <StaggerList className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {importFormats.map((fmt) => {
                const Icon = fmt.icon;
                return (
                  <StaggerItem key={fmt.name}>
                    <Card className="h-full">
                      <CardContent className="space-y-2.5 pt-1">
                        <div className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-lg">
                          <Icon className="size-5" aria-hidden="true" />
                        </div>
                        <h3 className="text-foreground text-sm font-semibold">
                          {fmt.name}
                        </h3>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {fmt.detail}
                        </p>
                      </CardContent>
                    </Card>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          </div>
        </section>

        {/* 6 Study & Exam Modes */}
        <section
          id="modes"
          className="border-border bg-card border-y py-14 sm:py-20"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
                {vi
                  ? "6 chế độ học và thi thử cho mọi môn học"
                  : "6 focused study and exam modes for every subject"}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
                {vi
                  ? "Tối ưu thao tác bàn phím trên máy tính và sử dụng một tay thoải mái trên điện thoại. Nội dung học phần của bạn luôn giữ nguyên bản, không tự động sửa hay dịch."
                  : "Keyboard-first on desktop and ergonomic one-hand controls on mobile. Your authored study content is always preserved faithfully without alteration."}
              </p>
            </div>

            <StaggerList className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {studyModes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <StaggerItem key={mode.title}>
                    <div className="border-border bg-background flex h-full flex-col gap-2.5 rounded-xl border p-5">
                      <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                      <h3 className="text-foreground text-base font-semibold">
                        {mode.title}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {mode.desc}
                      </p>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          </div>
        </section>

        {/* Organization, Privacy & Friend Sharing */}
        <section id="sharing" className="py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-3">
            <Card>
              <CardContent className="space-y-2.5 pt-1">
                <FolderTree className="text-primary size-6" aria-hidden="true" />
                <h3 className="text-foreground text-base font-semibold">
                  {vi ? "Thư mục & Phân chương rõ ràng" : "Folders & Chapters"}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {vi
                    ? "Sắp xếp hàng trăm học phần theo môn học, chương, thẻ và độ khó. Tìm kiếm và lọc tức thì."
                    : "Organize sets by subject folder, chapter, tag, and difficulty with instant search and filtering."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2.5 pt-1">
                <Users className="text-primary size-6" aria-hidden="true" />
                <h3 className="text-foreground text-base font-semibold">
                  {vi ? "Chia sẻ linh hoạt với bạn bè" : "Role-Based Friend Sharing"}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {vi
                    ? "Phân quyền Chỉ xem hoặc Chỉnh sửa, tạo liên kết chia sẻ có thể thu hồi và cho phép nhân bản."
                    : "Grant Viewer or Editor roles to friends, issue revocable share links, and toggle one-click cloning."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2.5 pt-1">
                <Lock className="text-primary size-6" aria-hidden="true" />
                <h3 className="text-foreground text-base font-semibold">
                  {vi
                    ? "Riêng tư mặc định & Toàn quyền dữ liệu"
                    : "Private by Default & Portable"}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {vi
                    ? "Mọi học phần mới đều ở chế độ riêng tư — chỉ bạn mới thấy cho đến khi chia sẻ. Xuất JSON, CSV, XLSX bất cứ lúc nào."
                    : "Every new study set starts private — visible only to you until shared. Export JSON, CSV, or XLSX anytime."}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-border bg-card border-t py-12">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 text-center sm:px-6">
            <BookOpen className="text-primary size-8" aria-hidden="true" />
            <h2 className="text-foreground text-2xl font-bold tracking-tight">
              {vi
                ? "Sẵn sàng xây dựng thư viện ôn thi của riêng bạn?"
                : "Ready to organize your personal study workspace?"}
            </h2>
            <p className="text-muted-foreground max-w-xl text-sm">
              {vi
                ? "Đăng ký tài khoản để lưu trữ học phần, đồng bộ tiến độ ôn tập và chia sẻ với nhóm bạn học."
                : "Create an account to save your study sets, sync spaced-repetition progress, and share with friends."}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Button size="lg" asChild>
                <Link href="/register">
                  <span>{t("nav.signUp")}</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/exams/new">{t("nav.customExam")}</Link>
              </Button>
              <Button size="lg" variant="ghost" asChild>
                <Link href="/login">{t("nav.signIn")}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border bg-background border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-xs sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <span className="text-muted-foreground">
              {vi
                ? "Nền tảng tự học & luyện thi cá nhân"
                : "Personal study & exam prep workspace"}
            </span>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4">
            <Link href="/login" className="hover:text-foreground transition-colors">
              {t("nav.signIn")}
            </Link>
            <Link href="/register" className="hover:text-foreground transition-colors">
              {t("nav.signUp")}
            </Link>
            <Link href="/exams/new" className="hover:text-foreground transition-colors">
              {t("nav.customExam")}
            </Link>
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              {t("nav.dashboard")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
