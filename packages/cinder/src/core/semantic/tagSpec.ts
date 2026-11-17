import type { CinderTagAttributeName, CinderTagType } from "../../types.js";

export const CINDER_TAG_ATTRIBUTE_TO_TYPE: Record<
  CinderTagAttributeName,
  CinderTagType
> = {
  "cinder-context": "context",
  "cinder-route": "route",
  "cinder-entity": "entity",
  "cinder-field": "field",
  "cinder-filter": "filter",
  "cinder-action": "action",
  "cinder-output": "output",
  "cinder-data": "data",
};

export const CINDER_V1_ATTRIBUTES = Object.freeze(
  Object.keys(CINDER_TAG_ATTRIBUTE_TO_TYPE) as CinderTagAttributeName[],
);

export const CINDER_V1_TYPES = Object.freeze(
  Object.values(CINDER_TAG_ATTRIBUTE_TO_TYPE) as CinderTagType[],
);

export function getTagTypeForAttribute(
  attribute: CinderTagAttributeName,
): CinderTagType {
  return CINDER_TAG_ATTRIBUTE_TO_TYPE[attribute];
}
