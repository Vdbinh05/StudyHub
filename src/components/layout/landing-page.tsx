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
  GraduationCap,
  Headphones,
  Image as ImageIcon,
  Layers,
  Lock,
  PenLine,
  Printer,
  Repeat,
  ShieldCheck,
  Shuffle,
  Upload,
  Users,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import { BrandLogo } from "./brand-logo";
import { LandingLocaleShell } from "./landing-locale-shell";

interface LandingFeature {
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  title: string;
  desc: string;
}

function getStudyModes(vi: boolean): LandingFeature[] {
  return [
    {
      icon: Layers,
      title: vi ? "Thẻ ghi nhớ (Flashcards)" : "Flashcards",
      desc: vi
        ? "Lật thẻ mượt, phím tắt nhanh, lọc thẻ chưa thuộc và hỗ trợ công thức toán học."
        : "Crisp card flips, keyboard controls, unknown-card loops, and math notation.",
    },
    {
      icon: Repeat,
      title: vi ? "Học thích ứng (SM-2)" : "Adaptive Learn (SM-2)",
      desc: vi
        ? "Lặp lại ngắt quãng kết hợp mức độ tự tin giúp câu sai quay lại đúng thời điểm."
        : "Spaced repetition calibrated by confidence so weak items return on time.",
    },
    {
      icon: CheckCircle2,
      title: vi ? "Luyện trắc nghiệm" : "Practice Drill",
      desc: vi
        ? "Hiện đáp án và giải thích tức thì; lọc theo chương, thẻ, câu sai hoặc câu gắn sao."
        : "Instant answer feedback with explanations; filter by chapter, mistakes, or stars.",
    },
    {
      icon: Clock,
      title: vi ? "Thi thử nhiều môn" : "Multi-Subject Mock Exams",
      desc: vi
        ? "Ghép nhiều học phần, phủ 100% câu hỏi, bấm giờ, tự lưu và phân tích điểm theo chương."
        : "Combine sets, run full-coverage cycles, timed autosave, and topic breakdowns.",
    },
    {
      icon: PenLine,
      title: vi ? "Gõ đáp án (Write)" : "Typed Recall (Write)",
      desc: vi
        ? "Tự nhập câu trả lời chủ động, tùy chọn so khớp hoa thường và dấu tiếng Việt."
        : "Active recall grading with configurable case and diacritic tolerance.",
    },
    {
      icon: Headphones,
      title: vi ? "Nghe & Gõ (Spell)" : "Listen & Type (Spell)",
      desc: vi
        ? "Luyện nghe phát âm hoặc tệp âm thanh đính kèm và gõ lại chính xác từng ký tự."
        : "Practice listening from attached audio clips or speech playback and type answers.",
    },
    {
      icon: Shuffle,
      title: vi ? "Ghép cặp (Match)" : "Timed Match",
      desc: vi
        ? "Ghép cặp câu hỏi — đáp án bấm giờ rõ ràng, mượt trên cả cảm ứng lẫn bàn phím."
        : "Disambiguated timed pair matching built for touch and keyboard navigation.",
    },
    {
      icon: ImageIcon,
      title: vi ? "Sơ đồ tương tác" : "Interactive Diagrams",
      desc: vi
        ? "Gắn nhãn hình ảnh giải phẫu, bản đồ, mạch điện và ôn điểm nóng trực quan."
        : "Pin interactive labels on anatomy, maps, and diagrams for visual recall.",
    },
  ];
}

function getImportFormats(vi: boolean): LandingFeature[] {
  return [
    {
      icon: FileText,
      title: "Word (.docx) & PDF",
      desc: vi
        ? "Nhận diện đáp án in đậm, tô sáng, màu chữ, bảng Word, hình ảnh nhúng và lớp chữ PDF."
        : "Detects bold, highlight, color, Word tables, embedded images, and text-layer PDFs.",
    },
    {
      icon: FileSpreadsheet,
      title: "Excel & CSV (.xlsx)",
      desc: vi
        ? "Ánh xạ cột trực quan, giữ trọn 12 dạng câu hỏi, hỗ trợ UTF-8 tiếng Việt đầy đủ."
        : "Visual column mapping across 12 question types with full UTF-8 preservation.",
    },
    {
      icon: Upload,
      title: "EduQuiz · Quizlet · TXT",
      desc: vi
        ? "Hỗ trợ dấu sao *B., dòng Đáp án:, bảng đáp án cuối trang, TSV và sao lưu JSON."
        : "Supports *B. markers, inline answers, end keys, Quizlet TSV, and JSON backups.",
    },
    {
      icon: Printer,
      title: vi ? "Xuất PDF in ấn" : "Printable PDF Export",
      desc: vi
        ? "Tạo đề thi giấy, phiếu đáp án, lời giải hoặc tờ thẻ ghi nhớ chuẩn phông tiếng Việt."
        : "Generate printable exam papers, answer keys, and flashcards with full diacritics.",
    },
  ];
}

