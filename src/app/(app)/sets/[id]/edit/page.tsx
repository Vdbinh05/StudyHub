import * as React from "react";
import { QuestionEditorView } from "@/components/editor/question-editor-view";

export default async function EditStudySetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuestionEditorView setId={id} />;
}
