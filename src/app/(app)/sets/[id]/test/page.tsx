import * as React from "react";
import { TestHubClient } from "@/components/exam/TestHubClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TestPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <React.Suspense fallback={null}>
      <TestHubClient setId={id} />
    </React.Suspense>
  );
}
