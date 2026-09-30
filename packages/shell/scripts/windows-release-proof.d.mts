export interface WindowsReleaseArtifactProof {
  readonly file: string;
  readonly sha256: string;
  readonly authenticode: 'valid' | 'not-checked';
}

export interface WindowsReleaseProof {
  readonly version: 1;
  readonly installer: WindowsReleaseArtifactProof;
  readonly executable: WindowsReleaseArtifactProof;
}

export declare function findWindowsInstaller(releaseDir: string): Promise<string>;
export declare function sha256File(filePath: string): Promise<string>;

export declare function verifyAuthenticode(
  filePath: string,
  options?: {
    platform?: string;
    run?: (
      script: string,
      options: { env: Record<string, string> },
    ) => Promise<void>;
  },
): Promise<void>;

export declare function windowsReleaseProof(
  releaseDir: string,
  options?: {
    requireSignature?: boolean;
    verifySignature?: (filePath: string) => Promise<void>;
  },
): Promise<WindowsReleaseProof>;

export declare function writeWindowsReleaseProof(
  releaseDir: string,
  options?: {
    requireSignature?: boolean;
    verifySignature?: (filePath: string) => Promise<void>;
  },
): Promise<{ path: string; proof: WindowsReleaseProof }>;
