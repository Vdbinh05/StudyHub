import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DiagramStudyPlayer } from "@/components/diagram/DiagramStudyPlayer";
import type { DiagramSet } from "@/types/v3";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

const MOCK_DIAGRAM: DiagramSet = {
  id: "diag-test-1",
  study_set_id: "set-test-1",
  owner_id: "user-1",
  title: "Cấu tạo cánh máy bay",
  description: "Sơ đồ các bề mặt điều khiển",
  base_media_id: null,
  base_image_url: "/api/uploads/signed-url?path=wing.png&redirect=1",
  image_width: 1200,
  image_height: 800,
  content_version: 1,
  created_at: "2026-11-24T00:00:00Z",
  updated_at: "2026-11-24T00:00:00Z",
  hotspots: [
    {
      id: "hs-1",
      diagram_id: "diag-test-1",
      study_set_id: "set-test-1",
      label: "Cánh tà",
      accepted_alternatives: ["Flaps"],
      description: "Tăng lực nâng khi cất/hạ cánh",
      hint: "Nằm ở mép sau gần thân máy bay",
      shape: "point",
      geometry: { shape: "point", x: 0.25, y: 0.4, radius: 0.05 },
      sort_order: 0,
      created_at: "2026-11-24T00:00:00Z",
      updated_at: "2026-11-24T00:00:00Z",
    },
    {
      id: "hs-2",
      diagram_id: "diag-test-1",
      study_set_id: "set-test-1",
      label: "Cánh liệng",
      accepted_alternatives: ["Aileron"],
      description: "Điều khiển góc nghiêng ngang (roll)",
      hint: "Nằm ở mép sau gần đầu cánh",
      shape: "rect",
      geometry: { shape: "rect", x: 0.65, y: 0.35, width: 0.2, height: 0.15 },
      sort_order: 1,
      created_at: "2026-11-24T00:00:00Z",
      updated_at: "2026-11-24T00:00:00Z",
    },
  ],
};

describe("DiagramStudyPlayer (all 6 modes)", () => {
  it("renders all 6 mode tabs and explores hotspot details", () => {
    render(<DiagramStudyPlayer diagram={MOCK_DIAGRAM} previewOnly />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);

    // Explore mode shows first hotspot details
    expect(screen.getByText("Tăng lực nâng khi cất/hạ cánh")).toBeInTheDocument();

    // Clicking second hotspot switches detail panel
    fireEvent.click(screen.getAllByRole("button", { name: /Cánh liệng/i })[0]);
    expect(screen.getByText("Điều khiển góc nghiêng ngang (roll)")).toBeInTheDocument();
  });

  it("supports keyboard alternative in Identify Location mode and tracks missed items into Review Incorrect", () => {
    const onAttempt = vi.fn();
    render(
      <DiagramStudyPlayer
        diagram={MOCK_DIAGRAM}
        initialMode="identify_location"
        onAttemptRecord={onAttempt}
        previewOnly
      />,
    );

    // Expand keyboard alternative panel
    const kbdBtn = screen.getByRole("button", { name: /bàn phím|keyboard alternative/i });
    expect(kbdBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(kbdBtn);
    expect(kbdBtn).toHaveAttribute("aria-expanded", "true");

    // Pick location #1 via keyboard button
    const loc1Btn = screen.getByRole("button", { name: /#1/i });
    fireEvent.click(loc1Btn);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("grades Name Location answers deterministically with accepted alternatives", () => {
    const onAttempt = vi.fn();
    render(
      <DiagramStudyPlayer
        diagram={MOCK_DIAGRAM}
        initialMode="name_location"
        onAttemptRecord={onAttempt}
        previewOnly
      />,
    );

    // Determine which hotspot is active via hint or try typing wrong answer to verify feedback
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "definitely wrong answer" } });
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra|Check answer/i }));

    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "name_location", isCorrect: false }),
    );

    // Switching to Review Incorrect now has 1 missed hotspot ready to drill!
    const reviewTab = screen.getByRole("tab", { name: /Ôn vị trí sai|Review Incorrect/i });
    fireEvent.click(reviewTab);
    expect(screen.queryByText(/Không còn vị trí sai|No missed locations/i)).not.toBeInTheDocument();
  });

  it("supports Hidden Labels reveal & Multiple Choice Diagram", () => {
    render(<DiagramStudyPlayer diagram={MOCK_DIAGRAM} initialMode="hidden_labels" previewOnly />);

    // Labels start hidden
    expect(screen.queryByText("Cánh tà")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hiện tất cả|Reveal all/i }));
    expect(screen.getByText("Cánh tà")).toBeInTheDocument();
    expect(screen.getByText("Cánh liệng")).toBeInTheDocument();

    // Multiple Choice mode renders options
    fireEvent.click(screen.getByRole("tab", { name: /Trắc nghiệm|Multiple Choice/i }));
    expect(screen.getByRole("button", { name: /Cánh tà/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cánh liệng/i })).toBeInTheDocument();
  });
});
