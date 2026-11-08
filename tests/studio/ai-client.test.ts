import { expect, test } from "bun:test";
import { ZodError } from "zod";
import { aiConfigSchema } from "../../apps/studio/src/node/ai-client.ts";

const config = {
  endpoint: "https://api.example.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
};

test("rejects empty, whitespace-only and scheme-less endpoints without throwing", () => {
  for (const endpoint of ["", "   ", "api.openai.com/v1"]) {
    // safeParse must report a validation failure instead of letting the URL constructor throw.
    const result = aiConfigSchema.safeParse({ ...config, endpoint });
    expect(result.success).toBe(false);
    if (result.success) continue;
    expect(
      result.error.issues.some((issue) => issue.message.includes("valid URL")),
    ).toBe(true);
  }

  // The IPC handler uses parse(), so the same inputs must surface as a readable ZodError.
  for (const endpoint of ["", "   ", "api.openai.com/v1"]) {
    expect(() => aiConfigSchema.parse({ ...config, endpoint })).toThrow(
      ZodError,
    );
  }
});

test("accepts a valid https endpoint and trims surrounding whitespace", () => {
  const result = aiConfigSchema.safeParse({
    ...config,
    endpoint: "  https://api.example.com/v1  ",
  });
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.endpoint).toBe("https://api.example.com/v1");
  expect(aiConfigSchema.safeParse(config).success).toBe(true);
});

test("keeps the existing transport rules for parsed URLs", () => {
  const rejected = [
    "http://remote.example/v1",
    "https://user:secret@api.example.com/v1",
    "https://api.example.com/v1?key=1",
    "https://api.example.com/v1#fragment",
  ];
  for (const endpoint of rejected) {
    const result = aiConfigSchema.safeParse({ ...config, endpoint });
    expect(result.success).toBe(false);
    if (result.success) continue;
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "Use HTTPS or loopback HTTP; no URL credentials, query or fragment.",
    );
  }

  for (const endpoint of [
    "https://api.example.com/v1",
    "http://localhost:1234/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:11434/v1",
  ]) {
    expect(aiConfigSchema.safeParse({ ...config, endpoint }).success).toBe(
      true,
    );
  }
});
