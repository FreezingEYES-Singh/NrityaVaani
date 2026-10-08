import { test } from "node:test";
import assert from "node:assert/strict";
import { youTubeId } from "./youtube.ts";

test("youTubeId reads the usual link shapes", () => {
  const id = "dQw4w9WgXcQ";
  for (const s of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://music.youtube.com/watch?v=${id}`,
    `  https://youtu.be/${id}  `,
  ])
    assert.equal(youTubeId(s), id, s);
});

test("youTubeId rejects what isn't a YouTube video link", () => {
  for (const s of ["", "hello", "https://vimeo.com/123456", "https://www.youtube.com/", "https://www.youtube.com/watch?v=short", "https://evil.com/watch?v=dQw4w9WgXcQ"])
    assert.equal(youTubeId(s), null, s);
});
