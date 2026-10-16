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

/** Discover inline msg() and static defineMessage() keys, including short templates. */
export function coreMessageEntries(source: string): CoreMessageEntry[] {
  const file = ts.createSourceFile('messages.ts', source, ts.ScriptTarget.Latest, true);
  const entries: CoreMessageEntry[] = [];
  const seen = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === 'msg' || node.expression.text === 'defineMessage')) {
      const keyIndex = node.expression.text === 'msg' ? 1 : 0;
      const key = node.arguments[keyIndex];
      const original = node.arguments[keyIndex + 1];
      if (!key || !ts.isStringLiteral(key) || !original
        || !(ts.isStringLiteral(original) || ts.isNoSubstitutionTemplateLiteral(original))) {
        throw new Error(`Core ${node.expression.text}() calls need a literal key and an uninterpolated Original template`);
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
