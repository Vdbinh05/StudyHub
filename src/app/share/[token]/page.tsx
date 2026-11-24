import * as React from "react";
import { ShareRedeemView } from "@/components/social/share-redeem-view";

export default async function ShareTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareRedeemView token={token} />;
}