function LandingNav({ locale }: { locale: Locale }) {
  const vi = locale === "vi";
  return (
    <nav
      aria-label={vi ? "Điều hướng trang chủ" : "Landing"}
      className="hidden items-center gap-6 md:flex"
    >
      <a
        href="#modes"
        className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
      >
        {vi ? "8 Chế độ học" : "8 Study Modes"}
      </a>
      <a
        href="#import"
        className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
      >
        {vi ? "Nhập & Xuất đề" : "Import & Export"}
      </a>
      <a
        href="#highlights"
        className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
      >
        {vi ? "Ngoại tuyến & Riêng tư" : "Offline & Privacy"}
      </a>
    </nav>
  );
}

function LandingHeaderActions({ locale }: { locale: Locale }) {
  const vi = locale === "vi";
  return (
    <>
      <Link
        href="/login"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "hidden min-h-11 px-2.5 sm:inline-flex sm:min-h-9 sm:px-3",
        )}
      >
        {vi ? "Đăng nhập" : "Sign in"}
      </Link>
      <Link
        href="/register"
        className={cn(
          buttonVariants({ size: "sm" }),
          "min-h-11 px-3 sm:min-h-9 sm:px-4",
        )}
      >
        {vi ? "Đăng ký" : "Sign up"}
      </Link>
    </>
  );
}

