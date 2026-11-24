"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
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
      title: vi ? "Flashcards 3D" : "3D Flashcards",
      desc: vi
        ? "Lật thẻ mượt mà, phím tắt bàn phím, lọc thẻ chưa thuộc và đọc phát âm trình duyệt."
        : "Crisp card flips, keyboard shortcuts, unknown-card loop, and browser speech playback.",
    },
    {
      icon: Repeat,
      title: vi ? "Học thích ứng (SM-2)" : "Adaptive Learn (SM-2)",
      desc: vi
        ? "Thuật toán lặp lại ngắt quãng xác định: câu trả lời sai tự động quay lại đúng khoảng cách."
        : "Deterministic spaced repetition: missed questions re-enter the queue at exact intervals.",
    },
    {
      icon: CheckCircle2,
      title: vi ? "Luyện trắc nghiệm" : "MC Practice",
      desc: vi
        ? "Phản hồi đúng/sai tức thì kèm giải thích, lọc theo chương, thẻ, câu sai hoặc câu gắn sao."
        : "Instant answer feedback with explanations, chapter/tag filters, mistakes and starred drills.",
    },
    {
      icon: PenLine,
      title: vi ? "Gõ đáp án (Write)" : "Typed Recall (Write)",
      desc: vi
        ? "Chấm chính xác theo danh sách đáp án chấp nhận, tùy chọn phân biệt hoa thường và dấu."
        : "Deterministic text grading against accepted answers with strict or flexible normalization.",
    },
    {
      icon: Shuffle,
      title: vi ? "Ghép thẻ (Match)" : "Timed Match",
      desc: vi
        ? "Ghép cặp câu hỏi — định nghĩa nhanh không trùng nghĩa, hỗ trợ chuột, chạm và bàn phím."
        : "Disambiguated pair matching with timer, touch support, and complete keyboard navigation.",
    },
    {
      icon: Clock,
      title: vi ? "Thi thử bấm giờ" : "Timed Mock Exams",
      desc: vi
        ? "Đề thi đóng băng bất biến, đồng hồ đồng bộ server, tự lưu đáp án và chấm điểm chính xác."
        : "Immutable exam snapshots, server-synced countdown timer, autosave, and server-side grading.",
    },
  ];

  const importFormats = [
    {
      icon: FileText,
      name: "Word (.docx)",
      detail: vi
        ? "Nhận diện in đậm, tô màu, gạch chân, màu chữ, bảng Word và đa chương."
        : "Detects bold, highlight, underline, font color, Word tables, and multi-chapter keys.",
    },
    {
      icon: FileText,
      name: "EduQuiz & Word (.txt)",
      detail: vi
        ? "Hỗ trợ dấu sao *B., dòng Đáp án: A và bảng đáp án cuối tài liệu."
        : "Supports *B. markers, inline Answer: A lines, and end-of-document answer keys.",
    },
    {
      icon: FileSpreadsheet,
      name: "Wayground & Excel (.xlsx / .csv)",
      detail: vi
        ? "Ánh xạ cột trực quan, hỗ trợ UTF-8 BOM tiếng Việt và xuất lại mượt mà."
        : "Visual column mapper, Vietnamese UTF-8 BOM support, and lossless round-trip export.",
    },
    {
      icon: Upload,
      name: "Quizlet TSV & StudyHub JSON",
      detail: vi
        ? "Tùy chỉnh dấu phân cách thuật ngữ/định nghĩa và sao lưu nguyên vẹn 100%."
        : "Custom term/definition delimiters plus schema-validated lossless JSON backup.",
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col overflow-x-clip">
      {/* Header */}
      <header className="border-border bg-card/90 sticky top-0 z-30 border-b backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="StudyHub">
            <BrandLogo />
          </Link>

          <nav
            aria-label={vi ? "Điều hướng trang chủ" : "Landing navigation"}
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
              {vi ? "Chia sẻ & Bảo mật" : "Sharing & Privacy"}
            </a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageToggle />
            <ThemeToggle compact />
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/login">{t("nav.signIn")}</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">{t("nav.signUp")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {/* Hero Section */}
        <section className="border-border border-b py-14 sm:py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12">
            <FadeIn className="space-y-6 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  <span>
                    {vi ? "100% Thuật toán xác định" : "100% Deterministic Logic"}
                  </span>
                </Badge>
                <Badge variant="secondary">
                  {vi ? "Miễn phí cá nhân & nhóm bạn" : "Free for personal & study groups"}
                </Badge>
              </div>

              <h1 className="text-foreground text-3xl font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.15]">
                {vi
                  ? "Tự học, ôn flashcard và luyện thi trắc nghiệm chính xác tuyệt đối."
                  : "Study flashcards, drill question banks, and run timed mock exams with zero guesswork."}
              </h1>

              <p className="text-muted-foreground max-w-2xl text-base leading-relaxed sm:text-lg">
                {vi
                  ? "StudyHub kết hợp sự gọn gàng của Flashcard với quy trình nhập đề thi Word, Excel, TXT hàng nghìn câu hỏi và phòng thi thử chấm điểm chuẩn xác — không quảng cáo, không giới hạn lượt làm bài."
                  : "StudyHub pairs calm Quizlet-style mastery with high-scale DOCX, XLSX, CSV, and TXT question bank importing and immutable timed mock exams — no ads, no artificial limits."}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button size="lg" asChild className="h-11 px-6">
                  <Link href="/register">
                    <span>{vi ? "Tạo tài khoản miễn phí" : "Create free account"}</span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="h-11 px-6">
                  <Link href="/login">{t("nav.signIn")}</Link>
                </Button>
              </div>

              <dl className="border-border grid grid-cols-3 gap-4 border-t pt-6">
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
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Định dạng nhập/xuất" : "Import formats"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    DOCX · XLSX · TXT
                  </dd>
                </div>
              </dl>
            </FadeIn>

            {/* Structured Product Architecture Preview */}
            <FadeIn delay={0.08} className="lg:col-span-5">
              <Card className="border-border shadow-sm">
                <CardHeader className="border-border border-b pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GraduationCap className="text-primary size-5" aria-hidden="true" />
                      <span>
                        {vi ? "Quy trình ôn thi chuẩn xác" : "Deterministic Study Pipeline"}
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
                      title: vi ? "Nhập đề từ Word, Excel, TXT, Quizlet" : "Import DOCX, XLSX, TXT, Quizlet",
                      desc: vi
                        ? "Tự phát hiện đáp án in đậm, tô sáng, màu chữ, *B. và cảnh báo xung đột để bạn duyệt."
                        : "Detects bold, highlight, font color, and *B. markers with conflict review before saving.",
                    },
                    {
                      step: "02",
                      title: vi ? "Ôn tập thông minh với SM-2" : "Master via SM-2 Spaced Repetition",
                      desc: vi
                        ? "Flashcards, Learn, Practice, Write và Match đồng bộ tiến độ từng câu hỏi."
                        : "Flashcards, Learn, Practice, Write, and Match track mastery per question.",
                    },
                    {
                      step: "03",
                      title: vi ? "Thi thử nghiêm túc như thi thật" : "Server-Scored Mock Exams",
                      desc: vi
                        ? "Trộn câu hỏi & đáp án theo UUID, lưu tự động và phân tích độ chính xác theo chương."
                        : "Shuffled options graded by stable UUID, autosaved answers, and chapter breakdown.",
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
                  ? "Nhập ngân hàng câu hỏi đa định dạng, minh bạch từng đáp án"
                  : "Multi-format bulk import with transparent answer detection"}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
                {vi
                  ? "Trình phân tích 6 bước kiểm tra lỗi định dạng, câu thiếu đáp án và câu trùng lặp trực tiếp trên danh sách ảo hóa trước khi lưu vào thư viện."
                  : "A 6-step deterministic wizard catches missing answers, formatting conflicts, and duplicates inline on a virtualized preview before committing to your library."}
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
        <section id="modes" className="border-border bg-card border-y py-14 sm:py-20">
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
                  {vi ? "Riêng tư mặc định & Xuất dữ liệu" : "Private by Default & Exportable"}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {vi
                    ? "Mọi học phần mới đều ở chế độ riêng tư với bảo mật RLS. Xuất JSON, CSV, XLSX bất cứ lúc nào."
                    : "Every new study set starts private with PostgreSQL RLS. Export JSON, CSV, or XLSX anytime."}
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
                ? "Nền tảng tự học & luyện thi xác định"
                : "Deterministic personal study & exam prep"}
            </span>
          </div>
          <div className="text-muted-foreground flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground transition-colors">
              {t("nav.signIn")}
            </Link>
            <Link href="/register" className="hover:text-foreground transition-colors">
              {t("nav.signUp")}
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
