"use client";

import { useEffect, useRef } from "react";
import { useAppContext } from "../../../context/AppContext";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import { MY_PAGE_FILE, MY_CLIENT_FILE, PLAYGROUND_FILE } from "../lib/workspaceFiles";

const parsePythonMethods = (content: string) => {
  const methods: { name: string; args: string; doc: string }[] = [];
  const regex = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\):(?:\s*\n\s*"""([^"]*)""")?/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (name === "__init__") continue;
    const args = match[2].trim();
    const doc = match[3] ? match[3].trim() : "";
    methods.push({ name, args, doc });
  }
  return methods;
};

/**
 * Monaco Python completion for the workspace editor: suggests `mPage.` /
 * `playground_client.` methods parsed from the scaffold files. The provider
 * is registered once per mount and disposed on unmount.
 */
export function usePythonAutocomplete() {
  const { apiCall } = useAppContext();
  const { sessionId } = useWebExplorer();

  const pageMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const clientMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const completionProviderRef = useRef<any>(null);

  const updateMethodsCache = async () => {
    if (!sessionId) return;
    let myPageMethods: { name: string; args: string; doc: string }[] = [];
    let playgroundMethods: { name: string; args: string; doc: string }[] = [];
    try {
      const pageData = await apiCall(`/api/workspace/files/${MY_PAGE_FILE}?session_id=${sessionId}`);
      if (pageData && pageData.content) {
        myPageMethods = parsePythonMethods(pageData.content);
      }
    } catch (e) {
      console.error("Failed to parse my_page.py", e);
    }
    try {
      const pgData = await apiCall(`/api/workspace/files/${PLAYGROUND_FILE}?session_id=${sessionId}`);
      if (pgData && pgData.content) {
        playgroundMethods = parsePythonMethods(pgData.content);
      }
    } catch (e) {
      console.error("Failed to parse playground.py", e);
    }
    // PlaygroundPage extends MyPage: suggest the union, overrides win
    const seen = new Set(playgroundMethods.map((m) => m.name));
    pageMethodsRef.current = [...playgroundMethods, ...myPageMethods.filter((m) => !seen.has(m.name))];
    try {
      const clientData = await apiCall(`/api/workspace/files/${MY_CLIENT_FILE}?session_id=${sessionId}`);
      if (clientData && clientData.content) {
        clientMethodsRef.current = parsePythonMethods(clientData.content);
      }
    } catch (e) {
      console.error("Failed to parse my_client.py", e);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    if (!completionProviderRef.current) {
      completionProviderRef.current = monaco.languages.registerCompletionItemProvider("python", {
        triggerCharacters: [".", "p", "m"],
        provideCompletionItems: (model: any, position: any) => {
          const lineContent = model.getLineContent(position.lineNumber);
          const textBeforeCursor = lineContent.substring(0, position.column - 1);

          // mPage is the current template variable; playground_page kept for
          // workspaces scaffolded before the rename
          if (/(^|[^\w])(mPage|playground_page)\.$/.test(textBeforeCursor)) {
            return {
              suggestions: pageMethodsRef.current.map((m) => ({
                label: m.name,
                kind: monaco.languages.CompletionItemKind.Method,
                insertText: m.name + "(" + (m.args.includes("value") ? '"${1:value}"' : "") + ")",
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: `(method) ${m.name}(${m.args})`,
                documentation: m.doc,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endColumn: position.column
                }
              }))
            };
          }

          if (textBeforeCursor.endsWith("playground_client.")) {
            return {
              suggestions: clientMethodsRef.current.map((m) => ({
                label: m.name,
                kind: monaco.languages.CompletionItemKind.Method,
                insertText: m.name + "(" + (m.args.includes("payload") ? "payload=${1:payload_obj}" : "") + ")",
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: `(method) ${m.name}(${m.args})`,
                documentation: m.doc,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endColumn: position.column
                }
              }))
            };
          }

          const word = model.getWordUntilPosition(position);
          if (!textBeforeCursor.includes(".")) {
            const vars = [
              { label: "mPage", detail: "PlaygroundPage instance" },
              { label: "playground_client", detail: "PlaygroundClient instance" }
            ];
            return {
              suggestions: vars.map((v) => ({
                label: v.label,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: v.label,
                detail: v.detail,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn
                }
              }))
            };
          }

          return { suggestions: [] };
        }
      });
    }
  };

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, []);

  return { updateMethodsCache, handleEditorDidMount };
}