function LandingBody({ locale }: { locale: Locale }) {
  const vi = locale === "vi";
  const studyModes = getStudyModes(vi);
  const importFormats = getImportFormats(vi);

  const workflowSteps = [
    {
      step: "01",
      title: vi
        ? "Nhập đề từ DOCX, PDF, XLSX, TXT"
        : "Import DOCX, PDF, XLSX, TXT",
      desc: vi
        ? "Tự phát hiện đáp án in đậm, tô sáng, màu chữ, *B. và ảnh đính kèm để kiểm tra ngay trước khi lưu."
        : "Detects bold, highlight, font color, *B. markers, and media with inline verification.",
    },
    {
      step: "02",
      title: vi
        ? "Học sâu với 8 chế độ & 12 dạng câu hỏi"
        : "Master 8 Modes & 12 Question Types",
      desc: vi
        ? "Flashcards, Learn SM-2, Practice, Write, Spell, Match và Sơ đồ tương tác đồng bộ từng câu."
        : "Flashcards, SM-2 Learn, Practice, Write, Spell, Match, and Diagrams sync every item.",
    },
    {
      step: "03",
      title: vi
        ? "Thi thử bấm giờ, xuất PDF & học ngoại tuyến"
        : "Mock Exams, PDF Print & Offline PWA",
      desc: vi
        ? "Đảo đáp án không bao giờ lệch khóa chấm, tải về học khi mất mạng và in đề giấy bất cứ lúc nào."
        : "UUID-locked grading, offline study packs without internet, and printable exam PDFs.",
    },
  ];

  return (
    <>
      <main id="main-content" className="flex-1">
        {/* Hero Section */}
        <section className="border-border border-b py-8 sm:py-14 lg:py-16">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:gap-10">
            <div className="space-y-5 lg:col-span-7">
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
                    ? "Miễn phí · Không giới hạn"
                    : "Free · Zero Limits"}
                </Badge>
              </div>

              <h1 className="text-foreground text-2xl leading-tight font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl lg:leading-[1.14]">
                {vi
                  ? "Tự học, ôn thẻ ghi nhớ và luyện thi trắc nghiệm chính xác tuyệt đối."
                  : "Study flashcards, drill question banks, and run timed mock exams with zero guesswork."}
              </h1>

              <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed sm:text-base lg:text-lg">
                {vi
                  ? "Nhập hàng nghìn câu hỏi từ Word, PDF, Excel, TXT; ôn luyện với 8 chế độ học, 12 dạng câu hỏi, sơ đồ tương tác, xuất PDF tiếng Việt và học ngoại tuyến ngay trên điện thoại."
                  : "Import thousands of questions from Word, PDF, Excel, and TXT; master them with 8 study modes, 12 question types, interactive diagrams, printable PDFs, and offline study."}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Link
                  href="/register"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "min-h-11 px-5 sm:px-6",
                  )}
                >
                  <span>
                    {vi ? "Bắt đầu học miễn phí" : "Start studying free"}
                  </span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "min-h-11 px-4 sm:px-5",
                  )}
                >
                  {vi ? "Đăng nhập" : "Sign in"}
                </Link>
                <Link
                  href="/exams/new"
                  prefetch={false}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "lg" }),
                    "min-h-11 px-3.5",
                  )}
                >
                  <FileCheck2 className="size-4" aria-hidden="true" />
                  <span>{vi ? "Thi thử tùy chỉnh" : "Custom Exam"}</span>
                </Link>
              </div>

              <dl className="border-border grid grid-cols-3 gap-3 border-t pt-4 sm:gap-6 sm:pt-5">
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Chế độ học" : "Study modes"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    8
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Dạng câu hỏi" : "Question types"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    12
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {vi ? "Nhập & xuất" : "Formats"}
                  </dt>
                  <dd className="text-foreground mt-0.5 font-mono text-xs font-bold sm:text-base">
                    DOCX · PDF · XLSX
                  </dd>
                </div>
              </dl>
            </div>

            {/* Structured Product Workflow Preview */}
            <div className="lg:col-span-5">
              <Card className="border-border shadow-sm">
                <CardHeader className="border-border border-b pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GraduationCap
                        className="text-primary size-5"
                        aria-hidden="true"
                      />
                      <span>
                        {vi ? "Quy trình ôn thi 3 bước" : "3-Step Study Workflow"}
                      </span>
                    </CardTitle>
                    <Badge variant="success">
                      {vi ? "Trọn bộ" : "All-in-one"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-1">
                  {workflowSteps.map((item) => (
                    <div
                      key={item.step}
                      className="bg-secondary/60 flex items-start gap-3 rounded-lg p-3"
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
            </div>
          </div>
        </section>

        {/* 8 Study & Exam Modes */}
        <section
          id="modes"
          className="cv-auto border-border bg-card border-b py-10 sm:py-14"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl space-y-1.5">
              <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                {vi
                  ? "8 chế độ học và thi thử cho mọi môn học"
                  : "8 focused study and exam modes for every subject"}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {vi
                  ? "Gọn nhẹ trên điện thoại, hỗ trợ phím tắt trên máy tính. Nội dung học phần của bạn luôn giữ nguyên bản, không tự động chỉnh sửa hay dịch."
                  : "Ergonomic on mobile, keyboard-first on desktop. Your authored study material is always preserved faithfully."}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {studyModes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <div
                    key={mode.title}
                    className="border-border bg-background flex flex-col gap-2 rounded-xl border p-4"
                  >
                    <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                      <Icon className="size-4.5" aria-hidden="true" />
                    </div>
                    <h3 className="text-foreground text-sm font-semibold">
                      {mode.title}
                    </h3>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {mode.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Multi-Format Import & Printable PDF Export */}
        <section id="import" className="cv-auto py-10 sm:py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl space-y-1.5">
              <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                {vi
                  ? "Nhập ngân hàng đề đa định dạng & xuất PDF in ấn"
                  : "Multi-format bulk import & printable PDF export"}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {vi
                  ? "Kiểm tra câu thiếu đáp án, định dạng và trùng lặp trực quan trước khi lưu, đồng thời hỗ trợ 12 dạng câu hỏi kèm công thức toán học và âm thanh."
                  : "Verify missing answers, formatting, and duplicates inline before saving across 12 question types with math and audio."}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {importFormats.map((fmt) => {
                const Icon = fmt.icon;
                return (
                  <Card key={fmt.title} className="h-full py-4">
                    <CardContent className="space-y-2">
                      <div className="bg-accent text-accent-foreground flex size-9 items-center justify-center rounded-lg">
                        <Icon className="size-4.5" aria-hidden="true" />
                      </div>
                      <h3 className="text-foreground text-sm font-semibold">
                        {fmt.title}
                      </h3>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {fmt.desc}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Offline PWA, Friend Sharing & Privacy */}
        <section
          id="highlights"
          className="cv-auto border-border bg-card border-y py-10 sm:py-14"
        >
          <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-3">
            <div className="border-border bg-background space-y-2 rounded-xl border p-4">
              <WifiOff className="text-primary size-5" aria-hidden="true" />
              <h3 className="text-foreground text-sm font-semibold">
                {vi ? "Học ngoại tuyến (PWA)" : "Offline Study (PWA)"}
              </h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {vi
                  ? "Tải học phần về máy để ôn thẻ và làm trắc nghiệm ngay cả khi mất mạng; tiến độ tự đồng bộ khi có kết nối lại."
                  : "Download study sets for offline flashcards and drills; progress syncs automatically when back online."}
              </p>
            </div>

            <div className="border-border bg-background space-y-2 rounded-xl border p-4">
              <Users className="text-primary size-5" aria-hidden="true" />
              <h3 className="text-foreground text-sm font-semibold">
                {vi ? "Chia sẻ linh hoạt với bạn bè" : "Role-Based Friend Sharing"}
              </h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {vi
                  ? "Phân quyền Chỉ xem hoặc Chỉnh sửa, tạo liên kết chia sẻ có thể thu hồi và cho phép nhân bản học phần."
                  : "Grant Viewer or Editor roles to friends, issue revocable share links, and toggle cloning."}
              </p>
            </div>

            <div className="border-border bg-background space-y-2 rounded-xl border p-4">
              <Lock className="text-primary size-5" aria-hidden="true" />
              <h3 className="text-foreground text-sm font-semibold">
                {vi
                  ? "Riêng tư mặc định & Toàn quyền dữ liệu"
                  : "Private by Default & Portable"}
              </h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {vi
                  ? "Học phần mới luôn ở chế độ riêng tư. Không quảng cáo, không khóa tính năng — sao lưu JSON/XLSX/PDF bất cứ lúc nào."
                  : "Every new set starts private. Zero ads or paywalls — export JSON, XLSX, or PDF anytime."}
              </p>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="cv-auto py-9 sm:py-12">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 text-center sm:px-6">
            <BookOpen className="text-primary size-7" aria-hidden="true" />
            <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              {vi
                ? "Sẵn sàng xây dựng thư viện ôn thi của riêng bạn?"
                : "Ready to organize your personal study workspace?"}
            </h2>
            <p className="text-muted-foreground max-w-lg text-sm">
              {vi
                ? "Tạo tài khoản miễn phí để lưu bộ câu hỏi, đồng bộ tiến độ ôn tập và học mọi lúc mọi nơi."
                : "Create a free account to save study sets, sync spaced-repetition progress, and study anywhere."}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "lg" }), "min-h-11")}
              >
                <span>{vi ? "Đăng ký" : "Sign up"}</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "min-h-11",
                )}
              >
                {vi ? "Đăng nhập" : "Sign in"}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border bg-card border-t py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <span className="text-muted-foreground">
              {vi
                ? "Nền tảng tự học & luyện thi cá nhân"
                : "Personal study & exam prep workspace"}
            </span>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="hover:text-foreground transition-colors"
            >
              {vi ? "Đăng nhập" : "Sign in"}
            </Link>
            <Link
              href="/register"
              className="hover:text-foreground transition-colors"
            >
              {vi ? "Đăng ký" : "Sign up"}
            </Link>
            <Link
              href="/exams/new"
              prefetch={false}
              className="hover:text-foreground transition-colors"
            >
              {vi ? "Thi thử tùy chỉnh" : "Custom Exam"}
            </Link>
            <Link
              href="/dashboard"
              prefetch={false}
              className="hover:text-foreground transition-colors"
            >
              {vi ? "Trang chủ" : "Home"}
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}

export function LandingPage() {
  return (
    <LandingLocaleShell
      brandLogo={<BrandLogo />}
      viNav={<LandingNav locale="vi" />}
      enNav={<LandingNav locale="en" />}
      viHeaderActions={<LandingHeaderActions locale="vi" />}
      enHeaderActions={<LandingHeaderActions locale="en" />}
      viContent={<LandingBody locale="vi" />}
      enContent={<LandingBody locale="en" />}
    />
  );
}
