# Neon for VS Code

Syntax highlighting for `.neon` files, plus a client for the `neon-lsp` language
server.

**Status: unpublished. The extension has never been run; the grammar has.**

Nobody has installed this extension, opened a file with it, or watched a
diagnostic arrive — no VS Code instance has loaded `client/extension.js`. Treat
the first run as a debugging session, not an install.

The **TextMate grammar** is a different matter and is no longer unverified. It
was tokenized with the real engine — `vscode-textmate` over `vscode-oniguruma`,
the same pair VS Code itself uses — across all 310 `.neon` files in `tests/lang/`
and `stdlib/`: 82,392 tokens, no exception, and exactly one file left inside an
unclosed rule, `strings/interpolation_unterminated_fails.neon`, a `//@ compile-fail`
fixture whose interpolation is deliberately unterminated. Scope counts before and
after each change were diffed against the corpus, which is how the `orelse`
(83 occurrences), `@inline` (5) and integer-scoped-as-float (1,686) bugs were
each confirmed fixed rather than assumed.

Everything is written against the sources in this repo rather than from memory:
`compiler/src/lexer/token.rs` for the keywords and punctuation,
`compiler/src/lexer/mod.rs` for literals and comments, `compiler/src/ops.rs` for
which words are operators, `compiler/src/expand.rs` (`lookup`) for the annotation
names, and `lsp/src/main.rs` for the server's capabilities.

## What it does

- **Diagnostics.** Lexer, parser and type errors, published as you type.
- **Formatting.** Whole-document formatting, backed by `neon fmt`'s formatter.
  A file that does not parse is left alone — the formatter reprints from the
  AST, so there is nothing to reprint, and the server returns no edits rather
  than an error. Format-on-save while a line is half-written is therefore quiet.
- **Hover.** The type or signature of the symbol under the cursor, plus its
  `///` doc comment. Works on stdlib symbols.
- **Go to definition** (<kbd>F12</kbd>), including into stdlib files.
- **Find all references** (<kbd>Shift</kbd>+<kbd>F12</kbd>), shadowing-correct.
- **Rename** (<kbd>F2</kbd>). Declines a symbol whose definition is in another
  file and returns an LSP error rather than a partial edit — a rename that
  silently missed the definition would be worse than one that refused.
- **Completion**, triggered on `:` as well as on typing. Locals plus every
  visible `fn`, with signatures and docs. `.` is deliberately not a trigger:
  Neon has no method-call syntax, so a dot is field access on a record whose
  fields the identifier path already offers.
- **Signature help**, triggered on `(` and `,`.
- **Outline and breadcrumbs**, nested — `mod` and `impl` group their children.
- **Inlay hints**: inferred types on `let`s that have no annotation.

None of that is declared in `package.json`, and nothing needs to be.
`vscode-languageclient` reads the server's capabilities off the `initialize`
response and registers the matching providers itself, so the authoritative list
is the `ServerCapabilities` literal in `lsp/src/main.rs` — not this README, and
not any file in this directory. The one capability the server still does not
advertise is `codeActionProvider`, so there are no quick fixes.

