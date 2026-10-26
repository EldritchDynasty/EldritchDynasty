/**
 * Build-time interning of repeated JSON values. The wire envelope is expanded
 * before assembly/validation; authored content and saves never contain refs.
 * This removes repeated response prose/effect bundles without trimming prose
 * or charging unrequested translations to the first frame.
 */
export function packContentDocument(document: unknown): unknown {
  const counts = new Map<string, number>();
  const values = new Map<string, unknown>();
  const fields = new Map<string, number>();
  let reserved = false;
  const visit = (value: unknown) => {
    if (value !== null && (typeof value === 'object' || typeof value === 'string')) {
      const key = JSON.stringify(value);
      if (key.length >= 20) { counts.set(key, (counts.get(key) ?? 0) + 1); values.set(key, value); }
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if ('$ed' in value || '$edPacked' in value) reserved = true;
      for (const name of Object.keys(value)) {
        if (name.startsWith('~')) reserved = true;
        fields.set(name, (fields.get(name) ?? 0) + 1);
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(document);
  if (reserved) return document;
  const keys = [...counts].filter(([key, count]) => key.length * (count - 1) > 16 * count + 5).map(([key]) => key);
  const ids = new Map(keys.map((key, i) => [key, i]));
  // Repeated property names cost first-frame bytes too. The second wire
  // version interns those names; the authored object is restored before Zod.
  const names = [...fields].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .filter(([name, count], i) => count * (name.length - `~${i.toString(36)}`.length) > name.length + 3)
    .map(([name]) => name);
  const fieldIds = new Map(names.map((name, i) => [name, `~${i.toString(36)}`]));
  const encode = (value: unknown, compactKeys: boolean, skip?: string): unknown => {
    const key = JSON.stringify(value);
    if (key !== skip && ids.has(key)) return { $ed: ids.get(key)! };
    if (Array.isArray(value)) return value.map(item => encode(item, compactKeys));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([name, item]) => [compactKeys ? fieldIds.get(name) ?? name : name, encode(item, compactKeys)]));
    return value;
  };
  const versions = [document,
    { $edPacked: 1, dictionary: keys.map(key => encode(values.get(key), false, key)), document: encode(document, false) },
    { $edPacked: 2, fields: names, dictionary: keys.map(key => encode(values.get(key), true, key)), document: encode(document, true) },
  ];
  return versions.reduce((best, candidate) => JSON.stringify(candidate).length < JSON.stringify(best).length ? candidate : best);
}

export function unpackContentDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('$edPacked' in value)) return value;
  const packed = value as Record<string, unknown>;
  const compactKeys = packed.$edPacked === 2;
  if ((packed.$edPacked !== 1 && !compactKeys) || !Array.isArray(packed.dictionary) || !('document' in packed)
    || Object.keys(packed).some(key => !['$edPacked', 'dictionary', 'document', ...(compactKeys ? ['fields'] : [])].includes(key))
    || compactKeys && (!Array.isArray(packed.fields) || packed.fields.some(name => typeof name !== 'string' || name.startsWith('~'))
      || new Set(packed.fields).size !== packed.fields.length)) throw new Error('invalid packed content envelope');
  const dictionary = packed.dictionary;
  const fields = compactKeys ? packed.fields as string[] : [];
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
    const entries = Object.entries(record).map(([key, child]) => {
      if (!compactKeys || !key.startsWith('~')) return [key, decode(child)] as const;
      const id = Number.parseInt(key.slice(1), 36);
      if (!Number.isSafeInteger(id) || id < 0 || id >= fields.length || key !== `~${id.toString(36)}`)
        throw new Error('invalid packed content field');
      return [fields[id]!, decode(child)] as const;
    });
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('duplicate packed content field');
    return Object.fromEntries(entries);
  };
  return decode(packed.document);
}
