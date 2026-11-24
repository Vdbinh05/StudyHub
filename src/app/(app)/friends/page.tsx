import * as React from "react";
import type { Metadata } from "next";
import { FriendsView } from "@/components/social/friends-view";

export const metadata: Metadata = {
  title: "Bạn bè & Chia sẻ",
};

export default function FriendsPage() {
  return <FriendsView />;
}
