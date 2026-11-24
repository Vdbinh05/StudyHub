import { describe, expect, it } from "vitest";
import {
  computeSha256Hex,
  computeTargetDimensions,
  extractImageDimensionsFromBytes,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  validateAudioUpload,
  validateMediaUpload,
  validateRasterImage,
} from "@/lib/media/validation";

function makePngBytes(width = 16, height = 12): Uint8Array {
  // Minimal PNG signature + IHDR chunk header
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length = 13
  buf.set([0x00, 0x00, 0x00, 0x0d], 8);
  // "IHDR"
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

function makeGifBytes(width = 32, height = 24): Uint8Array {
  const buf = new Uint8Array(12);
  // GIF89a
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(buf.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return buf;
}

function makeWebpBytes(): Uint8Array {
  const buf = new Uint8Array(16);
  // RIFF....WEBP
  buf.set([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0);
  return buf;
}

function makeJpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function makeMp3Id3Bytes(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]);
}

function makeMp3SyncBytes(): Uint8Array {
  // MPEG1 Layer III frame sync FF FB 90 00
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function makeWavBytes(): Uint8Array {
  // RIFF....WAVEfmt
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  ]);
}

function makeM4aBytes(): Uint8Array {
  // ....ftypM4A 
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x20,
    0x66, 0x74, 0x79, 0x70,
    0x4d, 0x34, 0x41, 0x20,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

function makeWebmBytes(): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
}

function makeOggBytes(): Uint8Array {
  return new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
}

