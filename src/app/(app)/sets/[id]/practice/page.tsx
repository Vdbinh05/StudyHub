import * as React from "react";
import { PracticeClient } from "@/components/learning/PracticeClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PracticePage({ params }: PageProps) {
  const { id } = await params;
  return (
    <React.Suspense fallback={null}>
      <PracticeClient setId={id} />
    </React.Suspense>
  );
}
