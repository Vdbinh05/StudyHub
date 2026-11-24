import type { Locale } from "@/types/domain";
import type {
  AnswerDetectionSource,
  AnswerRuleMode,
  ImportFormat,
} from "@/types/import";

export function getImportStepLabels(locale: Locale): Array<{
  step: number;
  title: string;
  short: string;
}> {
  if (locale === "en") {
    return [
      { step: 1, title: "Upload or Paste", short: "Source" },
      { step: 2, title: "Format & Mapping", short: "Format" },
      { step: 3, title: "Answer Rules", short: "Rules" },
      { step: 4, title: "Preview & Verify", short: "Preview" },
      { step: 5, title: "Fix & Options", short: "Review" },
      { step: 6, title: "Confirm & Import", short: "Import" },
    ];
  }
  return [
    { step: 1, title: "Tải tệp hoặc dán văn bản", short: "Nguồn" },
    { step: 2, title: "Định dạng & Ánh xạ cột", short: "Định dạng" },
    { step: 3, title: "Quy tắc đáp án đúng", short: "Đáp án" },
    { step: 4, title: "Xem trước & Kiểm tra", short: "Xem trước" },
    { step: 5, title: "Chỉnh sửa & Tùy chọn", short: "Xử lý" },
    { step: 6, title: "Xác nhận & Nhập dữ liệu", short: "Nhập" },
  ];
}

export function getFormatLabel(format: ImportFormat, locale: Locale): string {
  const vi: Record<ImportFormat, string> = {
    eduquiz_txt: "EduQuiz TXT (*B. đánh dấu đáp án)",
    word_answer_key: "Word / TXT có Đáp án (Inline hoặc Bảng cuối tài liệu)",
    docx_ooxml: "Microsoft Word (.docx OOXML định dạng)",
    xlsx_wayground: "Excel Wayground / Quizizz (.xlsx)",
    xlsx_generic: "Excel tùy chỉnh cột (.xlsx)",
    quizlet_tsv: "Quizlet Flashcards (TSV / ký tự phân cách)",
    csv: "Bảng tính CSV (.csv)",
    json: "StudyHub JSON (.json)",
    txt_generic: "Văn bản trắc nghiệm tổng quát (.txt)",
  };
  const en: Record<ImportFormat, string> = {
    eduquiz_txt: "EduQuiz TXT (*B. asterisk marker)",
    word_answer_key: "Word / TXT Answer Key (Inline or End-of-Doc)",
    docx_ooxml: "Microsoft Word (.docx OOXML Formatting)",
    xlsx_wayground: "Wayground / Quizizz Excel (.xlsx)",
    xlsx_generic: "Generic Excel with Column Mapping (.xlsx)",
    quizlet_tsv: "Quizlet Flashcards (TSV / Custom Delimiter)",
    csv: "CSV Spreadsheet (.csv)",
    json: "StudyHub Canonical JSON (.json)",
    txt_generic: "Generic Numbered Questions (.txt)",
  };
  return locale === "en" ? en[format] : vi[format];
}

export function getAnswerRuleLabel(
  mode: AnswerRuleMode,
  locale: Locale,
): { title: string; description: string } {
  const vi: Record<AnswerRuleMode, { title: string; description: string }> = {
    auto: {
      title: "Tự động theo thứ tự ưu tiên",
      description:
        "Kiểm tra Đáp án dòng -> Bảng đáp án -> Dấu * -> Tô sáng -> Màu chữ -> In đậm -> Gạch chân. Tự cảnh báo nếu xung đột.",
    },
    asterisk_prefix: {
      title: "Dấu sao đầu dòng (*B.)",
      description: "Chỉ nhận diện lựa chọn bắt đầu bằng dấu *, [*] hoặc [x].",
    },
    inline_answer_key: {
      title: "Dòng đáp án ngay dưới câu hỏi",
      description: "Nhận diện ANSWER: A, Correct answer: B, Đáp án: C, Key: D.",
    },
    end_answer_key: {
      title: "Bảng đáp án cuối tài liệu",
      description:
        "Khớp theo số thứ tự từng chương (hỗ trợ reset Câu 1 ở mỗi chương mới).",
    },
    docx_bold: {
      title: "Chữ in đậm trong Word (Bold)",
      description:
        "Phát hiện lựa chọn được in đậm trong file .docx (tự trừ nền nếu cả 4 đáp án đều đậm).",
    },
    docx_highlight: {
      title: "Tô sáng / Nền màu trong Word (Highlight)",
      description: "Phát hiện lựa chọn được bôi vàng, tô sáng hoặc tô nền (shading).",
    },
    docx_font_color: {
      title: "Màu chữ khác biệt trong Word (Color)",
      description:
        "Phát hiện lựa chọn có màu chữ nổi bật (VD: đỏ, xanh dương, xanh lá) so với màu chuẩn.",
    },
    docx_underline: {
      title: "Gạch chân trong Word (Underline)",
      description: "Phát hiện lựa chọn được gạch chân trong file .docx.",
    },
  };

  const en: Record<AnswerRuleMode, { title: string; description: string }> = {
    auto: {
      title: "Auto (Deterministic Priority)",
      description:
        "Checks Inline Key -> End Key -> Asterisk * -> Highlight -> Font Color -> Bold -> Underline. Flags any conflicts.",
    },
    asterisk_prefix: {
      title: "Asterisk Prefix (*B.)",
      description: "Only detect options prefixed with *, [*], or [x].",
    },
    inline_answer_key: {
      title: "Inline Answer Line",
      description: "Detect ANSWER: A, Correct answer: B, Đáp án: C, Key: D.",
    },
    end_answer_key: {
      title: "End-of-Document Answer Key",
      description:
        "Maps by chapter + local question number (supports multi-chapter numbering resets).",
    },
    docx_bold: {
      title: "Word Bold Formatting",
      description:
        "Detect bolded options in .docx (auto-subtracts baseline if all options are bold).",
    },
    docx_highlight: {
      title: "Word Highlight / Shading",
      description: "Detect highlighted or background-shaded options in .docx.",
    },
    docx_font_color: {
      title: "Word Font Color",
      description:
        "Detect options styled in a distinct font color (e.g. red, blue, green).",
    },
    docx_underline: {
      title: "Word Underline Formatting",
      description: "Detect underlined options in .docx.",
    },
  };

  return locale === "en" ? en[mode] : vi[mode];
}

export function getDetectionSourceBadge(
  source: AnswerDetectionSource,
  locale: Locale,
): string {
  const vi: Record<AnswerDetectionSource, string> = {
    asterisk_prefix: "Dấu *",
    inline_answer_key: "Dòng đáp án",
    end_answer_key: "Bảng đáp án cuối",
    docx_bold: "Word In đậm",
    docx_highlight: "Word Tô sáng",
    docx_font_color: "Word Màu chữ",
    docx_underline: "Word Gạch chân",
    column_mapping: "Ánh xạ cột",
    json_explicit: "JSON chuẩn",
    manual: "Chỉnh tay",
    none: "Chưa có đáp án",
  };
  const en: Record<AnswerDetectionSource, string> = {
    asterisk_prefix: "Asterisk *",
    inline_answer_key: "Inline Key",
    end_answer_key: "End Answer Key",
    docx_bold: "DOCX Bold",
    docx_highlight: "DOCX Highlight",
    docx_font_color: "DOCX Font Color",
    docx_underline: "DOCX Underline",
    column_mapping: "Column Mapping",
    json_explicit: "JSON Explicit",
    manual: "Manual Edit",
    none: "No Answer",
  };
  return locale === "en" ? en[source] : vi[source];
}
