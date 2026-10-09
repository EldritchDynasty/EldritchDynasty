import ts from 'typescript';
import { contentInterpolationTokens } from '@ed/schema';
import { coreMessageAddress } from '../messages.js';

export interface CoreMessageEntry {
  address: string;
  text: string;
  interpolations: string[];
  /** Source offset of the Original; excludes its legacy ordinal work item. */
  start: number;
}

/** Discover the same explicit keys used by msg(), including short templates. */
export function coreMessageEntries(source: string): CoreMessageEntry[] {
  const file = ts.createSourceFile('messages.ts', source, ts.ScriptTarget.Latest, true);
  const entries: CoreMessageEntry[] = [];
  const seen = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'msg') {
      const key = node.arguments[1];
      const original = node.arguments[2];
      if (!key || !ts.isStringLiteral(key) || !original
        || !(ts.isStringLiteral(original) || ts.isNoSubstitutionTemplateLiteral(original))) {
        throw new Error('Core msg() calls need a literal key and an uninterpolated Original template');
      }
      const address = coreMessageAddress(key.text);
      if (seen.has(address)) throw new Error(`Duplicate core message key: ${key.text}`);
      seen.add(address);
      entries.push({
        address,
        text: original.text,
        interpolations: contentInterpolationTokens(original.text),
        start: original.getStart(file),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return entries;
}
