import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function paneIdFromEnvironment(env) {
  if (env.HERDR_PANE_ID) return env.HERDR_PANE_ID;

  if (env.HERDR_PLUGIN_CONTEXT_JSON) {
    try {
      return JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON).focused_pane_id;
    } catch {
      throw new Error("HERDR_PLUGIN_CONTEXT_JSON is not valid JSON");
    }
  }

  return undefined;
}

export function workspaceIdFromEnvironment(env) {
  if (env.HERDR_WORKSPACE_ID) return env.HERDR_WORKSPACE_ID;

  if (env.HERDR_PLUGIN_CONTEXT_JSON) {
    try {
      return JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON).workspace_id;
    } catch {
      throw new Error("HERDR_PLUGIN_CONTEXT_JSON is not valid JSON");
    }
  }

  return undefined;
}

export function createHerdrRunner(binary) {
  return (args) => {
    const result = spawnSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    if (result.error) {
      throw new Error(`failed to run Herdr: ${result.error.message}`);
    }

    const output = result.stdout.trim();
    if (result.status !== 0) {
      const detail = result.stderr.trim() || output || `exit status ${result.status}`;
      throw new Error(`Herdr command failed: ${detail}`);
    }

    try {
      return JSON.parse(output);
    } catch {
      throw new Error(`Herdr returned invalid JSON: ${output || "<empty output>"}`);
    }
  };
}

function isLoneWorkspacePane(run, env, layout) {
  const workspaceId = layout.workspace_id || workspaceIdFromEnvironment(env);
  const tabArgs = workspaceId
    ? ["tab", "list", "--workspace", workspaceId]
    : ["tab", "list"];
  const tabResponse = run(tabArgs);
  const tabs = tabResponse?.result?.tabs;

  if (tabResponse?.result?.type !== "tab_list" || !Array.isArray(tabs)) {
    throw new Error("tab.list returned an unexpected response");
  }

  const matchingTabs = workspaceId
    ? tabs.filter((tab) => !tab.workspace_id || tab.workspace_id === workspaceId)
    : tabs;

  return matchingTabs.length <= 1;
}

export function breakPane({
  env = process.env,
  runHerdr,
  toWorkspace = false,
  to = "tab",
} = {}) {
  const targetWorkspace = toWorkspace || to === "workspace";
  const paneId = paneIdFromEnvironment(env);
  if (!paneId) {
    throw new Error("no focused Herdr pane is available in the plugin context");
  }

  const run = runHerdr ?? createHerdrRunner(env.HERDR_BIN_PATH || "herdr");
  const layoutResponse = run(["pane", "layout", "--pane", paneId]);
  const layout = layoutResponse?.result?.layout;

  if (!layout || !Array.isArray(layout.panes) || typeof layout.zoomed !== "boolean") {
    throw new Error("pane.layout returned an unexpected response");
  }

  const isUntouched = targetWorkspace
    ? layout.panes.length <= 1 && isLoneWorkspacePane(run, env, layout)
    : layout.panes.length <= 1;

  if (isUntouched) {
    return { changed: false, reason: "single_pane", pane_id: paneId };
  }

  if (layout.zoomed) {
    run(["pane", "zoom", paneId, "--off"]);
  }

  const moveFlag = targetWorkspace ? "--new-workspace" : "--new-tab";
  const moveResponse = run(["pane", "move", paneId, moveFlag, "--focus"]);
  const moveResult = moveResponse?.result?.move_result;
  if (!moveResult || typeof moveResult.changed !== "boolean") {
    throw new Error("pane.move returned an unexpected response");
  }

  return {
    changed: moveResult.changed,
    reason: moveResult.reason,
    pane_id: moveResult.pane?.pane_id ?? paneId,
  };
}

export function breakToWorkspace(options) {
  return breakPane({ ...options, toWorkspace: true });
}

async function main() {
  const toWorkspace =
    process.argv.includes("--workspace") ||
    process.argv.includes("--new-workspace");
  const result = breakPane({ toWorkspace });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
