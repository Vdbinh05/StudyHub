import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportStudySet } from "@/lib/export";
import {
  generateImportTemplate,
  parseImportInput,
  SUPPORTED_TEMPLATE_FORMATS,
} from "@/lib/import";
import type { Question, StudySet } from "@/types/domain";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

describe("Quizlet TSV, CSV (UTF-8 BOM), JSON round-trip, Export Engine & Templates", () => {
  it("parses Quizlet TSV default tab/newline AND custom delimiters (| and double newline)", async () => {
    const tsv = fs.readFileSync(
      path.join(FIXTURES_DIR, "quizlet_export.tsv"),
      "utf-8",
    );
    const res1 = await parseImportInput({
      rawText: tsv,
      fileName: "quizlet_export.tsv",
    });

    expect(res1.format).toBe("quizlet_tsv");
    expect(res1.questions).toHaveLength(4);
    expect(res1.summary.validCount).toBe(4);
    expect(res1.questions[0].questionType).toBe("flashcard");
    expect(res1.questions[0].prompt).toBe("Encapsulation");
    expect(res1.questions[0].backText).toContain("Đóng gói dữ liệu");
    expect(res1.questions[0].acceptedAnswers?.[0].answerText).toContain("Đóng gói dữ liệu");

    // Custom delimiter: "|" and "\n\n"
    const customText = `H₂O | Nước (phân tử gồm 2 nguyên tử Hidro và 1 nguyên tử Oxy)\n\nCO₂ | Khí cacbonic`;
    const res2 = await parseImportInput({
      rawText: customText,
      options: {
        formatOverride: "quizlet_tsv",
        termDelimiter: "|",
        cardDelimiter: "\\n\\n",
      },
    });
    expect(res2.questions).toHaveLength(2);
    expect(res2.questions[0].prompt).toBe("H₂O");
    expect(res2.questions[1].backText).toBe("Khí cacbonic");
  });

  it("parses CSV with UTF-8 BOM, quoted commas, multiline cells, and Vietnamese diacritics", async () => {
    const rawCsv = fs.readFileSync(
      path.join(FIXTURES_DIR, "questions_utf8_bom.csv"),
      "utf-8",
    );
    const bytes = new TextEncoder().encode("\uFEFF" + rawCsv);

    const res = await parseImportInput({
      fileBytes: bytes,
      fileName: "questions_utf8_bom.csv",
    });

    expect(res.format).toBe("csv");
    expect(res.questions).toHaveLength(2);
    expect(res.summary.errorCount).toBe(0);

    // Multiline option A & quoted quotes preserved with zero column shift
    expect(res.questions[0].prompt).toContain('"Học, học nữa, học mãi"');
    expect(res.questions[0].options[0].content).toBe(
      "Ngăn cách các bộ phận\ncùng chức vụ",
    );
    expect(res.questions[0].options[0].isCorrect).toBe(true);
    expect(res.questions[0].tags).toEqual(["vietnamese", "grammar"]);

    // Numeric answer 2 -> Option B
    expect(res.questions[1].options[1].isCorrect).toBe(true);
    expect(res.questions[1].options[1].content).toBe("x = 2, x = 3");
  });

  it("performs lossless JSON export -> re-import round-trip and exports CSV, TXT, XLSX cleanly", async () => {
    const studySet: Pick<StudySet, "id" | "title" | "description" | "subject" | "set_type"> = {
      id: "set-1",
      title: "Bộ đề Mạng & Cơ sở dữ liệu",
      description: "Ôn tập học kỳ 1",
      subject: "CNTT",
      set_type: "mixed",
    };

    const now = new Date().toISOString();
    const questions: Question[] = [
      {
        id: "q-1",
        study_set_id: "set-1",
        question_type: "multiple_choice",
        position: 0,
        chapter: "Chương 1: Mạng",
        prompt: "Các giao thức thuộc tầng Giao vận (Transport Layer)?",
        prompt_image_url: "https://example.com/osi.png",
        back_text: null,
        back_image_url: null,
        explanation: "TCP và UDP nằm ở tầng 4 của mô hình OSI.",
        hint: "Tầng 4 OSI",
        difficulty: "hard",
        source_metadata: {},
        created_at: now,
        updated_at: now,
        options: [
          { id: "o-1", question_id: "q-1", study_set_id: "set-1", position: 0, label: "A", content: "TCP", image_url: null, is_correct: true, created_at: now },
          { id: "o-2", question_id: "q-1", study_set_id: "set-1", position: 1, label: "B", content: "HTTP", image_url: null, is_correct: false, created_at: now },
          { id: "o-3", question_id: "q-1", study_set_id: "set-1", position: 2, label: "C", content: "UDP", image_url: null, is_correct: true, created_at: now },
        ],
        tags: [
          { id: "t-1", owner_id: "u-1", name: "osi", slug: "osi", color: "#4f46e5", created_at: now },
          { id: "t-2", owner_id: "u-1", name: "tcp", slug: "tcp", color: "#4f46e5", created_at: now },
        ],
      },
      {
        id: "q-2",
        study_set_id: "set-1",
        question_type: "flashcard",
        position: 1,
        chapter: "Chương 2: Database",
        prompt: "Primary Key",
        prompt_image_url: null,
        back_text: "Khóa chính định danh duy nhất mỗi bản ghi trong bảng",
        back_image_url: null,
        explanation: "Không chấp nhận giá trị NULL.",
        hint: null,
        difficulty: "easy",
        source_metadata: {},
        created_at: now,
        updated_at: now,
        accepted_answers: [
          {
            id: "aa-1",
            question_id: "q-2",
            study_set_id: "set-1",
            answer_text: "Khóa chính định danh duy nhất mỗi bản ghi trong bảng",
            normalized_answer: "khoa chinh dinh danh duy nhat moi ban ghi trong bang",
            match_mode: "ignore_diacritics",
            created_at: now,
          },
        ],
        tags: [],
      },
    ];

    // 1. JSON lossless round-trip
    const jsonExport = await exportStudySet(studySet, questions, { format: "json" });
    const reimported = await parseImportInput({
      fileBytes: jsonExport.content,
      fileName: jsonExport.fileName,
    });
    expect(reimported.format).toBe("json");
    expect(reimported.questions).toHaveLength(2);
    expect(reimported.summary.errorCount).toBe(0);
    expect(reimported.questions[0].prompt).toBe(questions[0].prompt);
    expect(reimported.questions[0].chapter).toBe("Chương 1: Mạng");
    expect(reimported.questions[0].difficulty).toBe("hard");
    expect(reimported.questions[0].hint).toBe("Tầng 4 OSI");
    expect(reimported.questions[0].tags).toEqual(["osi", "tcp"]);
    expect(reimported.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);
    expect(reimported.questions[1].questionType).toBe("flashcard");
    expect(reimported.questions[1].backText).toBe(questions[1].back_text);
    expect(reimported.questions[1].acceptedAnswers?.[0].matchMode).toBe("ignore_diacritics");

    // 2. CSV export -> re-parse
    const csvExport = await exportStudySet(studySet, questions, { format: "csv" });
    const csvReparsed = await parseImportInput({
      fileBytes: csvExport.content,
      fileName: csvExport.fileName,
    });
    expect(csvReparsed.questions).toHaveLength(2);
    expect(csvReparsed.summary.errorCount).toBe(0);

    // 3. TXT export (EduQuiz style & Answer-Key style)
    const txtEduQuiz = await exportStudySet(studySet, [questions[0]], {
      format: "txt",
      txtStyle: "eduquiz",
    });
    const txtReparsed = await parseImportInput({
      fileBytes: txtEduQuiz.content,
      fileName: txtEduQuiz.fileName,
    });
    expect(txtReparsed.questions).toHaveLength(1);
    expect(txtReparsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);

    // 4. XLSX export (Wayground style) -> re-parse
    const xlsxExport = await exportStudySet(studySet, [questions[0]], {
      format: "xlsx",
      xlsxStyle: "wayground",
    });
    const xlsxReparsed = await parseImportInput({
      fileBytes: xlsxExport.content,
      fileName: xlsxExport.fileName,
    });
    expect(xlsxReparsed.format).toBe("xlsx_wayground");
    expect(xlsxReparsed.questions).toHaveLength(1);
    expect(xlsxReparsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);
  });

  it("generates all 6 downloadable templates and verifies every template parses with 0 errors", async () => {
    for (const format of SUPPORTED_TEMPLATE_FORMATS) {
      const tpl = await generateImportTemplate(format);
      expect(tpl.content.byteLength).toBeGreaterThan(0);

      const parsed = await parseImportInput({
        fileBytes: tpl.content,
        fileName: tpl.fileName,
      });
      expect(parsed.questions.length).toBeGreaterThan(0);
      expect(parsed.summary.errorCount).toBe(0);
    }
  });
});