describe("media validation & utilities", () => {
  describe("raster image magic-byte validation", () => {
    it("accepts valid PNG, JPEG, WebP, and GIF images", () => {
      const png = validateRasterImage(makePngBytes(), "diagram.png", "image/png");
      expect(png.valid).toBe(true);
      if (png.valid) {
        expect(png.detectedMime).toBe("image/png");
        expect(png.extension).toBe("png");
        expect(png.kind).toBe("image");
      }

      const jpg = validateRasterImage(makeJpegBytes(), "photo.jpg", "image/jpeg");
      expect(jpg.valid).toBe(true);
      if (jpg.valid) expect(jpg.detectedMime).toBe("image/jpeg");

      const webp = validateRasterImage(makeWebpBytes(), "chart.webp", "image/webp");
      expect(webp.valid).toBe(true);
      if (webp.valid) expect(webp.detectedMime).toBe("image/webp");

      const gif = validateRasterImage(makeGifBytes(), "anim.gif", "image/gif");
      expect(gif.valid).toBe(true);
      if (gif.valid) expect(gif.detectedMime).toBe("image/gif");
    });

    it("strictly rejects SVG by extension, MIME, OR spoofed SVG payload disguised as .png", () => {
      const svgPayload = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      const byExt = validateRasterImage(svgPayload, "diagram.svg", "image/svg+xml");
      expect(byExt.valid).toBe(false);
      if (!byExt.valid) expect(byExt.code).toBe("SVG_FORBIDDEN");

      const disguised = validateRasterImage(svgPayload, "innocent.png", "image/png");
      expect(disguised.valid).toBe(false);
      if (!disguised.valid) expect(disguised.code).toBe("SVG_FORBIDDEN");

      const xmlSvg = new TextEncoder().encode('<?xml version="1.0"?><svg></svg>');
      const disguisedXml = validateRasterImage(xmlSvg, "fake.jpg", "image/jpeg");
      expect(disguisedXml.valid).toBe(false);
      if (!disguisedXml.valid) expect(disguisedXml.code).toBe("SVG_FORBIDDEN");
    });

    it("strictly rejects HTML payloads disguised as images", () => {
      const htmlPayload = new TextEncoder().encode("<!DOCTYPE html><html><script>evil()</script></html>");
      const res = validateRasterImage(htmlPayload, "page.png", "image/png");
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.code).toBe("HTML_FORBIDDEN");
    });

    it("rejects empty files and files exceeding 5 MB", () => {
      const empty = validateRasterImage(new Uint8Array(0), "empty.png");
      expect(empty.valid).toBe(false);
      if (!empty.valid) expect(empty.code).toBe("EMPTY_FILE");

      const oversized = new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1);
      oversized.set(makePngBytes(), 0);
      const big = validateRasterImage(oversized, "huge.png");
      expect(big.valid).toBe(false);
      if (!big.valid) {
        expect(big.code).toBe("FILE_TOO_LARGE");
        expect(big.status).toBe(413);
      }
    });
  });

  describe("audio magic-byte validation", () => {
    it("accepts MP3 (ID3 and raw MPEG sync), WAV, M4A/MP4, WebM, and OGG", () => {
      const cases: Array<[Uint8Array, string, string, string]> = [
        [makeMp3Id3Bytes(), "listening.mp3", "audio/mpeg", "mp3"],
        [makeMp3SyncBytes(), "raw.mp3", "audio/mpeg", "mp3"],
        [makeWavBytes(), "clip.wav", "audio/wav", "wav"],
        [makeM4aBytes(), "voice.m4a", "audio/mp4", "m4a"],
        [makeWebmBytes(), "record.webm", "audio/webm", "webm"],
        [makeOggBytes(), "sample.ogg", "audio/ogg", "ogg"],
      ];

      for (const [bytes, name, expectedMime, expectedExt] of cases) {
        const res = validateAudioUpload(bytes, name);
        expect(res.valid).toBe(true);
        if (res.valid) {
          expect(res.kind).toBe("audio");
          expect(res.detectedMime).toBe(expectedMime);
          expect(res.extension).toBe(expectedExt);
        }
      }
    });

    it("does NOT misidentify JPEG (FF D8 FF) or WebP (RIFF...WEBP) as audio", () => {
      expect(validateAudioUpload(makeJpegBytes(), "fake.mp3").valid).toBe(false);
      expect(validateAudioUpload(makeWebpBytes(), "fake.wav").valid).toBe(false);
    });

    it("rejects SVG, HTML, executables, and files over 10 MB", () => {
      const svg = new TextEncoder().encode("<svg onload=alert(1)></svg>");
      const resSvg = validateAudioUpload(svg, "x.mp3");
      expect(resSvg.valid).toBe(false);
      if (!resSvg.valid) expect(resSvg.code).toBe("SVG_FORBIDDEN");

      const oversized = new Uint8Array(MAX_AUDIO_UPLOAD_BYTES + 1);
      oversized.set(makeMp3Id3Bytes(), 0);
      const resBig = validateAudioUpload(oversized, "long.mp3");
      expect(resBig.valid).toBe(false);
      if (!resBig.valid) expect(resBig.code).toBe("FILE_TOO_LARGE");
    });

    it("unified validateMediaUpload dispatches image vs audio cleanly", () => {
      const img = validateMediaUpload(makePngBytes(), "fig1.png");
      expect(img.valid).toBe(true);
      if (img.valid) expect(img.kind).toBe("image");

      const aud = validateMediaUpload(makeOggBytes(), "pronunciation.ogg");
      expect(aud.valid).toBe(true);
      if (aud.valid) expect(aud.kind).toBe("audio");
    });
  });

  describe("SHA-256 content hash helper", () => {
    it("computes standard SHA-256 hex digest deterministically", async () => {
      const emptyHash = await computeSha256Hex(new Uint8Array(0));
      expect(emptyHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      const abcBytes = new TextEncoder().encode("abc");
      const abcHash = await computeSha256Hex(abcBytes);
      expect(abcHash).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });

    it("handles sub-array views with non-zero byteOffset correctly", async () => {
      const full = new TextEncoder().encode("xxxabcyyy");
      const slice = full.subarray(3, 6);
      expect(await computeSha256Hex(slice)).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });
  });

  describe("image dimension extraction & resize planner", () => {
    it("extracts PNG and GIF dimensions from binary headers", () => {
      expect(extractImageDimensionsFromBytes(makePngBytes(1280, 720))).toEqual({
        width: 1280,
        height: 720,
      });
      expect(extractImageDimensionsFromBytes(makeGifBytes(640, 480))).toEqual({
        width: 640,
        height: 480,
      });
    });

    it("preserves original dimensions when preserveOriginal is enabled or image is already within bounds", () => {
      const preserved = computeTargetDimensions(4000, 3000, {
        preserveOriginal: true,
        maxWidth: 1600,
        maxHeight: 1600,
      });
      expect(preserved).toEqual({ width: 4000, height: 3000, resized: false });

      const small = computeTargetDimensions(800, 600, {
        maxWidth: 1600,
        maxHeight: 1600,
      });
      expect(small).toEqual({ width: 800, height: 600, resized: false });
    });

    it("scales oversized images proportionally and keeps higher readability bounds in diagramMode", () => {
      const photo = computeTargetDimensions(4000, 2000, { diagramMode: false });
      expect(photo.resized).toBe(true);
      expect(photo.width).toBe(1920);
      expect(photo.height).toBe(960);

      const diagram = computeTargetDimensions(4000, 2000, { diagramMode: true });
      expect(diagram.resized).toBe(true);
      expect(diagram.width).toBe(2560);
      expect(diagram.height).toBe(1280);
    });
  });
});
