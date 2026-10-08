/**
 * Asks a vision model whether the figure is doing what the video is doing.
 *
 * Server-side because the key has to be. Everything else about this project
 * runs in the browser and stays there, but an API key in client code is a key
 * anyone can read out of the bundle — so the frames go to this route, the route
 * holds the credential, and the browser never sees it.
 *
 * **This is the one part of the pipeline that uploads video.** The landing page
 * promises that no frame of video leaves the device, and for live recognition
 * and every other pass that stays true. This route breaks it by design, for the
 * baking step only, and only when someone presses the button. That is a product
 * decision, not a technical one, and it should be said plainly in the UI
 * wherever this is offered.
 *
 * ## Two providers
 *
 * **DeepSeek** is the default, because it is roughly thirty times cheaper for
 * this job and this job is thousands of nearly-identical calls. Its vision
 * model caps every image at 384 tokens however large it arrives, which is what
 * makes a four-image request cost a fraction of a cent.
 *
 * **Claude** is kept for when a frame is genuinely hard and the judgement is
 * worth more than the fee.
 *
 * The difference that matters below is not the URL — DeepSeek speaks the OpenAI
 * wire format, so the request shape is standard — it is that DeepSeek's JSON
 * mode guarantees the reply *parses* and not that it matches the schema. Hence
 * the worked example in the prompt and `parseCritique` on the way back, neither
 * of which the Claude path needs.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  CRITIQUE_EXAMPLE,
  CRITIQUE_SCHEMA,
  ISSUES,
  PARTS,
  SEVERITIES,
  parseCritique,
} from "@/lib/motion/critic";

type Provider = "deepseek" | "claude";

const DEEPSEEK_MODEL = "deepseek-v4-flash-vision-exp";
/**
 * Overridable so the loop can be exercised against a stand-in.
 *
 * Worth having beyond testing: it is also how this points at a proxy, a
 * regional endpoint, or any other OpenAI-compatible vision model without
 * touching the code.
 */
const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const CLAUDE_MODEL = "claude-opus-5";

const SYSTEM = `You are checking a 3D figure against a frame of dance video.

You will be given, in order:
  1. one frame from the video of a real dancer
  2. renders of a 3D figure that is supposed to be reproducing that exact frame,
     seen from several angles

Judge only the POSE. Ignore appearance entirely: the figure has no clothing,
no face and no hair, and is a different build from the dancer. A featureless
figure in the correct pose is a match.

Work through the body in this order and stop at what is actually wrong:
torso lean and twist, then each arm's hand position, then each hand's fingers,
then the head. The dance is Bharatanatyam, so the hands carry most of the
meaning — a hand shape that is close but not the same gesture is a real error,
where a slightly different elbow height usually is not.

Reply with json only, in exactly this shape:

${CRITIQUE_EXAMPLE}

  - "part" must be one of: ${PARTS.join(", ")}
  - "issue" must be one of: ${ISSUES.join(", ")}
  - "severity" must be one of: ${SEVERITIES.join(", ")}
  - Return at most three fixes. If more than three things are wrong, report the
    three that matter most.
  - Say "matches": true when the pose is right, even if it is not perfect, and
    return an empty "fixes" array. Small differences are expected.
  - "confidence" is your confidence in the fixes, not in the match. Below 0.6
    the fixes are discarded, so use a low number when the angles do not let you
    tell.
  - Directions are the DANCER'S left and right, not the viewer's.
  - "notes" is read by a person. One sentence, plain language.`;

interface Body {
  /** Data URL or bare base64 of the video frame. */
  frame: string;
  /** One entry per camera angle, same encoding. */
  renders: string[];
  label?: string;
  /** Overrides the default provider; otherwise whichever key is configured. */
  provider?: Provider;
}

/** Normalises to a data URL, since that is what both wire formats want. */
function asDataUrl(input: string): string | null {
  if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(input)) return input;
  if (/^[A-Za-z0-9+/=]+$/.test(input)) return `data:image/png;base64,${input}`;
  return null;
}

/** Claude takes the media type and the payload apart; DeepSeek takes the URL whole. */
function split(dataUrl: string) {
  return {
    media: dataUrl.slice(5, dataUrl.indexOf(";")) as "image/png" | "image/jpeg",
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  // DeepSeek wins a tie: it is the cheap path, and this runs per frame.
  const provider: Provider =
    body.provider ?? (deepseekKey ? "deepseek" : claudeKey ? "claude" : "deepseek");

  const key = provider === "deepseek" ? deepseekKey : claudeKey;
  const envName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "ANTHROPIC_API_KEY";
  if (!key) {
    return NextResponse.json(
      { error: `${envName} is not set. Add it to frontend/.env.local and restart the dev server.` },
      { status: 501 },
    );
  }

  const frame = asDataUrl(body.frame ?? "");
  const renders = (body.renders ?? []).map(asDataUrl);
  if (!frame || renders.length === 0 || renders.some((r) => r === null)) {
    return NextResponse.json(
      { error: "Need one video frame and at least one render, base64 PNG or JPEG." },
      { status: 400 },
    );
  }

  try {
    if (provider === "deepseek") {
      const client = new OpenAI({ apiKey: key, baseURL: DEEPSEEK_URL });
      const completion = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        // Generous enough that a three-fix reply is never cut off mid-object,
        // which JSON mode turns into an unparseable answer rather than a short one.
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "The video frame:" },
              { type: "image_url", image_url: { url: frame } },
              { type: "text", text: `The 3D figure, ${renders.length} angle(s):` },
              ...renders.map((url) => ({
                type: "image_url" as const,
                image_url: { url: url as string },
              })),
            ],
          },
        ],
      });

      const text = completion.choices[0]?.message?.content;
      // A documented DeepSeek behaviour, not a fluke: JSON mode occasionally
      // returns nothing at all. Treated as a skipped frame, not a crash.
      if (!text) {
        return NextResponse.json({ error: "Empty reply from the model." }, { status: 502 });
      }

      const critique = parseCritique(JSON.parse(text));
      if (!critique) {
        return NextResponse.json({ error: "Reply was not a critique." }, { status: 502 });
      }

      return NextResponse.json({
        provider,
        label: body.label ?? null,
        critique,
        usage: {
          input: completion.usage?.prompt_tokens ?? 0,
          output: completion.usage?.completion_tokens ?? 0,
        },
      });
    }

    // --- Claude ------------------------------------------------------------
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: {
        // A bounded visual comparison rather than a problem to reason around,
        // and it runs hundreds of times per take.
        effort: "low",
        format: { type: "json_schema", schema: CRITIQUE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "The video frame:" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: split(frame).media,
                data: split(frame).data,
              },
            },
            { type: "text", text: `The 3D figure, ${renders.length} angle(s):` },
            ...renders.map((url) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: split(url as string).media,
                data: split(url as string).data,
              },
            })),
          ],
        },
      ],
    });

    // A safety decline is a 200 with no usable content — reading `content`
    // without checking yields an empty critique that looks like agreement.
    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The model declined this frame.", stop_details: response.stop_details },
        { status: 422 },
      );
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return NextResponse.json({ error: "No text in the reply." }, { status: 502 });
    }
    const critique = parseCritique(JSON.parse(text.text));
    if (!critique) {
      return NextResponse.json({ error: "Reply was not a critique." }, { status: 502 });
    }

    return NextResponse.json({
      provider,
      label: body.label ?? null,
      critique,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      const status = error.status === 401 ? 401 : error.status === 429 ? 429 : 502;
      return NextResponse.json(
        { error: `${provider} error ${error.status}: ${error.message}` },
        { status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
