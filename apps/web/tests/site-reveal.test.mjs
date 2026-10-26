import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";

import Reveal from "../components/Site/Reveal.tsx";

// Regression: every marketing section under the hero video was sent as
// `opacity: 0` and only shown once JavaScript ran, so when scripts failed the
// page under the video was blank. The server-rendered HTML must be visible.
describe("Reveal", () => {
  test("server-rendered content is visible without JavaScript", () => {
    const html = renderToString(
      React.createElement(Reveal, { className: "section" }, React.createElement("p", null, "Features"))
    );
    expect(html).toContain("Features");
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    expect(html).not.toContain("translateY(20px)");
  });

  test("keeps the className and delay without hiding anything", () => {
    const html = renderToString(
      React.createElement(Reveal, { className: "s-bento", delay: 0.2 }, "x")
    );
    expect(html).toContain('class="s-bento"');
    expect(html).toMatch(/opacity:\s*1/);
  });
});
