import * as React from "react";
import type { Metadata } from "next";
import { ShareRedeemView } from "@/components/social/share-redeem-view";

export const metadata: Metadata = {
  title: "Liên kết chia sẻ học phần",
};

export default async function ShareTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareRedeemView token={token} />;
}
