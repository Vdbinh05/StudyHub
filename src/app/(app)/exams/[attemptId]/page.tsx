import type { Metadata } from "next";
import { LiveExamRunner } from "@/components/exam/LiveExamRunner";

export const metadata: Metadata = {
  title: "Phòng thi thử — StudyHub",
  description: "Phòng thi thử trực tuyến với đồng hồ máy chủ và tự động lưu liên tục.",
};

export default async function StandaloneExamRunnerPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <LiveExamRunner attemptId={attemptId} />;
}
