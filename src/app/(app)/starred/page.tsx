import * as React from "react";
import type { Metadata } from "next";
import { StarredQuestionsClient } from "@/components/learning/StarredQuestionsClient";

export const metadata: Metadata = {
  title: "Câu hỏi gắn sao — StudyHub",
  description:
    "Xem lại, lọc và tạo bài luyện tập hoặc thi thử từ danh sách câu hỏi bạn đã đánh dấu sao.",
};

export default function StarredPage() {
  return <StarredQuestionsClient />;
}
