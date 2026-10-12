import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import { assembleBundle, type ContentSources, type FlowProseIssue, type YamlParser } from '@ed/schema';

/** Plain values and source diagnostics can travel through the same parse cache. */
export interface ParsedContentYaml {
  document: unknown;
  flowProseIssues: FlowProseIssue[];
}

export function parseContentYaml(source: string): ParsedContentYaml {
  const lines = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lines });
  if (doc.errors.length) throw doc.errors[0];
  const flowProseIssues: FlowProseIssue[] = [];
  const seen = new WeakMap<object, boolean>();
  const visit = (node: unknown, authored: boolean): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node) && (seen.get(node) || !authored)) return;
    seen.set(node, authored);
    if (isAlias(node)) {
      visit(node.resolve(doc), authored);
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item, authored);
    } else if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? pair.key.value : undefined;
        // An omitted flow value is distinct from `note: null`, a quoted key,
        // a block mapping, or braces which merely occur inside a prose value.
        if (authored && node.flow && pair.value === null && isScalar(pair.key)
          && pair.key.type === 'PLAIN' && typeof key === 'string') {
          flowProseIssues.push({ key, line: lines.linePos(pair.key.range![0]).line });
        }
        visit(pair.value, authored || key === 'effects' || key === 'claims' || key === 'decidedBy');
      }
    }
  };
  visit(doc.contents, false);
  return { document: doc.toJS(), flowProseIssues };
}

/** Used by both Node's cached loader and the browser editor's raw-file loader. */
export function contentYamlParser(byText = new Map<string, ParsedContentYaml>()): YamlParser {
  const parsed = (text: string): ParsedContentYaml => {
    let value = byText.get(text);
    if (!value) { value = parseContentYaml(text); byText.set(text, value); }
    return value;
  };
  return Object.assign((text: string) => parsed(text).document, {
    flowProseIssues: (text: string) => parsed(text).flowProseIssues,
  });
}

export function assembleYamlBundle(files: Record<string, string>, sources?: ContentSources) {
  return assembleBundle(files, contentYamlParser(), sources);
}
