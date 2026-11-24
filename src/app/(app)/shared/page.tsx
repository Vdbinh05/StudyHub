import * as React from "react";
import type { Metadata } from "next";
import { SharedSetsView } from "@/components/social/shared-sets-view";

export const metadata: Metadata = {
  title: "Được chia sẻ với tôi",
};

export default function SharedPage() {
  return <SharedSetsView />;
}
