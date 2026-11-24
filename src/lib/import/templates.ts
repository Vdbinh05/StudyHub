import ExcelJS from "exceljs";
import Papa from "papaparse";

export type ImportTemplateFormat =
  | "eduquiz_txt"
  | "word_answer_key"
  | "quizlet_tsv"
  | "xlsx_wayground"
  | "csv"
  | "json";

export interface GeneratedTemplate {
  content: Uint8Array;
  fileName: string;
  contentType: string;
}

const EDUQUIZ_TEMPLATE_TEXT = `Chương 1: Kiến thức nền tảng

Câu 1: Thủ đô của Việt Nam là thành phố nào?
A. Thành phố Hồ Chí Minh
*B. Hà Nội
C. Đà Nẵng
D. Hải Phòng
Giải thích: Hà Nội là thủ đô của nước Cộng hòa xã hội chủ nghĩa Việt Nam.

Câu 2: Những ngôn ngữ nào sau đây hỗ trợ kiểu tĩnh (static typing)?
*A. TypeScript
B. Python (mặc định)
*C. Rust
D. JavaScript thuần
Giải thích: TypeScript và Rust đều kiểm tra kiểu dữ liệu ở thời điểm biên dịch.

Chương 2: Toán học cơ bản

Câu 1: Giá trị của √144 + 2³ bằng bao nhiêu?
A. 18
*B. 20
C. 22
D. 24
`;

const WORD_ANSWER_KEY_TEMPLATE_TEXT = `Chương 1: Lập trình Web

Câu 1: Giao thức truyền tải siêu văn bản bảo mật là gì?
A. HTTP
B. FTP
C. HTTPS
D. SMTP
Đáp án: C
Giải thích: HTTPS bổ sung lớp mã hóa TLS/SSL lên trên HTTP.

Câu 2: Thẻ HTML nào biểu diễn nội dung chính của trang web?
A. <header>
B. <main>
C. <footer>
D. <aside>

Chương 2: Cơ sở dữ liệu

Câu 1: Trong PostgreSQL, tính năng nào giúp cô lập dữ liệu theo từng hàng cho mỗi người dùng?
A. Row-Level Security (RLS)
B. Full-Text Search
C. Materialized View
D. Foreign Data Wrapper

ĐÁP ÁN
Chương 1
1. C
2. B

Chương 2
1. A
`;

const QUIZLET_TSV_TEMPLATE_TEXT = `Polymorphism (Tính đa hình)\tKhả năng cùng một giao diện có nhiều cách triển khai khác nhau trong lập trình hướng đối tượng.
Idempotency (Tính lũy đẳng)\tThực hiện một thao tác nhiều lần vẫn cho ra cùng một kết quả như thực hiện một lần.
Spaced Repetition (Lặp lại ngắt quãng)\tPhương pháp ôn tập tăng dần khoảng thời gian giữa các lần nhắc lại dựa trên độ ghi nhớ.
Row-Level Security (RLS)\tCơ chế kiểm soát quyền truy cập dữ liệu ở mức từng dòng trong PostgreSQL.
`;

const CSV_TEMPLATE_ROWS = [
  [
    "Chapter",
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Correct Answer",
    "Explanation",
    "Difficulty",
    "Tags",
  ],
  [
    "Chương 1: Mạng máy tính",
    "Cổng mặc định của giao thức HTTPS là bao nhiêu?",
    "80",
    "443",
    "22",
    "5432",
    "B",
    "HTTPS sử dụng cổng TCP 443 làm mặc định.",
    "easy",
    "network,http",
  ],
  [
    "Chương 1: Mạng máy tính",
    "Mã trạng thái HTTP nào biểu thị lỗi không có quyền truy cập (Forbidden)?",
    "400",
    "401",
    "403",
    "404",
    "3",
    "HTTP 403 Forbidden cho biết người dùng đã xác thực nhưng không có quyền.",
    "medium",
    "network,security",
  ],
];

