import * as React from "react";
import type { Metadata } from "next";
import { QuestionEditorView } from "@/components/editor/question-editor-view";

export const metadata: Metadata = {
  title: "Chỉnh sửa câu hỏi",
};

export default async function EditStudySetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuestionEditorView setId={id} />;
}
