import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ImageLightbox } from "@/components/media/ImageLightbox";
import { MediaGallery } from "@/components/media/MediaGallery";

describe("Media & Audio UI Components", () => {
  describe("AudioPlayer", () => {
    it("renders native <audio controls>, updates speed, counts plays, and toggles transcript", () => {
      const { container } = render(
        <AudioPlayer
          src="/api/uploads/signed-url?path=test.mp3&redirect=1"
          title="Listening Clip 1"
          transcript="The altimeter reads 3000 feet."
          maxReplays={3}
        />,
      );

      const audioEl = container.querySelector("audio");
      expect(audioEl).not.toBeNull();
      expect(audioEl?.hasAttribute("controls")).toBe(true);

      // Speed selector
      const speedSelect = screen.getByRole("combobox");
      fireEvent.change(speedSelect, { target: { value: "1.5" } });
      expect((audioEl as HTMLAudioElement).playbackRate).toBe(1.5);

      // Replay counter updates on play
      fireEvent.play(audioEl!);
      expect(screen.getByText(/1\/3/)).toBeInTheDocument();

      // Transcript toggle (collapsed by default -> expands on click)
      expect(screen.queryByText("The altimeter reads 3000 feet.")).not.toBeInTheDocument();
      const toggleBtn = screen.getByRole("button", { name: /lời thoại|transcript/i });
      expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("The altimeter reads 3000 feet.")).toBeInTheDocument();
    });

    it("refuses unsafe javascript: audio URLs", () => {
      const { container } = render(<AudioPlayer src="javascript:alert(1)" />);
      expect(container.querySelector("audio")).toBeNull();
    });
  });

  describe("ImageLightbox & MediaGallery", () => {
    it("opens accessible lightbox from MediaGallery and supports keyboard +/-/0 zoom", () => {
      render(
        <MediaGallery
          items={[
            {
              id: "img-1",
              kind: "image",
              url: "/api/uploads/signed-url?path=fig1.png&redirect=1",
              alt_text: "Airfoil lift diagram",
              caption: "Figure 1.1",
            },
          ]}
        />,
      );

      const trigger = screen.getByRole("button", { name: /Airfoil lift diagram/i });
      fireEvent.click(trigger);

      expect(screen.getByText("100%")).toBeInTheDocument();

      // Keyboard zoom in (+)
      fireEvent.keyDown(window, { key: "+" });
      expect(screen.getByText("150%")).toBeInTheDocument();

      // Keyboard reset (0)
      fireEvent.keyDown(window, { key: "0" });
      expect(screen.getByText("100%")).toBeInTheDocument();

      // Visible close button exists
      expect(screen.getByRole("button", { name: /Đóng|Close/i })).toBeInTheDocument();
    });

    it("rejects unsafe javascript: image URLs in ImageLightbox", () => {
      const { container } = render(
        <ImageLightbox open onOpenChange={() => {}} src="javascript:alert(1)" alt="evil" />,
      );
      expect(container.querySelector("img")).toBeNull();
    });
  });
});
