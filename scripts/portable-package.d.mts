export interface PackageAudit {
  output: string;
  version: string;
  bytes: number;
  files: number;
  sha256: string;
  containsUv: false;
  containsPython: false;
  containsWeights: false;
  containsPersonalData: false;
}
export function packagePortable(
  root: string,
  progress?: (phase: string, done: number, total: number) => void,
  options?: { stampIcon?: (exe: string, icon: string) => Promise<void> },
): Promise<PackageAudit>;
