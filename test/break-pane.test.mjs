import assert from "node:assert/strict";
import test from "node:test";

import { breakPane, breakToWorkspace } from "../break-pane.mjs";

const paneId = "w1:p2";

function layoutResponse({ paneCount, zoomed, workspaceId = "w1" } = {}) {
  return {
    result: {
      type: "pane_layout",
      layout: {
        zoomed,
        workspace_id: workspaceId || undefined,
        panes: Array.from({ length: paneCount }, (_, index) => ({
          pane_id: `w1:p${index + 1}`,
        })),
      },
    },
  };
}

function moveResponse({ changed = true, movedPaneId = paneId } = {}) {
  return {
    result: {
      type: "pane_move",
      move_result: {
        changed,
        pane: { pane_id: movedPaneId },
      },
    },
  };
}

function tabListResponse(tabs) {
  return {
    result: {
      type: "tab_list",
      tabs,
    },
  };
}

test("leaves a single-pane tab untouched", () => {
  const calls = [];
  const result = breakPane({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return layoutResponse({ paneCount: 1, zoomed: true });
    },
  });

  assert.deepEqual(result, {
    changed: false,
    reason: "single_pane",
    pane_id: paneId,
  });
  assert.deepEqual(calls, [["pane", "layout", "--pane", paneId]]);
});

test("moves an unzoomed pane directly into a new tab", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 2, zoomed: false }),
    moveResponse({ movedPaneId: "w1:p2" }),
  ];

  const result = breakPane({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["pane", "move", paneId, "--new-tab", "--focus"],
  ]);
});

test("unzooms a multi-pane tab before moving the pane", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 2, zoomed: true }),
    { result: { type: "pane_zoom" } },
    moveResponse(),
  ];

  breakPane({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["pane", "zoom", paneId, "--off"],
    ["pane", "move", paneId, "--new-tab", "--focus"],
  ]);
});

test("falls back to the focused pane in plugin context JSON", () => {
  const calls = [];

  breakPane({
    env: {
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: paneId }),
    },
    runHerdr(args) {
      calls.push(args);
      return layoutResponse({ paneCount: 1, zoomed: false });
    },
  });

  assert.deepEqual(calls[0], ["pane", "layout", "--pane", paneId]);
});

test("rejects invocation without a focused pane", () => {
  assert.throws(
    () => breakPane({ env: {}, runHerdr() {} }),
    /no focused Herdr pane/,
  );
});

test("rejects malformed layout responses", () => {
  assert.throws(
    () =>
      breakPane({
        env: { HERDR_PANE_ID: paneId },
        runHerdr() {
          return { result: {} };
        },
      }),
    /pane\.layout returned an unexpected response/,
  );
});

test("leaves a lone pane in a single-tab workspace untouched", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 1, zoomed: false }),
    tabListResponse([{ tab_id: "w1:t1", workspace_id: "w1" }]),
  ];

  const result = breakToWorkspace({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.deepEqual(result, {
    changed: false,
    reason: "single_pane",
    pane_id: paneId,
  });
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["tab", "list", "--workspace", "w1"],
  ]);
});

test("moves a lone pane into a new workspace if the workspace has multiple tabs", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 1, zoomed: false }),
    tabListResponse([
      { tab_id: "w1:t1", workspace_id: "w1" },
      { tab_id: "w1:t2", workspace_id: "w1" },
    ]),
    moveResponse(),
  ];

  const result = breakToWorkspace({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["tab", "list", "--workspace", "w1"],
    ["pane", "move", paneId, "--new-workspace", "--focus"],
  ]);
});

test("moves a pane from a multi-pane tab into a new workspace", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 2, zoomed: false }),
    moveResponse(),
  ];

  const result = breakToWorkspace({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["pane", "move", paneId, "--new-workspace", "--focus"],
  ]);
});

test("unzooms before breaking into a new workspace", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 2, zoomed: true }),
    { result: { type: "pane_zoom" } },
    moveResponse(),
  ];

  const result = breakPane({
    env: { HERDR_PANE_ID: paneId },
    toWorkspace: true,
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["pane", "zoom", paneId, "--off"],
    ["pane", "move", paneId, "--new-workspace", "--focus"],
  ]);
});

test("rejects malformed tab list responses when breaking a lone pane", () => {
  assert.throws(
    () =>
      breakToWorkspace({
        env: { HERDR_PANE_ID: paneId },
        runHerdr(args) {
          if (args[0] === "pane" && args[1] === "layout") {
            return layoutResponse({ paneCount: 1, zoomed: false });
          }
          return { result: {} };
        },
      }),
    /tab\.list returned an unexpected response/,
  );
});

test("resolves workspace id from plugin context JSON when breaking to workspace", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 1, zoomed: false, workspaceId: null }),
    tabListResponse([{ tab_id: "wctx:t1", workspace_id: "wctx" }]),
  ];

  const result = breakToWorkspace({
    env: {
      HERDR_PANE_ID: paneId,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_id: "wctx" }),
    },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, false);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["tab", "list", "--workspace", "wctx"],
  ]);
});

test("falls back to tab list without workspace option when workspace id is unknown", () => {
  const calls = [];
  const responses = [
    layoutResponse({ paneCount: 1, zoomed: false, workspaceId: null }),
    tabListResponse([{ tab_id: "t1" }]),
  ];

  const result = breakToWorkspace({
    env: { HERDR_PANE_ID: paneId },
    runHerdr(args) {
      calls.push(args);
      return responses.shift();
    },
  });

  assert.equal(result.changed, false);
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", paneId],
    ["tab", "list"],
  ]);
});
