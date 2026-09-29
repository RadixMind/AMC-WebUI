import type { LiveArtifactFollowupPayload } from './liveUiFollowup';
import type {
  LiveArtifactInteractionField,
  LiveArtifactInteractionProperty,
  LiveArtifactInteractionSpec,
  LiveArtifactInteractionValue,
} from './liveUiInteractionTypes';

export * from './liveUiInteractionTypes';
export { diagnoseLiveArtifactInteraction } from './liveUiInteractionDiagnosis';

const LIVE_ARTIFACT_INTERACTION_SOURCE = 'amc-live-artifact-interaction:v1';

export const getLiveArtifactInteractionFields = (spec: LiveArtifactInteractionSpec): LiveArtifactInteractionField[] => {
  const requiredKeys = new Set(spec.schema.required ?? []);

  return Object.entries(spec.schema.properties).map(([key, property]) => ({
    key,
    label: property.title || key,
    description: property.description,
    required: requiredKeys.has(key),
    property,
  }));
};

/**
 * Quick shape check: does the content look like it could be a Live Artifact
 * Interaction JSON? Checks only for the presence of "instruction" and "schema"
 * keys without doing a full parse. Used for the ````json fence upgrade (P0-2)
 * where we want to avoid parse cost on every code block.
 */
export const hasLiveArtifactInteractionShape = (content: string): boolean => {
  const trimmed = content.trim();
  return trimmed.startsWith('{') && trimmed.includes('"instruction"') && trimmed.includes('"schema"');
};

export const getLiveArtifactInteractionDefaultValue = (
  property: LiveArtifactInteractionProperty,
): LiveArtifactInteractionValue | '' => {
  if (property.default !== undefined) {
    return Array.isArray(property.default) ? [...property.default] : property.default;
  }

  if (property.type === 'array') {
    return [];
  }

  if (property.enum && property.enum.length > 0) {
    return property.enum[0];
  }

  if (property.type === 'boolean') {
    return false;
  }

  return '';
};

export const buildLiveArtifactInteractionPayload = (
  spec: LiveArtifactInteractionSpec,
  state: Record<string, LiveArtifactInteractionValue | ''>,
): LiveArtifactFollowupPayload => ({
  instruction: spec.instruction,
  ...(spec.title ? { title: spec.title } : {}),
  source: LIVE_ARTIFACT_INTERACTION_SOURCE,
  state,
});
