import type { Locale, QuestionType } from "@/types/domain";
import type {
  AnswerDetectionSource,
  AnswerRuleMode,
  ImportFormat,
} from "@/types/import";

export function getQuestionTypeLabel(
  questionType: QuestionType,
  locale: Locale,
): string {
  const vi: Record<QuestionType, string> = {
    single_choice: "Một đáp án",
    multiple_choice: "Nhiều đáp án",
    true_false: "Đúng / Sai",
    flashcard: "Thẻ ghi nhớ",
    short_answer: "Tự luận ngắn",
    fill_in_blank: "Điền khuyết",
    numerical: "Đáp án số",
    image_choice: "Chọn theo hình ảnh",
    ordering: "Sắp xếp thứ tự",
    matching: "Ghép cặp",
    image_hotspot: "Điểm nóng trên hình",
    reading_passage: "Đọc hiểu theo đoạn",
    listening: "Nghe hiểu",
  };
  const en: Record<QuestionType, string> = {
    single_choice: "Single Choice",
    multiple_choice: "Multiple Choice",
    true_false: "True / False",
    flashcard: "Flashcard",
    short_answer: "Short Answer",
    fill_in_blank: "Fill in the Blank",
    numerical: "Numerical",
    image_choice: "Image Choice",
    ordering: "Ordering",
    matching: "Matching",
    image_hotspot: "Image Hotspot",
    reading_passage: "Reading Passage",
    listening: "Listening",
  };
  return locale === "en" ? en[questionType] : vi[questionType];
}

export function getImportStepLabels(locale: Locale): Array<{
  step: 1 | 2 | 3;
  title: string;
  short: string;
}> {
  if (locale === "en") {
    return [
      { step: 1, title: "Choose File or Paste", short: "Choose File" },
      { step: 2, title: "Preview & Confirm", short: "Preview" },
      { step: 3, title: "Done", short: "Done" },
    ];
  }
  return [
    { step: 1, title: "Chọn tệp / Dán nội dung", short: "Chọn tệp" },
    { step: 2, title: "Xem trước & Xác nhận", short: "Xem trước" },
    { step: 3, title: "Hoàn tất", short: "Hoàn tất" },
  ];
}

export function getFormatLabel(format: ImportFormat, locale: Locale): string {
  const vi: Record<ImportFormat, string> = {
    eduquiz_txt: "Văn bản EduQuiz (*B.)",
    word_answer_key: "Word / Văn bản có bảng đáp án",
    docx_ooxml: "Microsoft Word (.docx)",
    docx_multimedia: "Word có hình ảnh (.docx)",
    xlsx_wayground: "Excel mẫu Wayground / Quizizz (.xlsx)",
    xlsx_generic: "Bảng tính Excel (.xlsx)",
    quizlet_tsv: "Thẻ ghi nhớ Quizlet (Tab / ký tự tách)",
    csv: "Bảng tính CSV (.csv)",
    json: "StudyHub JSON (.json)",
    txt_generic: "Văn bản trắc nghiệm (.txt)",
    pdf_text: "Tài liệu PDF (.pdf)",
  };
  const en: Record<ImportFormat, string> = {
    eduquiz_txt: "EduQuiz Text (*B.)",
    word_answer_key: "Word / Text with Answer Key",
    docx_ooxml: "Microsoft Word (.docx)",
    docx_multimedia: "Word with Images (.docx)",
    xlsx_wayground: "Wayground / Quizizz Excel (.xlsx)",
    xlsx_generic: "Excel Spreadsheet (.xlsx)",
    quizlet_tsv: "Quizlet Flashcards (TSV / Delimiter)",
    csv: "CSV Spreadsheet (.csv)",
    json: "StudyHub JSON (.json)",
    txt_generic: "Numbered Questions Text (.txt)",
    pdf_text: "PDF Document (.pdf)",
  };
  return locale === "en" ? en[format] : vi[format];
}

export function getAnswerRuleLabel(
  mode: AnswerRuleMode,
  locale: Locale,
): { title: string; description: string } {
  const vi: Record<AnswerRuleMode, { title: string; description: string }> = {
    auto: {
      title: "Tự động nhận diện (Khuyên dùng)",
      description:
        "Tự động đọc dòng đáp án, bảng đáp án cuối, dấu *, tô sáng, màu chữ, in đậm hoặc gạch chân.",
    },
    asterisk_prefix: {
      title: "Dấu sao đầu dòng (*B.)",
      description: "Chỉ nhận diện lựa chọn bắt đầu bằng dấu *, [*] hoặc [x].",
    },
    inline_answer_key: {
      title: "Dòng đáp án ngay dưới câu hỏi",
      description: "Nhận diện Đáp án: A, ANSWER: B, Correct answer: C, Key: D.",
    },
    end_answer_key: {
      title: "Bảng đáp án cuối tài liệu",
      description:
        "Khớp theo số thứ tự từng chương (hỗ trợ đánh số lại từ Câu 1 ở mỗi chương mới).",
    },
    docx_bold: {
      title: "Chữ in đậm trong Word (Bold)",
      description:
        "Nhận diện lựa chọn in đậm trong tệp .docx (tự bỏ qua nếu cả 4 đáp án đều đậm).",
    },
    docx_highlight: {
      title: "Tô sáng / Nền màu trong Word",
      description: "Nhận diện lựa chọn được bôi vàng, tô sáng hoặc tô nền.",
    },
    docx_font_color: {
      title: "Màu chữ nổi bật trong Word",
      description:
        "Nhận diện lựa chọn có màu chữ khác biệt (VD: đỏ, xanh dương, xanh lá).",
    },
    docx_underline: {
      title: "Gạch chân trong Word",
      description: "Nhận diện lựa chọn được gạch chân trong tệp .docx.",
    },
  };

  const en: Record<AnswerRuleMode, { title: string; description: string }> = {
    auto: {
      title: "Auto-detect (Recommended)",
      description:
        "Reads inline keys, end-of-doc keys, * markers, highlight, font color, bold, or underline automatically.",
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
        "Maps by chapter and question number (supports multi-chapter numbering resets).",
    },
    docx_bold: {
      title: "Word Bold Formatting",
      description:
        "Detect bolded options in .docx (ignores baseline bold when all options are bold).",
    },
    docx_highlight: {
      title: "Word Highlight / Shading",
      description: "Detect highlighted or background-shaded options in .docx.",
    },
    docx_font_color: {
      title: "Word Font Color",
      description:
        "Detect options styled in a distinct font color (e.g., red, blue, green).",
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
    end_answer_key: "Bảng đáp án",
    docx_bold: "In đậm",
    docx_highlight: "Tô sáng",
    docx_font_color: "Màu chữ",
    docx_underline: "Gạch chân",
    column_mapping: "Cột bảng tính",
    json_explicit: "JSON",
    manual: "Chỉnh tay",
    none: "Chưa có đáp án",
  };
  const en: Record<AnswerDetectionSource, string> = {
    asterisk_prefix: "Asterisk *",
    inline_answer_key: "Inline Key",
    end_answer_key: "Answer Key",
    docx_bold: "Bold",
    docx_highlight: "Highlight",
    docx_font_color: "Font Color",
    docx_underline: "Underline",
    column_mapping: "Column",
    json_explicit: "JSON",
    manual: "Manual",
    none: "No Answer",
  };
  return locale === "en" ? en[source] : vi[source];
}