const JSON_TEMPLATE_OBJ = {
  schema_version: "1.0",
  study_set: {
    title: "Mẫu bộ câu hỏi StudyHub",
    description: "Tệp mẫu chuẩn JSON hỗ trợ nhập và xuất không mất dữ liệu.",
    subject: "Khoa học máy tính",
    set_type: "mixed",
  },
  questions: [
    {
      questionType: "single_choice",
      chapter: "Chương 1: Cấu trúc dữ liệu",
      prompt: "Độ phức tạp thời gian trung bình của tìm kiếm nhị phân (Binary Search) là gì?",
      options: [
        { label: "A", content: "O(1)", isCorrect: false },
        { label: "B", content: "O(log n)", isCorrect: true },
        { label: "C", content: "O(n)", isCorrect: false },
        { label: "D", content: "O(n log n)", isCorrect: false },
      ],
      explanation: "Mỗi bước tìm kiếm nhị phân chia đôi không gian tìm kiếm.",
      hint: "Chia đôi mảng đã sắp xếp sau mỗi phép so sánh.",
      difficulty: "easy",
      tags: ["algorithms", "search"],
    },
    {
      questionType: "flashcard",
      chapter: "Chương 2: Thuật ngữ",
      prompt: "ACID trong cơ sở dữ liệu là viết tắt của gì?",
      backText: "Atomicity, Consistency, Isolation, Durability",
      explanation: "Bốn thuộc tính đảm bảo tính toàn vẹn giao dịch trong RDBMS.",
      difficulty: "medium",
      tags: ["database"],
    },
  ],
};

/**
 * Generate real downloadable template files for all supported StudyHub import formats.
 */
export async function generateImportTemplate(
  format: ImportTemplateFormat,
): Promise<GeneratedTemplate> {
  const encoder = new TextEncoder();

  switch (format) {
    case "eduquiz_txt":
      return {
        content: encoder.encode(EDUQUIZ_TEMPLATE_TEXT),
        fileName: "studyhub-template-eduquiz.txt",
        contentType: "text/plain; charset=utf-8",
      };

    case "word_answer_key":
      return {
        content: encoder.encode(WORD_ANSWER_KEY_TEMPLATE_TEXT),
        fileName: "studyhub-template-answer-key.txt",
        contentType: "text/plain; charset=utf-8",
      };

    case "quizlet_tsv":
      return {
        content: encoder.encode(QUIZLET_TSV_TEMPLATE_TEXT),
        fileName: "studyhub-template-quizlet.tsv",
        contentType: "text/tab-separated-values; charset=utf-8",
      };

    case "csv": {
      const csvText = "\uFEFF" + Papa.unparse(CSV_TEMPLATE_ROWS);
      return {
        content: encoder.encode(csvText),
        fileName: "studyhub-template-standard.csv",
        contentType: "text/csv; charset=utf-8",
      };
    }

    case "json": {
      const jsonText = JSON.stringify(JSON_TEMPLATE_OBJ, null, 2);
      return {
        content: encoder.encode(jsonText),
        fileName: "studyhub-template.json",
        contentType: "application/json; charset=utf-8",
      };
    }

    case "xlsx_wayground": {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "StudyHub";
      const sheet = workbook.addWorksheet("Questions");
      sheet.addRow([
        "Question Text",
        "Question Type",
        "Option 1",
        "Option 2",
        "Option 3",
        "Option 4",
        "Option 5",
        "Correct Answer",
        "Time in seconds",
        "Image Link",
        "Answer Explanation",
      ]);
      sheet.addRow([
        "Hành tinh nào gần Mặt Trời nhất trong Hệ Mặt Trời?",
        "Multiple Choice",
        "Sao Kim",
        "Sao Thủy",
        "Sao Hỏa",
        "Trái Đất",
        "",
        "2",
        30,
        "",
        "Sao Thủy (Mercury) là hành tinh gần Mặt Trời nhất.",
      ]);
      sheet.addRow([
        "Chọn tất cả các số nguyên tố trong danh sách sau:",
        "Checkbox",
        "2",
        "4",
        "7",
        "9",
        "11",
        "1,3,5",
        45,
        "",
        "Các số nguyên tố là 2, 7 và 11.",
      ]);

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      return {
        content: new Uint8Array(buffer as ArrayBuffer),
        fileName: "studyhub-template-wayground.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
  }
}

export const SUPPORTED_TEMPLATE_FORMATS: readonly ImportTemplateFormat[] = [
  "eduquiz_txt",
  "word_answer_key",
  "quizlet_tsv",
  "xlsx_wayground",
  "csv",
  "json",
] as const;

export function isSupportedTemplateFormat(
  value: string,
): value is ImportTemplateFormat {
  return (SUPPORTED_TEMPLATE_FORMATS as readonly string[]).includes(value);
}
