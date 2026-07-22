// The Neon VS Code client.
//
// Plain JavaScript, deliberately: the whole client is one file whose job is to
// spawn `neon-lsp` over stdio and hand it to vscode-languageclient. A
// TypeScript build step would add a toolchain, a compile artifact and a
// watch task to a file with no type-level complexity to check, and would put a
// `npm run compile` between cloning the repo and pressing F5. See README.md.
//
// This file configures no LSP features, and that is now a statement about the
// protocol rather than about the server. `neon-lsp` advertises ten capabilities
// (the `ServerCapabilities` literal in `lsp/src/main.rs` is the list): sync,
// formatting, hover, definition, references, rename, completion, signature help,
// document symbols and inlay hints. vscode-languageclient reads them off the
// `initialize` response and registers the corresponding providers itself, so
// hover, go-to-definition and the rest work without a line here.
//
// This comment previously read "the server advertises exactly two capabilities",
// and stayed that way while eight more were added. It is a duplicate of a list
// that lives elsewhere, which is the only kind of comment that can go stale —
// hence the pointer at lsp/src/main.rs instead of a fresh copy of the list.

const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

/** @type {LanguageClient | undefined} */
let client;

/** @type {vscode.OutputChannel | undefined} */
let channel;

/**
 * Expand the variables we promise in package.json. VS Code does not substitute
 * these in ordinary settings values, only in task and launch configurations, so
 * a setting that reads `${workspaceFolder}/target/debug/neon-lsp` arrives here
 * verbatim and has to be expanded by hand.
 */
function expand(value) {
  if (!value) {
    return value;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  let out = value;
  if (folder) {
    out = out.replace(/\$\{workspaceFolder\}/g, folder);
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    out = out.replace(/\$\{userHome\}/g, home);
  }
  return out;
}

/**
 * The command to run. A bare name is left alone so the OS resolves it on PATH;
 * anything with a separator is made absolute against the workspace, because a
 * relative path would otherwise be resolved against the extension host's
 * working directory, which is not a place the user can predict.
 */
function serverCommand(config) {
  const configured = expand(config.get("server.path") || "neon-lsp");
  if (!configured.includes(path.sep) && !configured.includes("/")) {
    return configured;
  }
  if (path.isAbsolute(configured)) {
    return configured;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  return folder ? path.join(folder, configured) : configured;
}

/**
 * The environment for the server process.
 *
 * NEON_SYSROOT is what lets the server load the stdlib and therefore report
 * type errors at all; without it, `load_stdlib` returns nothing and the server
 * falls back to lexer and parser diagnostics only. An unset setting inherits
 * whatever the editor was launched with rather than clearing it, so a user who
 * already exports NEON_SYSROOT in their shell needs no configuration here.
 */
function serverEnv(config) {
  const env = Object.assign({}, process.env);
  const sysroot = expand(config.get("sysroot") || "");
  if (sysroot) {
    env.NEON_SYSROOT = sysroot;
  }
  return env;
}

function warnIfNoSysroot(config, env) {
  if (config.get("sysroot") || env.NEON_SYSROOT) {
    return;
  }
  channel?.appendLine(
    "NEON_SYSROOT is not set and `neon.sysroot` is empty. The server will " +
      "report lexer and parser diagnostics only; type errors will not appear.",
  );
}

async function start() {
  const config = vscode.workspace.getConfiguration("neon");
  if (!config.get("server.enable", true)) {
    channel?.appendLine("`neon.server.enable` is false; not starting the server.");
    return;
  }

  const command = serverCommand(config);
  const env = serverEnv(config);
  warnIfNoSysroot(config, env);

  // The server speaks LSP over stdio and takes no arguments.
  const executable = { command, args: [], transport: TransportKind.stdio, options: { env } };
  const serverOptions = { run: executable, debug: executable };

  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "neon" }],
    outputChannel: channel,
    // The server reads the stdlib once at startup and holds no other state
    // that depends on the workspace, so there is nothing to watch on disk.
  };

  client = new LanguageClient("neon", "Neon Language Server", serverOptions, clientOptions);

  try {
    await client.start();
  } catch (err) {
    client = undefined;
    vscode.window.showErrorMessage(
      `Could not start the Neon language server (\`${command}\`): ${err}. ` +
        "Set `neon.server.path`, or set `neon.server.enable` to false to use " +
        "syntax highlighting alone.",
    );
  }
}

async function stop() {
  if (!client) {
    return;
  }
  const running = client;
  client = undefined;
  await running.stop();
}

async function activate(context) {
  channel = vscode.window.createOutputChannel("Neon Language Server");
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand("neon.restartServer", async () => {
      await stop();
      await start();
    }),
  );

  // Every setting this extension has is read when the server is spawned, so a
  // change to any of them means a restart.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("neon")) {
        return;
      }
      // `neon.trace.server` is handled by the client library itself.
      if (
        event.affectsConfiguration("neon.server.path") ||
        event.affectsConfiguration("neon.server.enable") ||
        event.affectsConfiguration("neon.sysroot")
      ) {
        await stop();
        await start();
      }
    }),
  );

  await start();
}

async function deactivate() {
  await stop();
}

module.exports = { activate, deactivate };
