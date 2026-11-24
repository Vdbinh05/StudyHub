import * as React from "react";
import type { Metadata } from "next";
import { ReviewMistakesClient } from "@/components/learning/ReviewMistakesClient";

export const metadata: Metadata = {
  title: "Ôn tập & Câu hỏi sai — StudyHub",
  description:
    "Ôn tập các câu trả lời sai và lịch ôn tập lặp lại ngắt quãng SM-2 đến hạn.",
};

export default function ReviewPage() {
  return <ReviewMistakesClient />;
}