Highlighting is TextMate-only. There are no semantic tokens either (`neon-lsp`
does not advertise `semanticTokensProvider`), so anything the grammar cannot
decide from a regex — which type a name refers to, most of all — is a heuristic.
See [Grammar notes](#grammar-notes).

## Requirements

- VS Code 1.82 or newer.
- A `neon-lsp` binary. Build it from this repo:

  ```
  cargo build --release -p neon-lsp
  ```

  which leaves it at `target/release/neon-lsp`.

- A sysroot: a directory containing `stdlib/`. In a checkout of this repo that
  is the repo root. See the configuration section — without it the server still
  runs, but reports no type errors.

## Install

### Unpacked, via the Extension Development Host

This is the way to run it today, and the only way that has any chance of
working without a publisher account.

1. Fetch the one runtime dependency:

   ```
   cd extra/vscode
   npm install
   ```

2. Open `extra/vscode` as a folder in VS Code — the extension root must be the
   folder, not the repo.
3. Press <kbd>F5</kbd>, or run the **Run Neon Extension** launch configuration.
   A second VS Code window (the Extension Development Host) opens with the
   extension loaded.
4. In that window, open a `.neon` file and configure `neon.server.path` and
   `neon.sysroot` as below.

The extension is plain JavaScript, so there is no compile step between step 1
and step 3 — `npm install` and F5 is the whole loop. That is the reason for the
choice: the client is a single file that spawns a process and forwards a
`documentSelector`, with no type-level complexity that a compiler would catch,
and requiring `npm run compile` before every F5 buys nothing in exchange for a
build artifact, a watch task and a `tsconfig.json`.

### As a permanent local install

Package it with [`vsce`](https://github.com/microsoft/vscode-vsce) and install
the result:

```
cd extra/vscode
npx @vscode/vsce package
code --install-extension neon-lang-0.1.0.vsix
```

This has not been tried. `vsce` is fussy about metadata — in particular the
`publisher` field and the `license` reference in `package.json` may need
adjusting before it will package.

### Highlighting only

If you only want colours, `neon.server.enable: false` skips the server
entirely and needs no binary and no `npm install` beyond what VS Code loads at
activation. (The `require` of `vscode-languageclient` happens at load time
regardless, so `node_modules` must still be present.)

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `neon.server.path` | `"neon-lsp"` | Path to the server executable. A bare name is looked up on `PATH`. A relative path is resolved against the first workspace folder. |
| `neon.server.enable` | `true` | Run the server at all. When false, only syntax highlighting is provided. |
| `neon.sysroot` | `""` | Directory containing `stdlib/`. Passed to the server as `NEON_SYSROOT`. |
| `neon.trace.server` | `"off"` | `off`, `messages` or `verbose`. Logs JSON-RPC traffic to the **Neon Language Server** output channel. |

There is deliberately **no `neon.inlayHints.enable`**, and no per-feature toggle
of any kind. VS Code already scopes its own settings by language, and a setting
here would be a second switch that the client would have to be taught to honour:

```json
{
  "[neon]": {
    "editor.inlayHints.enabled": "off",
    "editor.formatOnSave": true
  }
}
```

`neon.server.path` and `neon.sysroot` both expand `${workspaceFolder}` (the
first workspace folder) and `${userHome}`. VS Code does not substitute these in
ordinary settings values — only in tasks and launch configurations — so the
extension expands them itself, and only those two.

A typical workspace `.vscode/settings.json` for a checkout of this repo:

```json
{
  "neon.server.path": "${workspaceFolder}/target/release/neon-lsp",
  "neon.sysroot": "${workspaceFolder}"
}
```

### About `NEON_SYSROOT`

The server loads the standard library from `$NEON_SYSROOT/stdlib`, once, at
startup. If that variable is unset or the directory does not exist, it does not
fail — it loads nothing and **skips the type checker entirely**, leaving only
lexer and parser diagnostics. That is a deliberate degradation, and it is quiet:
the symptom is that syntax errors appear but type errors never do, which is easy
to mistake for a clean file.

If `neon.sysroot` is empty the extension does not clear the variable; the server
inherits whatever the editor process has, so exporting `NEON_SYSROOT` in your
shell before launching `code` works too. When neither is set, the extension
writes a line saying so to the **Neon Language Server** output channel.

The stdlib is read once and never reloaded, because it is part of the toolchain
rather than the project. After changing it — or after rebuilding `neon-lsp` —
run **Neon: Restart Language Server** from the command palette. Changing
`neon.server.path`, `neon.server.enable` or `neon.sysroot` restarts the server
automatically.

## Language configuration

Comments are `//` for a line, `///` for a doc comment attached to the following
declaration, and `/* ... */` for a block. Block comments **nest**: a commented-out
block containing a comment does not end early. VS Code's own comment toggling
does not model nesting, so the Toggle Block Comment command can produce a
mismatched pair in that case; the grammar highlights nesting correctly either
way.

Pressing Enter inside a `///` run continues it. Brackets, quotes and `/*` all
auto-close.

## Grammar notes

A few places where the grammar encodes a real rule rather than a guess, all
derived from `compiler/src/lexer/mod.rs`:

- **Atoms.** `:name` is an atom only when the colon does not directly follow an
  identifier. This is the rule that keeps the language from being
  whitespace-sensitive: without it `{ x:y }` and `{ x: y }` would mean different
  things. The grammar's lookbehind mirrors it.
- **Interpolation.** `"#{expr}"` is highlighted as code, and braces inside a
  hole are counted, so `"#{Point { x: 1 }}"` finds its own closing brace first.
  A bare `#` is literal text; `\#` escapes a hole.
- **Floats.** A float needs a digit after the dot, so `x.0` is field access and
  `xs..1` is a spread, not numbers.
- **`enum`.** Not a keyword — sum types are unions of records, and `enum` is an
  ordinary identifier. The grammar flags `enum Name` as invalid, matching the
  dedicated parser diagnostic, but leaves `enum` used as a plain name alone.
- **Annotations.** `@native`, `@cfg`, `@doc`, `@runtime`, `@pure` and `@inline`
  are the **six** the compiler recognises — `lookup()` in `compiler/src/expand.rs`
  is the registry. Any other `@name` is highlighted as invalid, since the
  compiler rejects it. `@inline` was added to the compiler after this grammar
  was written and was, until recently, flagged as invalid here; it occurs five
  times in `stdlib/`, all of them wrongly reddened.
- **`orelse` is an operator, not exception control flow.** It reads like `catch`,
  but `compiler/src/ops.rs` has it as a binary operator on the lowest rung of the
  precedence ladder — below `or`. It is scoped `keyword.operator.word`, not
  `keyword.control.exception`.
- **`orphan` is contextual.** `orphan impl P for T` marks an impl the author owns
  neither side of, but `orphan` is absent from `Token::keyword`; the parser
  matches it as a plain identifier that happens to sit before `impl`. So the
  grammar matches it with that lookahead rather than adding it to the keyword
  list — `let orphan = 1` is legal Neon and stays a variable.
- **Type names.** Highlighting an initial capital as a type is a heuristic and
  nothing more. The server does not provide semantic tokens, so this is as far
  as it can honestly go.

### What the grammar cannot do

This is a regular expression pretending to be a parser, and
[`extra/tree-sitter-neon`](../tree-sitter-neon) is an actual one. The gap is
listed in full in `information_for_contributors` at the top of
`syntaxes/neon.tmLanguage.json`; the short version is that no amount of regex
effort will let this file tell a type from a value, a record literal from a
block, or type parameters from a turbofish from an index, and it can resolve no
name to its binding. Where a *declaration keyword* pins the position — inside a
`fn`, `record`, `protocol`, `newtype`, `type`, `marker` or `impl` head — it does
now scope parameters (`variable.parameter`) and type parameters
(`entity.name.type.parameter`) correctly, because there the answer is local.
Everywhere else it guesses, and says so by guessing the same way every time.

## Troubleshooting

- **No diagnostics at all.** Check the **Neon Language Server** output channel.
  If the server failed to spawn, an error notification names the command it
  tried.
- **Syntax errors appear, type errors never do.** The sysroot is wrong. See
  above.
- **Formatting does nothing.** Expected when the file does not parse. If it does
  parse, set `neon.trace.server` to `verbose` and look for the
  `textDocument/formatting` exchange.
