"use client";

import * as React from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PdfExportMode, PdfOrientation } from "@/lib/export/pdf-exporter";
import type { Locale } from "@/types/domain";

export interface PdfExportDialogProps {
  studySetId?: string;
  attemptId?: string;
  questionIds?: string[];
  chapter?: string;
  defaultTitle: string;
  defaultSubject?: string;
  defaultMode?: PdfExportMode;
  locale?: Locale;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MODE_OPTIONS: Array<{
  value: PdfExportMode;
  vi: string;
  en: string;
  descVi: string;
  descEn: string;
}> = [
  {
    value: "paper_and_key",
    vi: "Đề thi + Bảng đáp án (trang riêng)",
    en: "Question Paper + Separate Answer Key",
    descVi: "In đề thi sạch cho học viên và bảng đáp án chuẩn ở trang cuối.",
    descEn: "Clean exam sheet followed by a matching answer key on a separate page.",
  },
  {
    value: "question_paper",
    vi: "Chỉ đề thi (không đáp án)",
    en: "Question Paper Only",
    descVi: "Chỉ gồm câu hỏi và ô trả lời, không lộ đáp án hay giải thích.",
    descEn: "Questions and write-in spaces only; zero answers or explanations.",
  },
  {
    value: "paper_with_explanations",
    vi: "Đề thi kèm đáp án & giải thích chi tiết",
    en: "Study Sheet (Answers & Explanations)",
    descVi: "Đánh dấu đáp án đúng ngay trong từng câu kèm giải thích ôn tập.",
    descEn: "Highlights correct answers inline with explanations for self-study.",
  },
  {
    value: "incorrect_review",
    vi: "Phiếu ôn tập câu làm sai",
    en: "Incorrect Questions Review Pack",
    descVi: "Tập trung vào các câu trả lời sai kèm đáp án đúng và giải thích.",
    descEn: "Focused review sheet of missed questions with answers & explanations.",
  },
  {
    value: "flashcard_sheets",
    vi: "Phiếu thẻ ghi nhớ (2 cột cắt được)",
    en: "Printable Flashcard Sheets (2-Column Grid)",
    descVi: "Bố cục 2 cột viền nét đứt Mặt trước / Mặt sau tiện in cắt.",
    descEn: "Cuttable 2-column A4 grid with Front & Back study cards.",
  },
];

export function PdfExportDialog({
  studySetId,
  attemptId,
  questionIds,
  chapter,
  defaultTitle,
  defaultSubject = "",
  defaultMode = "paper_and_key",
  locale = "vi",
  trigger,
  open: controlledOpen,
  onOpenChange,
}: PdfExportDialogProps): React.ReactElement {
  const isVi = locale === "vi";
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean): void => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const [mode, setMode] = React.useState<PdfExportMode>(defaultMode);
  const [orientation, setOrientation] = React.useState<PdfOrientation>("portrait");
  const [titleOverride, setTitleOverride] = React.useState<string | null>(null);
  const title = titleOverride ?? defaultTitle;
  const [subject, setSubject] = React.useState(defaultSubject);
  const [examCode, setExamCode] = React.useState("");
  const [headerText, setHeaderText] = React.useState("");
  const [footerText, setFooterText] = React.useState("");
  const [fontSize, setFontSize] = React.useState<number>(10.5);
  const [includeStudentInfo, setIncludeStudentInfo] = React.useState(true);
  const [shuffleQuestions, setShuffleQuestions] = React.useState(false);
  const [shuffleOptions, setShuffleOptions] = React.useState(false);
  const [grayscale, setGrayscale] = React.useState(true);
  const [includeAudioTranscript, setIncludeAudioTranscript] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);

  const handleDownload = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studySetId,
          attemptId,
          questionIds: questionIds && questionIds.length > 0 ? questionIds : undefined,
          chapter,
          mode,
          locale,
          orientation,
          title: title.trim() || defaultTitle,
          subject: subject.trim() || undefined,
          examCode: examCode.trim() || undefined,
          includeStudentInfo,
          headerText: headerText.trim() || undefined,
          footerText: footerText.trim() || undefined,
          shuffleQuestions: attemptId ? false : shuffleQuestions,
          shuffleOptions: attemptId ? false : shuffleOptions,
          fontSize,
          grayscale,
          includeAudioTranscript,
          includeImages: true,
        }),
      });

      if (!response.ok) {
        let errMessage = isVi ? "Không thể xuất tệp PDF." : "Failed to export PDF.";
        try {
          const json = (await response.json()) as { error?: { message?: string } };
          if (json.error?.message) errMessage = json.error.message;
        } catch {
          // Non-JSON error body
        }
        toast.error(errMessage);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = response.headers.get("content-disposition") ?? "";
      const utf8Match = /filename\*=UTF-8''([^;\s]+)/i.exec(disposition);
      const asciiMatch = /filename="([^"]+)"/.exec(disposition);
      let resolvedFileName = `studyhub-${mode}.pdf`;
      if (utf8Match?.[1]) {
        try {
          resolvedFileName = decodeURIComponent(utf8Match[1]);
        } catch {
          resolvedFileName = asciiMatch?.[1] ?? resolvedFileName;
        }
      } else if (asciiMatch?.[1]) {
        resolvedFileName = asciiMatch[1];
      }
      a.download = resolvedFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(
        isVi ? "Đã xuất tệp PDF tiếng Việt thành công." : "PDF exported successfully.",
      );
      setOpen(false);
    } catch {
      toast.error(
        isVi
          ? "Lỗi kết nối khi tạo tệp PDF."
          : "Network error while generating PDF.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-h-[38px] gap-1.5">
            <Printer className="size-4" aria-hidden="true" />
            {isVi ? "Xuất PDF" : "Export PDF"}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" aria-hidden="true" />
            {isVi ? "Xuất Đề thi & Đáp án PDF (A4)" : "Export Exam Paper & Answer Key (A4 PDF)"}
          </DialogTitle>
          <DialogDescription>
            {isVi
              ? "Tạo tệp PDF chuẩn font tiếng Việt (Noto Sans), giữ nguyên hình ảnh và tự động đồng bộ bảng đáp án sau khi trộn."
              : "Generates deterministic Vietnamese-safe PDF (Noto Sans) with embedded images and a synchronized post-shuffle answer key."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Export Mode */}
          <div className="space-y-1.5">
            <Label htmlFor="pdf-export-mode">
              {isVi ? "Chế độ xuất" : "Export Mode"}
            </Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PdfExportMode)}>
              <SelectTrigger id="pdf-export-mode" className="min-h-[42px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {isVi ? opt.vi : opt.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isVi
                ? MODE_OPTIONS.find((m) => m.value === mode)?.descVi
                : MODE_OPTIONS.find((m) => m.value === mode)?.descEn}
            </p>
          </div>

          {/* Title & Subject */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-title">{isVi ? "Tiêu đề đề thi" : "Document Title"}</Label>
              <Input
                id="pdf-export-title"
                value={title}
                onChange={(e) => setTitleOverride(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-subject">{isVi ? "Môn học / Chủ đề" : "Subject"}</Label>
              <Input
                id="pdf-export-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={isVi ? "VD: Khí tượng hàng không" : "e.g. Aviation Meteorology"}
                maxLength={120}
              />
            </div>
          </div>

          {/* Orientation, Font Size, Exam Code */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-orient">{isVi ? "Khổ giấy A4" : "Orientation"}</Label>
              <Select
                value={orientation}
                onValueChange={(v) => setOrientation(v as PdfOrientation)}
              >
                <SelectTrigger id="pdf-export-orient">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">{isVi ? "Dọc (Portrait)" : "Portrait"}</SelectItem>
                  <SelectItem value="landscape">{isVi ? "Ngang (Landscape)" : "Landscape"}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-font">{isVi ? "Cỡ chữ" : "Font Size"}</Label>
              <Select
                value={String(fontSize)}
                onValueChange={(v) => setFontSize(Number(v))}
              >
                <SelectTrigger id="pdf-export-font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9.5">9.5 pt ({isVi ? "Nhỏ" : "Compact"})</SelectItem>
                  <SelectItem value="10.5">10.5 pt ({isVi ? "Chuẩn" : "Standard"})</SelectItem>
                  <SelectItem value="12">12 pt ({isVi ? "Lớn" : "Large"})</SelectItem>
                  <SelectItem value="13.5">13.5 pt ({isVi ? "Rất lớn" : "Extra Large"})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-code">{isVi ? "Mã đề (tùy chọn)" : "Exam Code"}</Label>
              <Input
                id="pdf-export-code"
                value={examCode}
                onChange={(e) => setExamCode(e.target.value)}
                placeholder="101"
                maxLength={40}
              />
            </div>
          </div>

          {/* Custom Header / Footer */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-header">{isVi ? "Tiêu đề đầu trang" : "Header Text"}</Label>
              <Input
                id="pdf-export-header"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder={isVi ? "VD: Học kỳ 1 — 2026" : "e.g. Semester 1 — 2026"}
                maxLength={160}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdf-export-footer">{isVi ? "Chân trang" : "Footer Text"}</Label>
              <Input
                id="pdf-export-footer"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="StudyHub"
                maxLength={160}
              />
            </div>
          </div>

          {/* Switches */}
          <div className="space-y-2.5 rounded-lg border border-border bg-muted/25 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pdf-student-info" className="text-sm font-normal">
                {isVi
                  ? "Khung thông tin thí sinh (Họ tên, Ngày, Thời gian, Điểm)"
                  : "Include student info header (Name, Date, Duration, Score)"}
              </Label>
              <Switch
                id="pdf-student-info"
                checked={includeStudentInfo}
                onCheckedChange={setIncludeStudentInfo}
              />
            </div>

            {!attemptId && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pdf-shuffle-q" className="text-sm font-normal">
                    {isVi
                      ? "Trộn thứ tự câu hỏi (bảng đáp án tự khớp 100%)"
                      : "Shuffle question order (answer key auto-synced)"}
                  </Label>
                  <Switch
                    id="pdf-shuffle-q"
                    checked={shuffleQuestions}
                    onCheckedChange={setShuffleQuestions}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pdf-shuffle-o" className="text-sm font-normal">
                    {isVi
                      ? "Trộn thứ tự đáp án A/B/C/D (bảng đáp án tự khớp 100%)"
                      : "Shuffle option order A/B/C/D (answer key auto-synced)"}
                  </Label>
                  <Switch
                    id="pdf-shuffle-o"
                    checked={shuffleOptions}
                    onCheckedChange={setShuffleOptions}
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pdf-grayscale" className="text-sm font-normal">
                {isVi
                  ? "Chế độ in đen trắng tiết kiệm mực (Grayscale)"
                  : "Print-friendly grayscale palette"}
              </Label>
              <Switch
                id="pdf-grayscale"
                checked={grayscale}
                onCheckedChange={setGrayscale}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pdf-transcript" className="text-sm font-normal">
                {isVi
                  ? "Kèm bản chép lời cho câu hỏi Nghe hiểu (nếu có)"
                  : "Include audio transcript for Listening questions"}
              </Label>
              <Switch
                id="pdf-transcript"
                checked={includeAudioTranscript}
                onCheckedChange={setIncludeAudioTranscript}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isExporting}
            onClick={() => setOpen(false)}
          >
            {isVi ? "Hủy" : "Cancel"}
          </Button>
          <Button
            type="button"
            disabled={isExporting}
            onClick={() => void handleDownload()}
            className="min-h-[40px] gap-1.5"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {isExporting
              ? isVi
                ? "Đang tạo PDF…"
                : "Generating PDF…"
              : isVi
                ? "Tải tệp PDF"
                : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
