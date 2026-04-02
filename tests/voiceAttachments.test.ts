import { describe, expect, it } from "vitest";
import { listAudioAttachments } from "../src/voice/messageText.js";

/**
 * ## What this suite tests
 * Detection of Slack `message.files` entries that should be treated as voice/audio for STT.
 * Input: a synthetic message object shaped like Bolt’s payload.
 * Output: filtered list of file-like objects (used before download + Whisper).
 */

describe("listAudioAttachments (voice / file_share path)", () => {
  /*
   * Input: message with no `files` array.
   * Expected: empty list.
   */
  it("returns empty when there are no files", () => {
    expect(listAudioAttachments({ text: "hi" })).toEqual([]);
  });

  /*
   * Input: files with audio/mpeg mimetype.
   * Expected: that file is included.
   */
  it("includes files with audio/* mimetype", () => {
    const files = listAudioAttachments({
      files: [{ mimetype: "audio/mpeg", id: "F1", url_private: "https://example.com/a" }],
    });
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("F1");
  });

  /*
   * Input: video/webm (some clients use this for short voice notes).
   * Expected: included.
   */
  it("includes video/webm as potential voice container", () => {
    const files = listAudioAttachments({
      files: [{ mimetype: "video/webm", url_private: "https://x" }],
    });
    expect(files).toHaveLength(1);
  });

  /*
   * Input: image/png.
   * Expected: excluded.
   */
  it("excludes non-audio mimetypes", () => {
    const files = listAudioAttachments({
      files: [{ mimetype: "image/png" }],
    });
    expect(files).toHaveLength(0);
  });

  /*
   * Input: filetype mp3 with empty mimetype.
   * Expected: included via filetype heuristic.
   */
  it("includes known audio file extensions via filetype", () => {
    const files = listAudioAttachments({
      files: [{ filetype: "m4a", id: "F2", url_private: "https://x" }],
    });
    expect(files).toHaveLength(1);
  });
});
