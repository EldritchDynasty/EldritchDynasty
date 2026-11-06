import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Keep a display filename inside one cache directory, including on UTF-8 filesystems. */
export function artifactFilename(filename: string): string {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 512
    || filename === '.' || filename === '..' || /[\\/\p{Cc}]/u.test(filename)) {
    throw new TypeError('artifact filename must be a file basename');
  }
  const dot = filename.lastIndexOf('.');
  const suffix = dot > 0 ? filename.slice(dot) : '';
  const encoder = new TextEncoder();
  const allowance = 220 - encoder.encode(suffix).length;
  if (allowance < 1) throw new TypeError('artifact filename suffix is too long');
  let stem = '';
  let used = 0;
  for (const character of dot > 0 ? filename.slice(0, dot) : filename) {
    const bytes = encoder.encode(character).length;
    if (used + bytes > allowance) break;
    stem += character;
    used += bytes;
  }
  return stem + suffix;
}

/** Export exact bytes through native sharing; never touch durable saves or the Library. */
export async function shareArtifact(blob: Blob, filename: string): Promise<void> {
  const name = artifactFilename(filename);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(nonce, byte => byte.toString(16).padStart(2, '0')).join('');
  const path = `eldritch-exports/${token}/${name}`;
  await Filesystem.writeFile({ path, directory: Directory.Cache, data: btoa(binary), recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  // The recipient can still be reading after the chooser closes. Let the OS
  // reclaim cache files; deleting here races that read.
  await Share.share({ title: 'Eldritch Dynasty', url: uri, dialogTitle: name });
}
