import * as React from "react";
import { ExamResultsClient } from "@/components/exam/ExamResultsClient";

interface PageProps {
  params: Promise<{ id: string; attemptId: string }>;
}

export default async function ExamResultsPage({ params }: PageProps) {
  const { id, attemptId } = await params;
  return <ExamResultsClient setId={id} attemptId={attemptId} />;
}
