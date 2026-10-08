/** YouTube links. Pure TS, so it runs in the Node tests too. */

/** The video id from the usual link shapes (watch, youtu.be, shorts, embed, live), or null. */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  const ok = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  if (ok(s)) return s;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return ok(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    return ok(u.searchParams.get("v")) ?? ok(u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1]);
  }
  return null;
}
