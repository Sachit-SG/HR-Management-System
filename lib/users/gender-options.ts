/** Stored values for `employees.gender`. Empty string = not specified. */
export const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
] as const;

export type GenderValue = (typeof GENDER_OPTIONS)[number]["value"];

export const GENDER_VALUES: ReadonlyArray<GenderValue> = GENDER_OPTIONS.map((o) => o.value);

export function genderLabel(value: string | null | undefined): string {
  const hit = GENDER_OPTIONS.find((o) => o.value === (value ?? ""));
  return hit?.label ?? "Not specified";
}
