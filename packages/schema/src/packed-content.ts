/**
 * Build-time interning of repeated JSON values. The wire envelope is expanded
 * before assembly/validation; authored content and saves never contain refs.
 * This removes repeated response prose/effect bundles without trimming prose
 * or charging unrequested translations to the first frame.
 */
export function packContentDocument(document: unknown): unknown {
  const counts = new Map<string, number>();
  const values = new Map<string, unknown>();
  let reserved = false;
  const visit = (value: unknown) => {
    if (value !== null && (typeof value === 'object' || typeof value === 'string')) {
      const key = JSON.stringify(value);
      if (key.length >= 20) { counts.set(key, (counts.get(key) ?? 0) + 1); values.set(key, value); }
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if ('$ed' in value || '$edPacked' in value) reserved = true;
      Object.values(value).forEach(visit);
    }
  };
  visit(document);
  if (reserved) return document;
  const keys = [...counts].filter(([key, count]) => key.length * (count - 1) > 16 * count + 5).map(([key]) => key);
  if (!keys.length) return document;
  const ids = new Map(keys.map((key, i) => [key, i]));
  const encode = (value: unknown, skip?: string): unknown => {
    const key = JSON.stringify(value);
    if (key !== skip && ids.has(key)) return { $ed: ids.get(key)! };
    if (Array.isArray(value)) return value.map(item => encode(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, encode(item)]));
    return value;
  };
  const packed = { $edPacked: 1, dictionary: keys.map(key => encode(values.get(key), key)), document: encode(document) };
  return JSON.stringify(packed).length < JSON.stringify(document).length ? packed : document;
}

export function unpackContentDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('$edPacked' in value)) return value;
  const packed = value as Record<string, unknown>;
  if (packed.$edPacked !== 1 || !Array.isArray(packed.dictionary) || !('document' in packed)
    || Object.keys(packed).some(key => !['$edPacked', 'dictionary', 'document'].includes(key))) throw new Error('invalid packed content envelope');
  const dictionary = packed.dictionary;
  const cache = new Map<number, unknown>();
  const active = new Set<number>();
  const decode = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(decode);
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    if ('$ed' in record) {
      const id = record.$ed;
      if (Object.keys(record).length !== 1 || typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= dictionary.length) throw new Error('invalid packed content reference');
      if (cache.has(id)) return cache.get(id);
      if (active.has(id)) throw new Error('cyclic packed content reference');
      active.add(id);
      const expanded = decode(dictionary[id]);
      active.delete(id); cache.set(id, expanded);
      return expanded;
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decode(child)]));
  };
  return decode(packed.document);
}
