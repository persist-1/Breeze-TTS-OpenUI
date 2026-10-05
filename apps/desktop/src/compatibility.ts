import type {
  Workspace,
  Segment,
  Output,
} from "../../../packages/contracts/src/index.ts";
export function matchesDraft(s: Segment, o: Output, w: Workspace): boolean {
  const voice =
    s.voiceSource === "library"
      ? w.voices.find((v) => v.id === s.voiceId)
      : undefined;
  if (s.voiceSource === "library" && s.voiceId && !voice) return false;
  const guidance = s.directionEnabled
    ? s.directionSource === "description"
      ? s.directionDraft
      : w.directions.find((d) => d.id === s.directionPresetId)?.instruction
    : "";
  if (guidance == null) return false;
  const instruction = [
    s.voiceSource === "description"
      ? s.voiceDescription
      : voice?.kind === "design"
        ? voice.description
        : "",
    guidance,
  ]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n");
  const ref = voice?.kind === "reference" ? voice : undefined;
  return (
    s.text === o.input.text &&
    s.language === o.input.language &&
    instruction === o.input.instruction &&
    (s.seed === o.input.seed || s.seed === (o.candidateSeed ?? o.input.seed)) &&
    (instruction ? s.cfg : 1) === o.input.cfg &&
    (ref?.assetId || "") === (o.input.reference?.assetId || "") &&
    (ref?.transcript || "") === (o.input.reference?.transcript || "") &&
    (!ref || ref.consent === true)
  );
}
